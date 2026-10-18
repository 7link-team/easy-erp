mod assets;
mod auth;
mod backup;
mod dashboard;
mod database;
mod database_copy;
mod db;
mod desktop_control;
mod domain;
mod error;
mod inventory;
mod migration;
mod money;
mod mysql;
mod network;
mod options;
mod recovery;
mod roles;
mod sales;
mod state;
mod stocktake;
mod storage;
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
    /// Configure an unused data directory from JSON on stdin, without exposing passwords in argv.
    #[arg(long, conflicts_with_all = ["recovery_action", "backup_only", "migrate_data_to"])]
    configure_database: bool,
    /// Maintain local data without starting HTTP, even if the database is broken.
    #[arg(long, conflicts_with_all = ["backup_only", "migrate_data_to"])]
    recovery_action: Option<recovery::Action>,
    #[arg(long, requires = "recovery_action")]
    recovery_backup: Option<PathBuf>,
    #[arg(long, requires = "recovery_action", default_value = "")]
    confirmation: String,
    /// Create a standard ZIP backup without starting HTTP or running migrations.
    #[arg(long)]
    backup_only: bool,
    /// Back up and move an offline inventory directory without changing its schema.
    #[arg(long, conflicts_with = "backup_only")]
    migrate_data_to: Option<PathBuf>,
    #[arg(long, env = "ERP_DATA_DIR", default_value = "data")]
    data_dir: PathBuf,
    /// First-run web setup for a standalone server. Existing SQLite data is reused.
    #[arg(long, env = "ERP_SERVER_MODE", default_value_t = false)]
    server_mode: bool,
    #[arg(long, env = "ERP_DATABASE_URL", hide_env_values = true)]
    database_url: Option<String>,
    #[arg(long, env = "ERP_SETUP_TOKEN", hide_env_values = true)]
    setup_token: Option<String>,
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
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "easy_erp_server=info,tower_http=info".into()),
        )
        .init();
    let mut cfg = Config::parse();
    // Compose optional substitutions are empty strings when unset.
    cfg.database_url = cfg.database_url.filter(|v| !v.is_empty());
    cfg.setup_token = cfg.setup_token.filter(|v| !v.is_empty());
    let mysql = cfg.database_url.is_some() || database::configured_mysql(&cfg.data_dir)?;
    if mysql
        && matches!(
            cfg.recovery_action,
            Some(recovery::Action::Reset | recovery::Action::Restore)
        )
    {
        anyhow::bail!(
            "当前使用MySQL，请启动库存服务后在“备份”页面恢复；本机SQLite维护不会清空或替换MySQL数据库。"
        );
    }
    anyhow::ensure!(
        !mysql || cfg.migrate_data_to.is_none(),
        "MySQL配置不能按本机SQLite目录迁移。"
    );
    if cfg.recovery_action == Some(recovery::Action::List) {
        println!("{}", recovery::list(&cfg.data_dir).await?);
        return Ok(());
    }
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
    if cfg.backup_only && !mysql && !cfg.data_dir.join("inventory.sqlite").exists() {
        return Ok(());
    }
    if cfg.recovery_action.is_some() {
        recovery::directory_or_absent(&cfg.data_dir)?;
    }
    std::fs::create_dir_all(&cfg.data_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&cfg.data_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    recovery::regular_or_absent(&cfg.data_dir.join("server.lock"))?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(cfg.data_dir.join("server.lock"))?;
    lock.try_lock_exclusive()
        .map_err(|_| anyhow::anyhow!("该数据目录已有服务运行，不能重复启动。"))?;
    if cfg.configure_database {
        let result = database::configure_cli(&cfg.data_dir).await;
        match result {
            Ok(()) => println!("{}", serde_json::json!({"ok": true})),
            Err(error) => {
                println!("{}", serde_json::json!({"error": error.to_string()}));
                std::process::exit(1);
            }
        }
        return Ok(());
    }
    if let Some(action) = cfg.recovery_action {
        println!(
            "{}",
            recovery::run(
                &cfg.data_dir,
                action,
                cfg.recovery_backup.as_deref(),
                &cfg.confirmation
            )
            .await?
        );
        return Ok(());
    }
    recovery::finish_pending(&cfg.data_dir)?;
    if cfg.backup_only || cfg.migrate_data_to.is_some() {
        let path = cfg.data_dir.canonicalize()?.join("inventory.sqlite");
        let mut options = ConnectOptions::new("sqlite://inventory");
        options
            .max_connections(1)
            .sqlx_logging(false)
            .map_sqlx_sqlite_opts(move |options| options.filename(&path).read_only(true));
        let db = if mysql {
            database::open(&cfg, None, "").await?
        } else {
            Database::connect(options).await?
        };
        let result = backup::snapshot(&db, &cfg.data_dir, "maintenance").await;
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
    let setup_token =
        database::setup_token(&cfg.data_dir, cfg.setup_token.clone(), cfg.server_mode)?;
    let db = database::open(&cfg, setup_token.clone(), &instance_id).await?;
    if db.get_database_backend() == sea_orm::DbBackend::Sqlite
        && db::one(
            &db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='items'",
            vec![],
        )
        .await?
        .is_some()
        && db::one(
            &db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name='roles'",
            vec![],
        )
        .await?
        .is_none()
    {
        let before = backup::snapshot(&db, &cfg.data_dir, "upgrade").await?;
        tracing::info!(backup=?serde_json::to_value(before)?, "业务模块升级前备份已完成");
    }
    let files = storage::FileStorage::from_env(&cfg.data_dir)?;
    migration::Migrator::up(&db, None).await?;
    let s = Arc::new(state::State {
        db,
        files,
        setup_token,
        server_mode: cfg.server_mode,
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
        .route(
            "/api/desktop/prepare-recovery",
            post(desktop_control::prepare_recovery),
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
        .route("/api/roles", get(roles::list).post(roles::save))
        .route("/api/roles/{id}", axum::routing::delete(roles::remove))
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
            "/api/material-options",
            get(options::list).post(options::save),
        )
        .route(
            "/api/material-options/{id}",
            axum::routing::delete(options::remove),
        )
        .route("/api/catalog-order", post(options::reorder))
        .route("/api/dashboard", get(dashboard::overview))
        .route("/api/sales", get(sales::list))
        .route(
            "/api/sales/catalog",
            get(sales::catalog).post(sales::save_catalog),
        )
        .route("/api/items/{id}/restore", post(inventory::restore_item))
        .route("/api/sales/commands", post(sales::command))
        .route(
            "/api/sales/catalog/{id}",
            axum::routing::delete(sales::remove_catalog),
        )
        .route("/api/sales/finance", get(sales::finance))
        .route("/api/sales/cash", get(sales::cash_ledger))
        .route("/api/sales/adjustments", get(sales::adjustments))
        .route("/api/sales/{id}", get(sales::get))
        .route("/api/sales/{id}/revisions/{version}", get(sales::revision))
        .route(
            "/api/sales/{id}/attachments",
            post(sales::upload).layer(DefaultBodyLimit::max(10 * 1024 * 1024 + 65536)),
        )
        .route(
            "/api/sales/attachments/{id}",
            get(sales::attachment).delete(sales::remove_attachment),
        )
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
                    "/api/backups/restore"
                        | "/api/desktop/prepare-update"
                        | "/api/desktop/prepare-recovery"
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
