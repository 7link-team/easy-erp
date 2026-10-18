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
    ConnectOptions, Database, DbBackend,
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
const MAX_SNAPSHOT: u64 = 16 * 1024 * 1024 * 1024;
const SPACE_MARGIN: u64 = 256 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
pub(crate) struct Manifest {
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
#[derive(Serialize, Deserialize)]
pub struct BackupInfo {
    name: String,
    created_at: i64,
    size: u64,
    snapshot_at: Option<i64>,
    source: Option<String>,
    photo_count: Option<u64>,
    path: String,
    metadata_error: bool,
    #[serde(skip)]
    backend: String,
    #[serde(skip)]
    key: String,
}

fn local(peer: SocketAddr, server_mode: bool) -> Result<()> {
    if peer.ip().is_loopback() || server_mode {
        Ok(())
    } else {
        Err(ApiError::forbidden())
    }
}
fn validate_name(name: &str) -> Result<()> {
    if !(name.ends_with(".zip") || name.ends_with(".erpbackup"))
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.')
        || name.len() > 100
    {
        return Err(ApiError::bad("备份文件名无效。"));
    }
    Ok(())
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
        "SELECT version FROM seaql_migrations WHERE version NOT IN ('session_idle_v1','query_indexes_v1') ORDER BY version",
        vec![],
    )
    .await?
    .iter()
    .map(|r| text(r, "version"))
    .collect())
}
async fn database_size(db: &sea_orm::DatabaseConnection) -> Result<u64> {
    if db.get_database_backend() == DbBackend::MySql {
        let row = one(db, "SELECT COALESCE(SUM(data_length+index_length),0) AS total FROM information_schema.tables WHERE table_schema=DATABASE()", vec![]).await?.unwrap();
        return Ok(int(&row, "total") as u64);
    }
    let pages = int(
        &one(db, "PRAGMA page_count", vec![]).await?.unwrap(),
        "page_count",
    ) as u64;
    let size = int(
        &one(db, "PRAGMA page_size", vec![]).await?.unwrap(),
        "page_size",
    ) as u64;
    Ok(pages.saturating_mul(size))
}
fn check_space(path: &FsPath, required: u64) -> Result<()> {
    if fs2::available_space(path)? < required {
        return Err(ApiError::bad(format!(
            "磁盘空间不足，需至少 {:.1} GiB 可用空间完成备份或恢复；请释放空间后重试，已有备份不会删除。",
            required as f64 / 1073741824.
        )));
    }
    Ok(())
}
pub async fn create(s: &AppState, actor: &User, source: &str) -> Result<BackupInfo> {
    let _backup = s.backup_lock.lock().await;
    let info = snapshot_with_storage(&s.db, &s.data_dir, source, &s.files).await?;
    // These are live-database writes, and they are the only ones in this module
    // that did not take the mutex every other writer holds. Without it a backup
    // can commit between a request transaction's read snapshot and its write,
    // and SQLite answers that request with SQLITE_BUSY_SNAPSHOT (517), which
    // busy_timeout does not retry — so a background backup could make a user's
    // save fail. prune() below touches only storage, so it stays outside.
    {
        let _writes = s.writes.lock().await;
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
    }
    // Retention drives irreversible deletion, so a damaged or missing policy file
    // must never be silently replaced by the default here: that would rewrite the
    // file with 7 days and prune everything older. Keep the archives, leave the
    // file alone, and let the backups page rewrite it deliberately.
    match stored_policy(s).await? {
        // Absent is the normal pre-first-backup state: publish the effective
        // policy and prune as before.
        Policy::Valid(_) | Policy::Absent => {
            let policy = settings(s).await?;
            s.files
                .put(
                    s.files.primary,
                    "backups/policy.json",
                    serde_json::to_vec(&policy).unwrap().into(),
                )
                .await?;
            prune(s).await?;
        }
        // Damaged means the configured retention is unknown. Replacing it with the
        // default would rewrite the file as 7 days and prune everything older, so
        // keep every archive and let the backups page rewrite it deliberately.
        Policy::Damaged => tracing::warn!(
            name = %info.name,
            "备份保留策略文件损坏，已保留全部归档未清理；请在备份页重新保存保留天数"
        ),
    }
    Ok(info)
}

/// Also used before installer migrations, while holding the data-directory lock.
pub async fn snapshot(
    db: &sea_orm::DatabaseConnection,
    data_dir: &FsPath,
    source: &str,
) -> Result<BackupInfo> {
    let files = crate::storage::FileStorage::from_env(data_dir)
        .map_err(|e| ApiError::bad(e.to_string()))?;
    snapshot_with_storage(db, data_dir, source, &files).await
}
async fn snapshot_with_storage(
    db: &sea_orm::DatabaseConnection,
    data_dir: &FsPath,
    source: &str,
    files: &crate::storage::FileStorage,
) -> Result<BackupInfo> {
    let dir = data_dir.join("backup-staging");
    tokio::fs::create_dir_all(&dir).await?;
    let started = std::time::Instant::now();
    let estimated = database_size(db).await?;
    if estimated > MAX_SNAPSHOT {
        return Err(ApiError::bad(
            "数据库超过当前 16 GiB 备份上限，请联系管理员扩容。",
        ));
    }
    check_space(
        data_dir,
        estimated.saturating_mul(3).saturating_add(SPACE_MARGIN),
    )?;
    let stage = tempfile::tempdir_in(&dir)?;
    let snapshot = stage.path().join("inventory.sqlite");
    if db.get_database_backend() == DbBackend::MySql {
        crate::database_copy::snapshot(db, &snapshot).await?;
    } else {
        execute(
            db,
            "VACUUM INTO ?",
            vec![snapshot.to_string_lossy().to_string().into()],
        )
        .await?;
    }
    if tokio::fs::metadata(&snapshot).await?.len() > MAX_SNAPSHOT {
        return Err(ApiError::bad(
            "数据库（含凭证图片）超过当前 16 GiB 备份上限，请联系管理员扩容。",
        ));
    }
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        "备份快照复制完成"
    );
    embed_attachments(&snapshot, files).await?;
    if tokio::fs::metadata(&snapshot).await?.len() > MAX_SNAPSHOT {
        return Err(ApiError::bad(
            "数据库（含凭证图片）超过当前 16 GiB 备份上限。",
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
    tracing::info!(elapsed_ms = started.elapsed().as_millis(), "备份校验完成");
    let created_at = now();
    let name = format!(
        "backup-{}-{}.zip",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        &id()[..8]
    );
    let schema = schemas(db).await?;
    let temporary = stage.path().join("snapshot.zip");
    let target = stage.path().join("complete.zip");
    let archive = target.clone();
    let key = format!("backups/{}/{name}", chrono::Utc::now().format("%Y/%m/%d"));
    let path = files.label(files.primary, &key);
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
        zip.start_file("inventory.sqlite", options.large_file(true))?;
        std::io::copy(&mut std::fs::File::open(snapshot)?, &mut zip)?;
        zip.finish()?.sync_all()?;
        std::fs::rename(temporary, target)?;
        Ok(())
    })
    .await
    .map_err(|_| ApiError::bad("备份任务未完成，请重试。"))??;
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        "备份归档发布完成"
    );
    let info = BackupInfo {
        name: name.clone(),
        created_at,
        size: tokio::fs::metadata(&archive).await?.len(),
        snapshot_at: Some(created_at),
        source: Some(source),
        photo_count: Some(photo_count),
        path,
        metadata_error: false,
        backend: files.primary.into(),
        key: key.clone(),
    };
    files.put_file(files.primary, &key, &archive).await?;
    // Archive is authoritative; missing metadata must never hide a valid backup.
    // The archive is already stored durably here, so a failed sidecar must not
    // fail the backup: that would skip recording success and pruning, leaving
    // the scheduler to rewrite a full archive every tick. Listing falls back to
    // reading the archive's own manifest.
    if let Err(error) = files
        .put(
            files.primary,
            &format!("{key}.json"),
            serde_json::to_vec(&info).unwrap().into(),
        )
        .await
    {
        tracing::warn!(%error, name = %info.name, "备份元数据写入失败，归档已保存");
    }
    Ok(info)
}
async fn embed_attachments(path: &FsPath, files: &crate::storage::FileStorage) -> Result<()> {
    let stage_path = path.to_owned();
    let path = path.to_owned();
    let mut options = ConnectOptions::new("sqlite://backup-images");
    options
        .max_connections(1)
        .sqlx_logging(false)
        .map_sqlx_sqlite_opts(move |o| o.filename(&path));
    let db = Database::connect(options).await?;
    if all(&db, "PRAGMA table_info(sales_attachments)", vec![])
        .await?
        .iter()
        .any(|r| text(r, "name") == "storage_backend")
    {
        let rows = all(&db, "SELECT id,storage_backend,storage_key FROM sales_attachments WHERE storage_backend<>''", vec![]).await?;
        for row in rows {
            let data = files
                .attachment(&text(&row, "storage_backend"), &text(&row, "storage_key"))
                .await?;
            check_space(
                stage_path.parent().unwrap(),
                (data.len() as u64)
                    .saturating_mul(3)
                    .saturating_add(SPACE_MARGIN),
            )?;
            if tokio::fs::metadata(&stage_path)
                .await?
                .len()
                .saturating_add(data.len() as u64)
                > MAX_SNAPSHOT
            {
                return Err(ApiError::bad(
                    "数据库（含凭证图片）超过当前 16 GiB 备份上限。",
                ));
            }
            execute(
                &db,
                "UPDATE sales_attachments SET data=?,storage_backend='',storage_key='' WHERE id=?",
                vec![data.to_vec().into(), text(&row, "id").into()],
            )
            .await?;
        }
    }
    db.close().await?;
    Ok(())
}
pub(crate) async fn validate_database(path: &FsPath) -> Result<sea_orm::DatabaseConnection> {
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
    let mismatches=one(&db,"SELECT COUNT(*) AS total FROM items i LEFT JOIN (SELECT item_id,SUM(delta) AS balance FROM document_lines GROUP BY item_id) l ON l.item_id=i.id WHERE i.balance<>COALESCE(l.balance,0)",vec![]).await?.unwrap();
    if int(&mismatches, "total") != 0 {
        return Err(ApiError::bad(
            "备份中的库存数量与出入库记录对不上，不能恢复，请选择其他备份。",
        ));
    }
    if all(&db, "PRAGMA table_info(sales_attachments)", vec![])
        .await?
        .iter()
        .any(|r| text(r, "name") == "storage_backend")
        && one(
            &db,
            "SELECT id FROM sales_attachments WHERE storage_backend<>'' OR storage_key<>'' LIMIT 1",
            vec![],
        )
        .await?
        .is_some()
    {
        return Err(ApiError::bad("完整备份包含外部图片引用，不能恢复。"));
    }
    crate::sales::validate_backup(&db).await?;
    crate::roles::validate_backup(&db).await?;
    Ok(db)
}
/// Absence and corruption are different: a missing file is the normal state
/// before the first backup, while an unreadable one means the configured
/// retention is unknown and must not be guessed by anything that deletes.
enum Policy {
    Valid(Schedule),
    Absent,
    Damaged,
}
async fn stored_policy(s: &AppState) -> Result<Policy> {
    match s
        .files
        .read(s.files.primary, "backups/policy.json", 65536)
        .await
    {
        Ok(bytes) => Ok(match serde_json::from_slice::<Schedule>(&bytes) {
            Ok(policy) if (1..=365).contains(&policy.keep_days) => Policy::Valid(policy),
            _ => {
                tracing::warn!("备份保留策略文件无效");
                Policy::Damaged
            }
        }),
        Err(e) if e.0 == axum::http::StatusCode::NOT_FOUND => Ok(Policy::Absent),
        Err(e) => Err(e),
    }
}
pub async fn settings(s: &AppState) -> Result<Schedule> {
    // A damaged policy file must not break the backups page, which is the only
    // place that can rewrite it. Fall back to the stored value or the default
    // for display; pruning is handled separately and refuses to guess.
    if let Policy::Valid(policy) = stored_policy(s).await? {
        return Ok(policy);
    }
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
    local(peer, s.server_mode)?;
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
    local(peer, s.server_mode)?;
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    if !(1..=365).contains(&input.keep_days) {
        return Err(ApiError::bad("备份保留天数须为 1–365 的整数。"));
    }
    let _backup = s.backup_lock.lock().await;
    let _lock = s.writes.lock().await;
    s.files
        .put(
            s.files.primary,
            "backups/policy.json",
            serde_json::to_vec(&input).unwrap().into(),
        )
        .await?;
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
    stored_files(&s.files, &s.data_dir, details).await
}
pub(crate) async fn files_in(data_dir: &FsPath, details: bool) -> Result<Vec<BackupInfo>> {
    let storage = crate::storage::FileStorage::from_env(data_dir)
        .map_err(|e| ApiError::bad(e.to_string()))?;
    stored_files(&storage, data_dir, details).await
}
// Only flat legacy archives and our YYYY/MM/DD layout are managed.
fn managed_archive(key: &str) -> bool {
    let parts: Vec<_> = key.split('/').collect();
    if parts.first() != Some(&"backups") {
        return false;
    }
    if parts.len() != 2
        && !(parts.len() == 5
            && parts[1].len() == 4
            && parts[2].len() == 2
            && parts[3].len() == 2
            && parts[1..4]
                .iter()
                .all(|v| v.bytes().all(|c| c.is_ascii_digit())))
    {
        return false;
    }
    validate_name(parts.last().unwrap()).is_ok()
}
async fn copy_archive(
    files: &crate::storage::FileStorage,
    kind: &str,
    key: &str,
    target: &FsPath,
) -> Result<()> {
    use futures::TryStreamExt;
    use tokio::io::AsyncWriteExt;
    let result = files.get(kind, key).await?;
    if result.meta.size > MAX_SNAPSHOT + 1024 * 1024 {
        return Err(ApiError::bad("备份文件超过大小限制。"));
    }
    check_space(
        target.parent().unwrap(),
        result.meta.size.saturating_add(SPACE_MARGIN),
    )?;
    let mut stream = result.into_stream();
    let mut out = tokio::fs::File::create(target).await?;
    while let Some(bytes) = stream
        .try_next()
        .await
        .map_err(crate::storage::storage_error)?
    {
        out.write_all(&bytes).await?;
    }
    out.sync_all().await?;
    Ok(())
}
async fn stored_files(
    storage: &crate::storage::FileStorage,
    data_dir: &FsPath,
    details: bool,
) -> Result<Vec<BackupInfo>> {
    let mut results = vec![];
    for backend in storage.kinds() {
        for object in storage.list(backend, "backups").await? {
            let key = object.location.to_string();
            if !managed_archive(&key) {
                continue;
            }
            let mut info = BackupInfo {
                name: key.rsplit('/').next().unwrap().into(),
                created_at: object.last_modified.timestamp_millis(),
                size: object.size,
                snapshot_at: None,
                source: None,
                photo_count: None,
                path: storage.label(backend, &key),
                metadata_error: false,
                backend: backend.into(),
                key: key.clone(),
            };
            if details {
                let metadata = storage.read(backend, &format!("{key}.json"), 65536).await;
                let cached = metadata
                    .ok()
                    .and_then(|b| serde_json::from_slice::<BackupInfo>(&b).ok())
                    .filter(|v| {
                        v.name == info.name
                            && v.size == info.size
                            && v.snapshot_at
                                .is_some_and(|t| (0..=8_640_000_000_000_000).contains(&t))
                    });
                if let Some(cached) = cached {
                    info.snapshot_at = cached.snapshot_at;
                    info.source = cached.source;
                    info.photo_count = cached.photo_count;
                } else {
                    // Only the S3 path stages the archive; a local read happens
                    // in place, so listing pre-sidecar archives must not create
                    // a temp directory (nor require a writable data dir) per
                    // archive just to read a manifest.
                    let stage = if backend == "s3" {
                        Some(tempfile::tempdir_in(data_dir)?)
                    } else {
                        None
                    };
                    let metadata: Result<Manifest> = async {
                        let archive = if let Some(stage) = stage.as_ref() {
                            let archive = stage.path().join("metadata.zip");
                            copy_archive(storage, backend, &key, &archive).await?;
                            archive
                        } else {
                            // Read the ZIP directory/manifest in place. Copying every
                            // local archive makes listing old backups scale with all
                            // database bytes instead of their small metadata records.
                            PathBuf::from(&info.path)
                        };
                        tokio::task::spawn_blocking(move || {
                            let mut zip = zip::ZipArchive::new(std::fs::File::open(archive)?)
                                .map_err(|_| ApiError::bad("无法读取备份信息。"))?;
                            read_manifest(&mut zip)
                        })
                        .await
                        .map_err(|_| ApiError::bad("无法读取备份信息。"))?
                    }
                    .await;
                    match metadata {
                        Ok(m) if (0..=8_640_000_000_000_000).contains(&m.created_at) => {
                            info.snapshot_at = Some(m.created_at);
                            info.source = m.source;
                            info.photo_count = m.photo_count;
                        }
                        _ => info.metadata_error = true,
                    }
                }
            }
            results.push(info);
        }
    }
    results.sort_by_key(|a| std::cmp::Reverse(a.created_at));
    Ok(results)
}
async fn locate(s: &AppState, name: &str) -> Result<BackupInfo> {
    validate_name(name)?;
    files(s, false)
        .await?
        .into_iter()
        .find(|f| f.name == name)
        .ok_or_else(ApiError::missing)
}
async fn remove_archive(storage: &crate::storage::FileStorage, f: &BackupInfo) -> Result<()> {
    storage.delete(&f.backend, &f.key).await?;
    match storage.delete(&f.backend, &format!("{}.json", f.key)).await {
        Err(e) if e.0 != axum::http::StatusCode::NOT_FOUND => Err(e),
        _ => Ok(()),
    }
}
pub(crate) async fn materialize_remote(
    data_dir: &FsPath,
    source: &str,
    target: &FsPath,
) -> Result<()> {
    let storage = crate::storage::FileStorage::from_env(data_dir)
        .map_err(|e| ApiError::bad(e.to_string()))?;
    let f = stored_files(&storage, data_dir, false)
        .await?
        .into_iter()
        .find(|f| f.backend == "s3" && f.path == source)
        .ok_or_else(ApiError::missing)?;
    copy_archive(&storage, &f.backend, &f.key, target).await
}
pub(crate) async fn clear_in(data_dir: &FsPath) -> Result<usize> {
    let storage = crate::storage::FileStorage::from_env(data_dir)
        .map_err(|e| ApiError::bad(e.to_string()))?;
    let files = stored_files(&storage, data_dir, false).await?;
    let count = files.len();
    for f in files {
        remove_archive(&storage, &f).await?;
    }
    Ok(count)
}
async fn prune(s: &AppState) -> Result<()> {
    let settings = settings(s).await?;
    let files = files(s, false).await?;
    let cutoff = now() - settings.keep_days as i64 * 86_400_000;
    // Keep every snapshot within the requested period, and always retain the newest.
    // create() calls this only after a complete, validated ZIP has been saved.
    for f in files.into_iter().skip(1) {
        if f.created_at < cutoff {
            remove_archive(&s.files, &f).await?;
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
    local(peer, s.server_mode)?;
    current(&s, &headers).await?.admin()?;
    let f = locate(&s, &name).await?;
    let object = s.files.get(&f.backend, &f.key).await?;
    // Without a length the response is chunked, so a stream that breaks midway
    // looks like a finished download and the short file is only caught by the
    // checksum at restore time.
    let size = object.meta.size;
    let mut response = axum::body::Body::from_stream(object.into_stream()).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, size.into());
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/zip"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{name}\"").parse().unwrap(),
    );
    Ok(response)
}
/// Validate/extract in a staging directory; never modify the live database here.
pub(crate) async fn prepare_restore(
    original: PathBuf,
    snapshot: PathBuf,
    space_path: PathBuf,
    live_size: u64,
    current_schema: Vec<String>,
) -> Result<Manifest> {
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
            let expected = file.size();
            check_space(
                &space_path,
                live_size
                    .saturating_mul(4)
                    .saturating_add(expected.saturating_mul(2))
                    .saturating_add(SPACE_MARGIN),
            )?;
            let mut output = std::fs::File::create(&dest)?;
            let copied = std::io::copy(&mut file.take(MAX_SNAPSHOT + 1), &mut output)?;
            if copied > MAX_SNAPSHOT || copied != expected {
                return Err(ApiError::bad("备份数据库大小不一致或超过恢复上限。"));
            }
            output.sync_all()?;
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
    // Only known older business schemas can be staged forward.
    let legacy = manifest.schema.len() < current_schema.len()
        && [
            current_schema.clone(),
            current_schema
                .iter()
                .filter(|v| v.as_str() != "item_prices_v1")
                .cloned()
                .collect::<Vec<_>>(),
            current_schema
                .iter()
                .filter(|v| !["material_options_meta_v1"].contains(&v.as_str()))
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
        .into_iter()
        .any(|schema| {
            [false, true].into_iter().any(|prices| {
                [false, true].into_iter().any(|storage| {
                    schema
                        .iter()
                        .filter(|v| {
                            !(prices && v.as_str() == "item_prices_v1"
                                || storage && v.as_str() == "file_storage_v1")
                        })
                        .cloned()
                        .collect::<Vec<_>>()
                        == manifest.schema
                })
            })
        });
    if manifest.schema != current_schema.to_vec() && !legacy {
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
    Ok(manifest)
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
    local(peer, s.server_mode)?;
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
    let stage = tempfile::tempdir_in(&s.data_dir)?;
    let snapshot = stage.path().join("restore.sqlite");
    let f = locate(&s, &input.name).await?;
    let archive = stage.path().join("restore.zip");
    copy_archive(&s.files, &f.backend, &f.key, &archive).await?;
    let manifest = prepare_restore(
        archive,
        snapshot.clone(),
        s.data_dir.clone(),
        database_size(&s.db).await?,
        schemas(&s.db).await?,
    )
    .await?;
    // Every externalized image is unreferenced once a restore lands: the archive's
    // rows carry their copies inline, because validate_database refuses an archive
    // that still points outside. Nothing would ever reclaim them, since new
    // uploads take fresh ids. The data is already in place by the time this runs,
    // so a cleanup failure must not report the finished restore as failed.
    async fn clear_restored_attachments(s: &AppState) {
        if let Err(error) = s.files.clear_attachments().await {
            tracing::warn!(%error, "数据已恢复，但外置图片清理未完成");
        }
    }
    // Snapshot current data first. Failure leaves all current data untouched.
    let before = create(&s, &actor, "restore").await?;
    let _writes = s.writes.lock().await;
    if s.db.get_database_backend() == DbBackend::MySql {
        crate::database_copy::restore(
            &snapshot,
            &s.db,
            &actor,
            json!({"restore_point":manifest.created_at,"before_backup":before.name}),
        )
        .await?;
        clear_restored_attachments(&s).await;
        return Ok(Json(
            json!({"ok":true,"message":"数据已恢复，请重新登录。"}),
        ));
    }
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
    clear_restored_attachments(&s).await;
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
            // Same reason as the writes in create(): serialize with the other
            // writers so recording a failure cannot disturb a live request.
            let _writes = s.writes.lock().await;
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
