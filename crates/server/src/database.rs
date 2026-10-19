//! Persistent server database selection and first-run setup.
use crate::{
    error::{ApiError, Result},
    migration::Migrator,
};
use axum::{
    Json, Router,
    extract::State,
    http::HeaderMap,
    middleware,
    routing::{get, post},
};
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{Mutex, Notify};

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Settings {
    Sqlite,
    Mysql {
        host: String,
        port: u16,
        database: String,
        username: String,
        password: String,
        #[serde(default)]
        tls: bool,
    },
}

pub fn configured_mysql(dir: &Path) -> anyhow::Result<bool> {
    let path = dir.join("database.json");
    if !path.exists() {
        return Ok(false);
    }
    let settings: Settings = serde_json::from_slice(&std::fs::read(path)?)?;
    Ok(matches!(settings, Settings::Mysql { .. }))
}

pub async fn sqlite(path: &Path, read_only: bool) -> Result<DatabaseConnection> {
    let path = path.to_path_buf();
    let mut options = ConnectOptions::new("sqlite://inventory");
    options
        .max_connections(4)
        .min_connections(1)
        .sqlx_logging(false)
        .connect_timeout(Duration::from_secs(10))
        .map_sqlx_sqlite_opts(move |options| {
            use sea_orm::sqlx::sqlite::{SqliteJournalMode, SqliteSynchronous};
            let options = options
                .filename(&path)
                .read_only(read_only)
                .create_if_missing(!read_only)
                .foreign_keys(true)
                .busy_timeout(Duration::from_secs(5));
            if read_only {
                options
            } else {
                options
                    .journal_mode(SqliteJournalMode::Wal)
                    .synchronous(SqliteSynchronous::Full)
            }
        });
    Ok(Database::connect(options).await?)
}

async fn connect(settings: &Settings, dir: &Path) -> Result<DatabaseConnection> {
    match settings {
        Settings::Sqlite => sqlite(&dir.join("inventory.sqlite"), false).await,
        Settings::Mysql {
            host,
            port,
            database,
            username,
            password,
            tls,
        } => {
            if host.trim().is_empty()
                || *port == 0
                || database.trim().is_empty()
                || username.trim().is_empty()
                || [host.len(), database.len(), username.len()]
                    .into_iter()
                    .any(|len| len > 255)
                || password.len() > 4096
            {
                return Err(ApiError::bad(
                    "请填写有效的 MySQL 主机、端口、数据库和用户名。",
                ));
            }
            let (host, port, database, username, password, tls) = (
                host.trim().to_owned(),
                *port,
                database.trim().to_owned(),
                username.trim().to_owned(),
                password.clone(),
                *tls,
            );
            let mut options = ConnectOptions::new("mysql://localhost");
            options
                .max_connections(4)
                .min_connections(1)
                .sqlx_logging(false)
                .connect_timeout(Duration::from_secs(10))
                .map_sqlx_mysql_opts(move |options| {
                    use sea_orm::sqlx::mysql::MySqlSslMode;
                    options
                        .host(&host)
                        .port(port)
                        .database(&database)
                        .username(&username)
                        .password(&password)
                        .charset("utf8mb4")
                        .collation("utf8mb4_bin")
                        .ssl_mode(if tls {
                            MySqlSslMode::Required
                        } else {
                            MySqlSslMode::Disabled
                        })
                });
            // Do not include connection credentials in browser errors or logs.
            Database::connect(options).await.map_err(|_| {
                ApiError::bad("无法连接 MySQL，请检查连接信息、数据库是否存在及账号权限。")
            })
        }
    }
}

pub fn setup_allowed(headers: &HeaderMap, token: Option<&str>) -> bool {
    token.is_some_and(|token| {
        headers
            .get("x-erp-setup-token")
            .and_then(|value| value.to_str().ok())
            == Some(token)
    })
}

pub fn setup_token(
    dir: &Path,
    configured: Option<String>,
    server_mode: bool,
) -> anyhow::Result<Option<String>> {
    if let Some(token) = configured {
        anyhow::ensure!(
            token.len() >= 16 && token.len() <= 256,
            "初始化口令需16–256个字符。"
        );
        return Ok(Some(token));
    }
    if !server_mode {
        return Ok(None);
    }
    let path = dir.join("setup-token");
    match std::fs::read_to_string(&path) {
        Ok(value) => Ok(Some(value.trim().to_owned())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let value = format!(
                "{}{}",
                crate::db::id().replace('-', ""),
                crate::db::id().replace('-', "")
            );
            write_private(&path, value.as_bytes())?;
            tracing::info!(setup_token=%value, "服务器首次初始化口令（仅用于配置数据库与创建管理员）");
            Ok(Some(value))
        }
        Err(error) => Err(error.into()),
    }
}
fn write_private(path: &Path, value: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    // tempfile creates private files; publish only after the complete value is durable.
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new(".")))?;
    file.write_all(value)?;
    file.as_file().sync_all()?;
    file.persist_noclobber(path).map_err(|error| error.error)?;
    Ok(())
}

struct Bootstrap {
    dir: PathBuf,
    token: Option<String>,
    instance_id: String,
    initializing: Mutex<()>,
    ready: Mutex<Option<DatabaseConnection>>,
    complete: Arc<Notify>,
}
async fn configure(
    State(state): State<Arc<Bootstrap>>,
    headers: HeaderMap,
    Json(settings): Json<Settings>,
) -> Result<Json<serde_json::Value>> {
    if !setup_allowed(&headers, state.token.as_deref()) {
        return Err(ApiError::forbidden());
    }
    let _lock = state.initializing.lock().await;
    if state.dir.join("database.json").exists() {
        return Err(ApiError::conflict("数据库已配置，请重新打开页面。"));
    }
    let db = connect(&settings, &state.dir).await?;
    // Probe the schema before persisting: failed credentials/configuration remain retryable.
    if let Err(error) = Migrator::up(&db, None).await {
        let _ = db.close().await;
        tracing::error!(%error, "初始化数据库结构失败");
        return Err(ApiError::bad(
            "数据库结构初始化失败，请检查账号的建表权限及数据库版本。",
        ));
    }
    write_private(
        &state.dir.join("database.json"),
        &serde_json::to_vec_pretty(&settings).expect("database settings serialize"),
    )?;
    *state.ready.lock().await = Some(db);
    state.complete.notify_one();
    Ok(Json(json!({"ok": true})))
}

pub async fn open(
    cfg: &crate::Config,
    token: Option<String>,
    instance_id: &str,
) -> anyhow::Result<DatabaseConnection> {
    if let Some(url) = &cfg.database_url {
        anyhow::ensure!(
            url.starts_with("mysql://"),
            "ERP_DATABASE_URL只支持mysql://；本地SQLite请使用数据目录配置。"
        );
        let mut options = ConnectOptions::new(url);
        options
            .max_connections(4)
            .min_connections(1)
            .sqlx_logging(false)
            .connect_timeout(Duration::from_secs(10));
        return Database::connect(options)
            .await
            .map_err(|_| anyhow::anyhow!("无法连接ERP_DATABASE_URL指定的MySQL数据库。"));
    }
    let path = cfg.data_dir.join("database.json");
    if path.exists() {
        let settings: Settings = serde_json::from_slice(&std::fs::read(path)?)?;
        return Ok(connect(&settings, &cfg.data_dir).await?);
    }
    if !cfg.server_mode || cfg.data_dir.join("inventory.sqlite").exists() {
        return Ok(sqlite(
            &cfg.data_dir.canonicalize()?.join("inventory.sqlite"),
            false,
        )
        .await?);
    }
    let complete = Arc::new(Notify::new());
    let state = Arc::new(Bootstrap {
        dir: cfg.data_dir.clone(),
        token,
        instance_id: instance_id.into(),
        initializing: Mutex::new(()),
        ready: Mutex::new(None),
        complete: complete.clone(),
    });
    let status_state = state.clone();
    let static_files = if let Some(path) = &cfg.web_dir {
        Router::new().fallback_service(tower_http::services::ServeDir::new(path).not_found_service(
            tower_http::services::ServeFile::new(path.join("index.html")),
        ))
    } else {
        Router::new().fallback(crate::assets::serve)
    };
    let mut hosts = cfg.allowed_hosts.clone();
    hosts.extend(["localhost".into(), "127.0.0.1".into(), "[::1]".into()]);
    let bind = cfg.bind;
    let app = Router::new()
        .route("/api/status", get(move || { let state = status_state.clone(); async move { Json(json!({"initialized": false, "database_configured": false, "setup_token_required": true, "name": "库存主机", "version": env!("CARGO_PKG_VERSION"), "instance_id": state.instance_id})) } }))
        .route("/api/database/setup", post(configure))
        .fallback_service(static_files)
        .layer(axum::extract::DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::from_fn(move |request, next| { let hosts = hosts.clone(); async move { crate::guard(request, next, &hosts, bind).await } }))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(address=%bind, "请打开网页完成服务器数据库初始化");
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! { _ = complete.notified() => {}, _ = crate::shutdown() => {} }
        })
        .await?;
    state
        .ready
        .lock()
        .await
        .take()
        .ok_or_else(|| anyhow::anyhow!("数据库初始化尚未完成，服务已停止。"))
}

pub async fn configure_cli(dir: &Path) -> anyhow::Result<()> {
    use std::io::Read;
    anyhow::ensure!(
        !dir.join("database.json").exists() && !dir.join("inventory.sqlite").exists(),
        "已有数据库配置或本机库存，不能重新初始化或切换数据库。"
    );
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(bytes.len() <= 16 * 1024, "数据库配置过大。");
    let settings: Settings =
        serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("数据库连接配置格式无效。"))?;
    let db = connect(&settings, dir).await?;
    Migrator::up(&db, None)
        .await
        .map_err(|_| anyhow::anyhow!("数据库初始化失败，请检查数据库版本与账号建表权限。"))?;
    db.close().await?;
    write_private(
        &dir.join("database.json"),
        &serde_json::to_vec_pretty(&settings)?,
    )?;
    Ok(())
}

// Only whitelist public diagnostic fields; never serialize Settings or URLs.
pub fn diagnostics(cfg: &crate::Config) -> serde_json::Value {
    if cfg.database_url.is_some() {
        return json!({"kind":"MySQL", "source":"ERP_DATABASE_URL / --database-url", "location":"外部连接（连接串已隐藏）"});
    }
    let path = cfg.data_dir.join("database.json");
    match std::fs::read(&path)
        .ok()
        .and_then(|v| serde_json::from_slice::<Settings>(&v).ok())
    {
        Some(Settings::Mysql {
            host,
            port,
            database,
            tls,
            ..
        }) => {
            json!({"kind":"MySQL", "source":"database.json", "location":format!("{host}:{port}/{database}"), "tls":tls})
        }
        _ => {
            json!({"kind":"SQLite", "source":if path.exists() { "database.json" } else { "数据目录默认值" }, "location":std::path::absolute(cfg.data_dir.join("inventory.sqlite")).ok()})
        }
    }
}
