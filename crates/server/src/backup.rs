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
use sea_orm_migration::MigratorTrait;
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
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    photo_count: Option<u64>,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Schedule {
    // Read older saved settings without keeping their obsolete scheduling options.
    #[serde(alias = "keep_daily")]
    pub keep_days: usize,
}
impl Default for Schedule {
    fn default() -> Self {
        Self { keep_days: 7 }
    }
}
#[derive(Serialize)]
pub struct BackupInfo {
    name: String,
    created_at: i64,
    size: u64,
    snapshot_at: Option<i64>,
    source: Option<String>,
    photo_count: Option<u64>,
    path: String,
    metadata_error: bool,
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
pub async fn create(s: &AppState, actor: &User, source: &str) -> Result<BackupInfo> {
    let _backup = s.backup_lock.lock().await;
    let info = snapshot(&s.db, &s.data_dir, source).await?;
    audit(
        &s.db,
        actor,
        "完成备份",
        &info.name,
        json!({"size":info.size}),
    )
    .await?;
    save_value(s, "backup_last_success", &info.created_at.to_string()).await?;
    save_value(s, "backup_last_error", "").await?;
    prune(s).await?;
    Ok(info)
}

/// Also used before installer migrations, while holding the data-directory lock.
pub async fn snapshot(
    db: &sea_orm::DatabaseConnection,
    data_dir: &FsPath,
    source: &str,
) -> Result<BackupInfo> {
    let dir = data_dir.join("backups");
    tokio::fs::create_dir_all(&dir).await?;
    let stage = tempfile::tempdir_in(&dir)?;
    let snapshot = stage.path().join("inventory.sqlite");
    execute(
        db,
        "VACUUM INTO ?",
        vec![snapshot.to_string_lossy().to_string().into()],
    )
    .await?;
    if tokio::fs::metadata(&snapshot).await?.len() > MAX_SNAPSHOT {
        return Err(ApiError::bad(
            "数据库（含凭证图片）超过当前 512 MB 备份上限，请联系管理员扩容。",
        ));
    }
    let checked = validate_database(&snapshot).await?;
    let photo_count = if one(
        &checked,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sales_attachments'",
        vec![],
    )
    .await?
    .is_some()
    {
        int(
            &one(
                &checked,
                "SELECT COUNT(*) AS total FROM sales_attachments",
                vec![],
            )
            .await?
            .unwrap(),
            "total",
        ) as u64
    } else {
        0
    };
    checked.close().await?;
    let created_at = now();
    let name = format!(
        "backup-{}-{}.zip",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        &id()[..8]
    );
    let schema = schemas(db).await?;
    let temporary = stage.path().join("snapshot.zip");
    let target = dir.join(&name);
    let path = tokio::fs::canonicalize(&dir)
        .await?
        .join(&name)
        .to_string_lossy()
        .to_string();
    let source = source.to_string();
    let manifest_source = source.clone();
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let manifest = Manifest {
            format: FORMAT,
            created_at,
            sha256: file_hash(&snapshot)?,
            schema,
            source: Some(manifest_source),
            photo_count: Some(photo_count),
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
        snapshot_at: Some(created_at),
        source: Some(source),
        photo_count: Some(photo_count),
        path,
        metadata_error: false,
    };
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
    crate::sales::validate_backup(&db).await?;
    crate::roles::validate_backup(&db).await?;
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
        json!({"items":files(&s, true).await?,"schedule":settings(&s).await?,"last_success":value(&s,"backup_last_success").await?,"last_error":value(&s,"backup_last_error").await?}),
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
    Ok(Json(create(&s, &actor, "manual").await?))
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
    if !(1..=365).contains(&input.keep_days) {
        return Err(ApiError::bad("备份保留天数须为 1–365 的整数。"));
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
fn read_manifest(zip: &mut zip::ZipArchive<std::fs::File>) -> Result<Manifest> {
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
    Ok(manifest)
}

async fn files(s: &AppState, details: bool) -> Result<Vec<BackupInfo>> {
    let dir = s.data_dir.join("backups");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let dir = tokio::fs::canonicalize(dir).await?;
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
        let mut info = BackupInfo {
            name,
            created_at: meta
                .modified()?
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
            size: meta.len(),
            snapshot_at: None,
            source: None,
            photo_count: None,
            path: entry.path().to_string_lossy().to_string(),
            metadata_error: false,
        };
        if details {
            let path = entry.path();
            let metadata = tokio::task::spawn_blocking(move || -> Result<Manifest> {
                let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)
                    .map_err(|_| ApiError::bad("无法读取备份信息。"))?;
                read_manifest(&mut zip)
            })
            .await;
            match metadata {
                Ok(Ok(manifest)) if (0..=8_640_000_000_000_000).contains(&manifest.created_at) => {
                    info.snapshot_at = Some(manifest.created_at);
                    info.source = manifest.source;
                    info.photo_count = manifest.photo_count;
                }
                _ => info.metadata_error = true,
            }
        }
        results.push(info);
    }
    results.sort_by_key(|a| std::cmp::Reverse(a.created_at));
    Ok(results)
}
async fn prune(s: &AppState) -> Result<()> {
    let settings = settings(s).await?;
    let files = files(s, false).await?;
    let cutoff = now() - settings.keep_days as i64 * 86_400_000;
    // Keep every snapshot within the requested period, and always retain the newest.
    // create() calls this only after a complete, validated ZIP has been saved.
    for f in files.into_iter().skip(1) {
        if f.created_at < cutoff {
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
        let manifest = read_manifest(&mut zip)?;
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
    let current_schema = schemas(&s.db).await?;
    // Only known older business schemas can be staged forward.
    let legacy = manifest.schema.len() < current_schema.len()
        && [
            current_schema
                .iter()
                .filter(|v| v.as_str() != "material_options_meta_v1")
                .cloned()
                .collect::<Vec<_>>(),
            current_schema
                .iter()
                .filter(|v| !["material_options_meta_v1", "roles_v1"].contains(&v.as_str()))
                .cloned()
                .collect::<Vec<_>>(),
            current_schema
                .iter()
                .filter(|v| {
                    ![
                        "material_options_meta_v1",
                        "roles_v1",
                        "material_options_v1",
                    ]
                    .contains(&v.as_str())
                })
                .cloned()
                .collect::<Vec<_>>(),
            current_schema
                .iter()
                .filter(|v| {
                    ![
                        "material_options_meta_v1",
                        "roles_v1",
                        "material_options_v1",
                        "sales_v1",
                    ]
                    .contains(&v.as_str())
                })
                .cloned()
                .collect::<Vec<_>>(),
        ]
        .contains(&manifest.schema);
    if manifest.schema != current_schema && !legacy {
        return Err(ApiError::bad(
            "备份数据库版本不同，请使用匹配版本的软件恢复。",
        ));
    }
    let validation = validate_database(&snapshot).await?;
    if schemas(&validation).await? != manifest.schema {
        return Err(ApiError::bad("备份清单与数据库版本不一致。"));
    }
    validation.close().await?;
    if legacy {
        // Upgrade only the temporary source; the live database is untouched until
        // validation and a safety backup have both succeeded.
        let source = snapshot.clone();
        let mut options = ConnectOptions::new("sqlite://restore-stage");
        options
            .max_connections(1)
            .map_sqlx_sqlite_opts(move |o| o.filename(&source));
        let staged = Database::connect(options).await?;
        crate::migration::Migrator::up(&staged, None).await?;
        crate::roles::validate_backup(&staged).await?;
        staged.close().await?;
    }
    // Snapshot current data first. Failure leaves all current data untouched.
    let before = create(&s, &actor, "restore").await?;
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
            "sales_attachments",
            "sales_returns",
            "sales_inventory",
            "sales_cash",
            "sales_revisions",
            "sales",
            "sales_catalog",
            "material_options",
            "sessions",
            "document_lines",
            "stocktake_lines",
            "requests",
            "audit",
            "documents",
            "stocktakes",
            "items",
            "users",
            "roles",
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
fn backup_due(last_success: i64, current_time: i64) -> bool {
    current_time.saturating_sub(last_success) >= 3_600_000
}

pub async fn scheduler(s: AppState) {
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
            let last = value(&s, "backup_last_success")
                .await?
                .parse::<i64>()
                .unwrap_or(0);
            if backup_due(last, now()) {
                let system = User {
                    id: "system".into(),
                    username: "system".into(),
                    name: "自动备份".into(),
                    role: "admin".into(),
                    role_name: "管理员".into(),
                    permissions: vec![],
                    can_in: false,
                    can_out: false,
                    can_count: false,
                    active: true,
                };
                create(&s, &system, "automatic").await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hourly_schedule_handles_restart_and_clock_rollback() {
        assert!(!backup_due(1_000, 3_600_999));
        assert!(backup_due(1_000, 3_601_000));
        assert!(backup_due(1_000, 9_000_000));
        assert!(!backup_due(9_000_000, 1_000));
    }

    #[test]
    fn old_settings_keep_retention_but_no_longer_control_frequency() {
        let schedule: Schedule = serde_json::from_value(json!({
            "enabled": false, "hour": 18, "interval": "daily",
            "keep_daily": 14, "keep_weekly": 4
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(schedule).unwrap(),
            json!({"keep_days": 14})
        );
        assert_eq!(Schedule::default().keep_days, 7);
    }
}
