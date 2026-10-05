//! SQLite snapshot strategy. Public handlers never accept arbitrary filesystem paths.
use crate::{
    auth::{User, current},
    db::*,
    error::{ApiError, Result},
    state::AppState,
};
use axum::{
    Json,
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, header},
    response::{IntoResponse, Response},
};
use sea_orm::{
    ConnectOptions, Database,
    sqlx::{self, Acquire},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
};

const FORMAT: u32 = 1;
const MAX_SNAPSHOT: u64 = 512 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
struct Manifest {
    format: u32,
    created_at: i64,
    sha256: String,
    schema: Vec<String>,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Schedule {
    pub enabled: bool,
    pub hour: u32,
    pub interval: String,
    pub keep_daily: usize,
    pub keep_weekly: usize,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            enabled: true,
            hour: 18,
            interval: "daily".into(),
            keep_daily: 7,
            keep_weekly: 4,
        }
    }
}
#[derive(Serialize)]
pub struct BackupInfo {
    name: String,
    created_at: i64,
    size: u64,
}

fn local(peer: SocketAddr) -> Result<()> {
    if peer.ip().is_loopback() {
        Ok(())
    } else {
        Err(ApiError::forbidden())
    }
}
fn archive_path(s: &AppState, name: &str) -> Result<PathBuf> {
    if !(name.ends_with(".zip") || name.ends_with(".erpbackup"))
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.')
        || name.len() > 100
    {
        return Err(ApiError::bad("备份文件名无效。"));
    }
    Ok(s.data_dir.join("backups").join(name))
}
fn file_hash(path: &FsPath) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(hex::encode(hash.finalize()))
}
async fn schemas(db: &sea_orm::DatabaseConnection) -> Result<Vec<String>> {
    // Sessions are revoked, never restored. Their idle policy does not change
    // the business backup format or invalidate existing inventory backups.
    Ok(all(
        db,
        "SELECT version FROM seaql_migrations WHERE version <> 'session_idle_v1' ORDER BY version",
        vec![],
    )
    .await?
    .iter()
    .map(|r| text(r, "version"))
    .collect())
}
pub async fn create(s: &AppState, actor: &User) -> Result<BackupInfo> {
    let _backup = s.backup_lock.lock().await;
    let dir = s.data_dir.join("backups");
    tokio::fs::create_dir_all(&dir).await?;
    let stage = tempfile::tempdir_in(&dir)?;
    let snapshot = stage.path().join("inventory.sqlite");
    execute(
        &s.db,
        "VACUUM INTO ?",
        vec![snapshot.to_string_lossy().to_string().into()],
    )
    .await?;
    let checked = validate_database(&snapshot).await?;
    checked.close().await?;
    let created_at = now();
    let name = format!(
        "backup-{}-{}.zip",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        &id()[..8]
    );
    let schema = schemas(&s.db).await?;
    let temporary = stage.path().join("snapshot.zip");
    let target = dir.join(&name);
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let manifest = Manifest {
            format: FORMAT,
            created_at,
            sha256: file_hash(&snapshot)?,
            schema,
        };
        let output = std::fs::File::create(&temporary)?;
        let mut zip = zip::ZipWriter::new(output);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("manifest.json", options)?;
        zip.write_all(&serde_json::to_vec(&manifest)?)?;
        zip.start_file("inventory.sqlite", options)?;
        std::io::copy(&mut std::fs::File::open(snapshot)?, &mut zip)?;
        zip.finish()?.sync_all()?;
        std::fs::rename(temporary, target)?;
        Ok(())
    })
    .await
    .map_err(|_| ApiError::bad("备份任务未完成，请重试。"))??;
    let info = BackupInfo {
        name: name.clone(),
        created_at,
        size: tokio::fs::metadata(dir.join(&name)).await?.len(),
    };
    audit(&s.db, actor, "完成备份", &name, json!({"size":info.size})).await?;
    save_value(s, "backup_last_success", &created_at.to_string()).await?;
    save_value(s, "backup_last_error", "").await?;
    prune(s).await?;
    Ok(info)
}
async fn validate_database(path: &FsPath) -> Result<sea_orm::DatabaseConnection> {
    let path = path.to_owned();
    let mut options = ConnectOptions::new("sqlite://backup");
    options
        .max_connections(1)
        .sqlx_logging(false)
        .map_sqlx_sqlite_opts(move |options| options.filename(&path).read_only(true));
    let db = Database::connect(options).await?;
    let row = one(&db, "PRAGMA integrity_check", vec![])
        .await?
        .ok_or_else(|| ApiError::bad("备份数据库为空。"))?;
    if text(&row, "integrity_check") != "ok" {
        return Err(ApiError::bad(
            "备份里的数据不完整，不能恢复，请选择其他备份。",
        ));
    }
    let mismatches=one(&db,"SELECT COUNT(*) AS total FROM items i WHERE i.balance<>COALESCE((SELECT SUM(delta) FROM document_lines WHERE item_id=i.id),0)",vec![]).await?.unwrap();
    if int(&mismatches, "total") != 0 {
        return Err(ApiError::bad(
            "备份中的库存数量与出入库记录对不上，不能恢复，请选择其他备份。",
        ));
    }
    Ok(db)
}
pub async fn settings(s: &AppState) -> Result<Schedule> {
    let value = one(
        &s.db,
        "SELECT value FROM settings WHERE id='backup_schedule'",
        vec![],
    )
    .await?;
    Ok(value
        .and_then(|r| serde_json::from_str(&text(&r, "value")).ok())
        .unwrap_or_default())
}
async fn save_value(s: &AppState, key: &str, value: &str) -> Result<()> {
    execute(&s.db,"INSERT INTO settings (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",vec![key.into(),value.into()]).await?;
    Ok(())
}
async fn value(s: &AppState, key: &str) -> Result<String> {
    Ok(one(
        &s.db,
        "SELECT value FROM settings WHERE id=?",
        vec![key.into()],
    )
    .await?
    .map(|r| text(&r, "value"))
    .unwrap_or_default())
}
pub async fn list(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    current(&s, &headers).await?.admin()?;
    Ok(Json(
        json!({"items":files(&s).await?,"schedule":settings(&s).await?,"last_success":value(&s,"backup_last_success").await?,"last_error":value(&s,"backup_last_error").await?}),
    ))
}
pub async fn manual(
    State(s): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Result<Json<BackupInfo>> {
    local(peer)?;
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    Ok(Json(create(&s, &actor).await?))
}
pub async fn update_schedule(
    State(s): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(input): Json<Schedule>,
) -> Result<Json<Value>> {
    local(peer)?;
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    if input.hour > 23
        || !matches!(input.interval.as_str(), "hourly" | "daily")
        || !(1..=365).contains(&input.keep_daily)
        || !(1..=52).contains(&input.keep_weekly)
    {
        return Err(ApiError::bad(
            "请设置 0–23 时、1–365 个日备份和 1–52 个周备份。",
        ));
    }
    let _lock = s.writes.lock().await;
    save_value(
        &s,
        "backup_schedule",
        &serde_json::to_string(&input).unwrap(),
    )
    .await?;
    audit(&s.db, &actor, "修改备份计划", "", json!(input)).await?;
    Ok(Json(json!({"ok":true})))
}
async fn files(s: &AppState) -> Result<Vec<BackupInfo>> {
    let dir = s.data_dir.join("backups");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = tokio::fs::read_dir(dir).await?;
    let mut results = vec![];
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        if !(name.ends_with(".zip") || name.ends_with(".erpbackup")) {
            continue;
        }
        let meta = entry.metadata().await?;
        if !meta.is_file() {
            continue;
        }
        results.push(BackupInfo {
            name,
            created_at: meta
                .modified()?
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
            size: meta.len(),
        });
    }
    results.sort_by_key(|a| std::cmp::Reverse(a.created_at));
    Ok(results)
}
async fn prune(s: &AppState) -> Result<()> {
    let settings = settings(s).await?;
    let files = files(s).await?;
    let mut days = std::collections::HashSet::new();
    let mut weeks = std::collections::HashSet::new();
    let mut hours = std::collections::HashSet::new();
    for f in files {
        let d = chrono::DateTime::from_timestamp_millis(f.created_at).unwrap();
        let day = d.format("%Y-%m-%d").to_string();
        let week = d.format("%G-%V").to_string();
        let hour = d.format("%Y-%m-%d-%H").to_string();
        let keep_day = days.len() < settings.keep_daily && days.insert(day);
        let keep_week = weeks.len() < settings.keep_weekly && weeks.insert(week);
        let keep_hour = settings.interval == "hourly" && hours.len() < 24 && hours.insert(hour);
        if !keep_day && !keep_week && !keep_hour {
            tokio::fs::remove_file(archive_path(s, &f.name)?).await?;
        }
    }
    Ok(())
}
pub async fn download(
    State(s): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(name): Path<String>,
) -> Result<Response> {
    local(peer)?;
    current(&s, &headers).await?.admin()?;
    let bytes = tokio::fs::read(archive_path(&s, &name)?).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{name}\""),
            ),
        ],
        bytes,
    )
        .into_response())
}
#[derive(Deserialize)]
pub struct Restore {
    name: String,
    confirmation: String,
}
pub async fn restore(
    State(s): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(input): Json<Restore>,
) -> Result<Json<Value>> {
    local(peer)?;
    let _maintenance = s.maintenance.write().await;
    if s.updating.load(std::sync::atomic::Ordering::Acquire) {
        return Err(ApiError::conflict("库存电脑正在更新，请稍后恢复备份。"));
    }
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    if input.confirmation != "恢复全部数据" {
        return Err(ApiError::bad(
            "请填写“恢复全部数据”确认，恢复后将退出所有账号。",
        ));
    }
    let original = archive_path(&s, &input.name)?;
    let stage = tempfile::tempdir_in(&s.data_dir)?;
    let snapshot = stage.path().join("restore.sqlite");
    let dest = snapshot.clone();
    let manifest = tokio::task::spawn_blocking(move || -> Result<Manifest> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(original)?)
            .map_err(|_| ApiError::bad("不是有效的完整备份文件。"))?;
        let mut text = String::new();
        zip.by_name("manifest.json")
            .map_err(|_| ApiError::bad("备份缺少清单。"))?
            .take(65536)
            .read_to_string(&mut text)?;
        let manifest: Manifest =
            serde_json::from_str(&text).map_err(|_| ApiError::bad("备份清单格式不正确。"))?;
        if manifest.format != FORMAT {
            return Err(ApiError::bad("不支持此备份格式版本。"));
        }
        {
            let file = zip
                .by_name("inventory.sqlite")
                .map_err(|_| ApiError::bad("备份缺少数据库。"))?;
            if file.size() > MAX_SNAPSHOT {
                return Err(ApiError::bad("备份超过当前恢复大小限制。"));
            }
            std::io::copy(
                &mut file.take(MAX_SNAPSHOT + 1),
                &mut std::fs::File::create(&dest)?,
            )?;
        }
        if file_hash(&dest)? != manifest.sha256 {
            return Err(ApiError::bad(
                "备份文件可能已损坏，不能恢复，请选择其他备份。",
            ));
        }
        Ok(manifest)
    })
    .await
    .map_err(|_| ApiError::bad("无法读取备份。"))??;
    if manifest.schema != schemas(&s.db).await? {
        return Err(ApiError::bad(
            "备份数据库版本不同，请使用匹配版本的软件恢复。",
        ));
    }
    let validation = validate_database(&snapshot).await?;
    validation.close().await?;
    // Snapshot current data first. Failure leaves all current data untouched.
    let before = create(&s, &actor).await?;
    let _writes = s.writes.lock().await;
    let mut connection =
        s.db.get_sqlite_connection_pool()
            .acquire()
            .await
            .map_err(ApiError::from)?;
    sqlx::query("ATTACH DATABASE ? AS restore_source")
        .bind(snapshot.to_string_lossy().as_ref())
        .execute(&mut *connection)
        .await
        .map_err(ApiError::from)?;
    let outcome: Result<()> = async {
        let mut txn = connection.begin().await.map_err(ApiError::from)?;
        const TABLES: &[&str] = &[
            "sessions",
            "document_lines",
            "stocktake_lines",
            "requests",
            "audit",
            "documents",
            "stocktakes",
            "items",
            "users",
            "settings",
        ];
        // Identifiers come only from this compile-time allowlist, never from backup/user data.
        for table in TABLES {
            sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {table}")))
                .execute(&mut *txn)
                .await
                .map_err(ApiError::from)?;
        }
        for table in TABLES.iter().rev().filter(|&&name| name != "sessions") {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "INSERT INTO {table} SELECT * FROM restore_source.{table}"
            )))
            .execute(&mut *txn)
            .await
            .map_err(ApiError::from)?;
        }
        sqlx::query("INSERT INTO audit VALUES (?,?,?,?,?,?,?)")
            .bind(id())
            .bind(&actor.id)
            .bind(&actor.name)
            .bind("恢复全部数据")
            .bind(&input.name)
            .bind(
                json!({"restore_point":manifest.created_at,"before_backup":before.name})
                    .to_string(),
            )
            .bind(now())
            .execute(&mut *txn)
            .await
            .map_err(ApiError::from)?;
        txn.commit().await.map_err(ApiError::from)?;
        Ok(())
    }
    .await;
    let detached = sqlx::query("DETACH DATABASE restore_source")
        .execute(&mut *connection)
        .await;
    if detached.is_err() {
        connection.close().await.map_err(ApiError::from)?;
    }
    outcome?;
    Ok(Json(
        json!({"ok":true,"message":"数据已恢复，请重新登录。"}),
    ))
}
pub async fn scheduler(s: AppState) {
    use chrono::Timelike;
    let mut timer = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        timer.tick().await;
        let _maintenance = s.maintenance.read().await;
        if s.updating.load(std::sync::atomic::Ordering::Acquire) {
            return;
        }
        let result: Result<()> = async {
            if one(&s.db, "SELECT id FROM users LIMIT 1", vec![])
                .await?
                .is_none()
            {
                return Ok(());
            }
            let cfg = settings(&s).await?;
            if !cfg.enabled {
                return Ok(());
            }
            let last = value(&s, "backup_last_success")
                .await?
                .parse::<i64>()
                .unwrap_or(0);
            let now_local = chrono::Local::now();
            let due = if cfg.interval == "hourly" {
                now() - last >= 3_600_000
            } else {
                now_local.hour() >= cfg.hour
                    && chrono::DateTime::from_timestamp_millis(last)
                        .map(|d| {
                            d.with_timezone(&chrono::Local).date_naive() != now_local.date_naive()
                        })
                        .unwrap_or(true)
            };
            if due {
                let system = User {
                    id: "system".into(),
                    username: "system".into(),
                    name: "自动备份".into(),
                    role: "admin".into(),
                    can_in: false,
                    can_out: false,
                    can_count: false,
                    active: true,
                };
                create(&s, &system).await?;
            }
            Ok(())
        }
        .await;
        if let Err(error) = result {
            tracing::error!(?error, "scheduled backup failed");
            let _ = save_value(&s, "backup_last_error", &error.1).await;
        }
    }
}
