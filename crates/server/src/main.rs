mod assets;
mod auth;
mod backup;
mod db;
mod desktop_control;
mod domain;
mod error;
mod inventory;
mod migration;
mod network;
mod state;
mod stocktake;
mod transfer;

use axum::{
    Router,
    extract::{DefaultBodyLimit, Request},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use clap::Parser;
use fs2::FileExt;
use sea_orm::{ConnectOptions, Database};
use sea_orm_migration::MigratorTrait;
use std::{collections::HashMap, net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, RwLock};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

#[derive(Parser)]
#[command(version, about = "库存管理后台服务")]
struct Config {
    /// Create a standard ZIP backup without starting HTTP or running migrations.
    #[arg(long)]
    backup_only: bool,
    /// Back up and move an offline inventory directory without changing its schema.
    #[arg(long, conflicts_with = "backup_only")]
    migrate_data_to: Option<PathBuf>,
    #[arg(long, env = "ERP_DATA_DIR", default_value = "data")]
    data_dir: PathBuf,
    #[arg(long, env = "ERP_BIND", default_value = "127.0.0.1:4280")]
    bind: SocketAddr,
    #[arg(long, env = "ERP_WEB_DIR")]
    web_dir: Option<PathBuf>,
    #[arg(long, env = "ERP_SECURE_COOKIE", default_value_t = false)]
    secure_cookie: bool,
    #[arg(long, env = "ERP_ALLOWED_HOSTS", value_delimiter = ',')]
    allowed_hosts: Vec<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "easy_erp_server=info,tower_http=info".into()),
        )
        .init();
    let cfg = Config::parse();
    if let Some(target) = &cfg.migrate_data_to {
        anyhow::ensure!(
            cfg.data_dir.join("inventory.sqlite").is_file(),
            "未找到要迁移的库存数据库。"
        );
        anyhow::ensure!(
            !target.exists(),
            "目标数据目录已存在，已停止迁移，不会覆盖任何文件。"
        );
    }
    if cfg.backup_only && !cfg.data_dir.join("inventory.sqlite").exists() {
        return Ok(());
    }
    std::fs::create_dir_all(&cfg.data_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&cfg.data_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(cfg.data_dir.join("server.lock"))?;
    lock.try_lock_exclusive()
        .map_err(|_| anyhow::anyhow!("该数据目录已有服务运行，不能重复启动。"))?;
    if cfg.backup_only || cfg.migrate_data_to.is_some() {
        let path = cfg.data_dir.canonicalize()?.join("inventory.sqlite");
        let mut options = ConnectOptions::new("sqlite://inventory");
        options
            .max_connections(1)
            .sqlx_logging(false)
            .map_sqlx_sqlite_opts(move |options| options.filename(&path).read_only(true));
        let db = Database::connect(options).await?;
        let result = backup::snapshot(&db, &cfg.data_dir).await;
        db.close().await?;
        let info = result.map_err(|error| anyhow::anyhow!(error.1))?;
        if let Some(target) = &cfg.migrate_data_to {
            // The offline snapshot is complete and every SQLite connection is closed.
            // Windows requires closing our lock-file handle before moving its parent.
            // The installer has already stopped desktop and service processes.
            #[cfg(windows)]
            drop(lock);
            // Move all files together, including WAL/SHM, identity and backups.
            // Cross-volume moves fail safely; never fall back to a partial file copy.
            std::fs::rename(&cfg.data_dir, target)?;
        }
        println!("{}", serde_json::to_string(&info)?);
        return Ok(());
    }
    let identity_path = cfg.data_dir.join("instance-id");
    let instance_id = match std::fs::read_to_string(&identity_path) {
        Ok(value) => uuid::Uuid::parse_str(value.trim())?.to_string(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            use std::io::Write;
            let value = uuid::Uuid::new_v4().to_string();
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&identity_path)?;
            file.write_all(value.as_bytes())?;
            file.sync_all()?;
            value
        }
        Err(error) => return Err(error.into()),
    };
    let path = cfg.data_dir.canonicalize()?.join("inventory.sqlite");
    // Pass filesystem paths directly: Windows canonical paths contain `?`,
    // and URL parsing would reinterpret `%` in ordinary directory names.
    let mut options = ConnectOptions::new("sqlite://inventory");
    options
        .max_connections(4)
        .min_connections(1)
        .sqlx_logging(false)
        .connect_timeout(std::time::Duration::from_secs(10))
        .map_sqlx_sqlite_opts(move |options| {
            use sea_orm::sqlx::sqlite::{SqliteJournalMode, SqliteSynchronous};
            options
                .filename(&path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Full)
                .foreign_keys(true)
                .busy_timeout(std::time::Duration::from_secs(5))
        });
    let db = Database::connect(options).await?;
    migration::Migrator::up(&db, None).await?;
    let s = Arc::new(state::State {
        db,
        writes: Mutex::new(()),
        data_dir: cfg.data_dir.clone(),
        instance_id,
        failures: Mutex::new(HashMap::new()),
        browser_tickets: Mutex::new(HashMap::new()),
        backup_lock: Mutex::new(()),
        secure: cfg.secure_cookie,
        bind: cfg.bind,
        maintenance: RwLock::new(()),
        desktop_token: std::env::var("ERP_DESKTOP_CONTROL_TOKEN")
            .ok()
            .filter(|value| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())),
        updating: std::sync::atomic::AtomicBool::new(false),
        shutdown: tokio::sync::Notify::new(),
    });
    let mut hosts = cfg.allowed_hosts;
    hosts.extend(["localhost".into(), "127.0.0.1".into(), "[::1]".into()]);
    let hosts = Arc::new(hosts);
    let maintenance_state = s.clone();
    let scheduler = tokio::spawn(backup::scheduler(s.clone()));
    let static_files = if let Some(path) = cfg.web_dir {
        Router::new().fallback_service(
            ServeDir::new(&path).not_found_service(ServeFile::new(path.join("index.html"))),
        )
    } else {
        Router::new().fallback(assets::serve)
    };
    let app = Router::new()
        .route("/api/status", get(auth::status))
        .route(
            "/api/desktop/prepare-update",
            post(desktop_control::prepare_update),
        )
        .route("/api/web-addresses", get(network::list))
        .route("/api/setup", post(auth::setup))
        .route("/api/login", post(auth::login))
        .route("/api/browser-login", post(auth::browser_ticket))
        .route(
            "/api/browser-login/consume",
            post(auth::consume_browser_ticket),
        )
        .route("/api/logout", post(auth::logout))
        .route("/api/me", get(auth::me))
        .route("/api/users", get(auth::users).post(auth::create_user))
        .route("/api/users/{id}", put(auth::update_user))
        .route(
            "/api/items",
            get(inventory::items).post(inventory::create_item),
        )
        .route(
            "/api/items/{id}",
            put(inventory::update_item).delete(inventory::archive_item),
        )
        .route("/api/movements", post(inventory::movement))
        .route(
            "/api/items/{id}/permanent",
            axum::routing::delete(inventory::delete_item),
        )
        .route("/api/documents", get(inventory::documents))
        .route("/api/documents/{id}/void", post(inventory::void_document))
        .route("/api/audit", get(inventory::audits))
        .route(
            "/api/stocktakes",
            get(stocktake::list).post(stocktake::start),
        )
        .route("/api/stocktakes/{id}/counts", put(stocktake::count))
        .route("/api/stocktakes/{id}/finish", post(stocktake::finish))
        .route("/api/backups", get(backup::list).post(backup::manual))
        .route("/api/backups/schedule", put(backup::update_schedule))
        .route("/api/backups/restore", post(backup::restore))
        .route("/api/backups/{name}", get(backup::download))
        .route("/api/templates/{mode}", get(transfer::template))
        .route("/api/export/{mode}", get(transfer::export))
        .route(
            "/api/imports/{mode}/preview",
            post(transfer::preview).layer(DefaultBodyLimit::max(5 * 1024 * 1024 + 65536)),
        )
        .route("/api/imports/{id}/commit", post(transfer::commit))
        .fallback_service(static_files)
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(middleware::from_fn_with_state(s.clone(), auth::renew))
        .layer(middleware::from_fn(move |req: Request, next: Next| {
            let state = maintenance_state.clone();
            async move {
                if state.updating.load(std::sync::atomic::Ordering::Acquire) {
                    return (
                        StatusCode::SERVICE_UNAVAILABLE,
                        "库存电脑正在更新，请稍后重试。",
                    )
                        .into_response();
                }
                if matches!(
                    req.uri().path(),
                    "/api/backups/restore" | "/api/desktop/prepare-update"
                ) {
                    return next.run(req).await;
                }
                let _guard = state.maintenance.read().await;
                if state.updating.load(std::sync::atomic::Ordering::Acquire) {
                    return (
                        StatusCode::SERVICE_UNAVAILABLE,
                        "库存电脑正在更新，请稍后重试。",
                    )
                        .into_response();
                }
                next.run(req).await
            }
        }))
        .layer(middleware::from_fn(move |req: Request, next: Next| {
            let hosts = hosts.clone();
            async move { guard(req, next, &hosts, cfg.bind).await }
        }))
        .layer(TraceLayer::new_for_http())
        .with_state(s.clone());
    let listener = tokio::net::TcpListener::bind(cfg.bind).await?;
    tracing::info!(address=%listener.local_addr()?,"库存服务已启动；首次在本机创建管理员账号");
    let stopping = s.clone();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        tokio::select! { _ = shutdown() => {}, _ = stopping.shutdown.notified() => {} }
    })
    .await?;
    scheduler.abort();
    let _ = scheduler.await;
    s.db.clone().close().await?;
    drop(lock);
    Ok(())
}
async fn guard(req: Request, next: Next, hosts: &[String], bind: SocketAddr) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let hostname = host
        .parse::<axum::http::uri::Authority>()
        .map(|a| a.host().to_string())
        .unwrap_or_default();
    let local_ipv4 = hostname.parse::<std::net::Ipv4Addr>().is_ok()
        && network::addresses(bind).is_ok_and(|ips| ips.contains(&hostname));
    if !hosts.iter().any(|h| h.eq_ignore_ascii_case(&hostname)) && !local_ipv4 {
        return (StatusCode::FORBIDDEN, "此主机地址未在允许列表中。").into_response();
    }
    if !matches!(
        *req.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) && req
        .headers()
        .get("x-erp-request")
        .and_then(|v| v.to_str().ok())
        != Some("1")
    {
        return (StatusCode::FORBIDDEN, "缺少操作校验标识。").into_response();
    }
    if let Some(origin) = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        && origin != format!("http://{host}")
        && origin != format!("https://{host}")
    {
        return (StatusCode::FORBIDDEN, "不允许此来源发起操作。").into_response();
    }
    let mut response = next.run(req).await;
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert(header::REFERRER_POLICY, "same-origin".parse().unwrap());
    response.headers_mut().insert(header::CONTENT_SECURITY_POLICY,"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'".parse().unwrap());
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}
async fn shutdown() {
    #[cfg(unix)]
    {
        let mut signal = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install termination handler");
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=signal.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
