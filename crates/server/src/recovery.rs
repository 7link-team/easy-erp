//! Offline maintenance, always under the same directory lock as the HTTP service.
use crate::{backup, db, migration::Migrator};
use anyhow::{Context, Result, bail, ensure};
use clap::ValueEnum;
use sea_orm::{ConnectOptions, Database};
use sea_orm_migration::MigratorTrait;
use serde_json::{Value, json};
use std::{fs, io::Write, path::Path};

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Action {
    List,
    Reset,
    Restore,
    ClearBackups,
}
const PENDING: &str = ".recovery-pending";
const DATA_FILES: &[&str] = &[
    "inventory.sqlite",
    "inventory.sqlite-wal",
    "inventory.sqlite-shm",
    "inventory.sqlite-journal",
    "instance-id",
];

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub fn regular_or_absent(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            ensure!(
                meta.is_file() && !is_link(&meta),
                "不是普通文件，已停止维护：{}",
                path.display()
            );
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
pub(crate) fn directory_or_absent(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            ensure!(
                meta.is_dir() && !is_link(&meta),
                "不是普通目录，已停止维护：{}",
                path.display()
            );
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::File::open(path)?.sync_all()?;
    let _ = path;
    Ok(())
}

/// Finish an interrupted, already confirmed replacement before opening SQLite.
/// The new database is validated and synced before the journal is published.
pub async fn finish_pending(data_dir: &Path) -> Result<()> {
    let pending = data_dir.join(PENDING);
    if !directory_or_absent(&pending)? {
        return Ok(());
    }
    let manifest = pending.join("files.json");
    if !regular_or_absent(&manifest)? {
        let old = pending.join("old");
        if directory_or_absent(&old)? && fs::read_dir(&old)?.next().is_none() {
            fs::remove_dir(&old)?;
        }
        ensure!(
            fs::read_dir(&pending)?.next().is_none(),
            "维护记录不完整，请保留现场并联系管理员。"
        );
        fs::remove_dir(&pending)?;
        return Ok(());
    }
    let files: Vec<String> = serde_json::from_slice(&fs::read(&manifest)?)?;
    ensure!(
        files.iter().all(|name| DATA_FILES.contains(&name.as_str())),
        "维护记录包含无效文件。"
    );
    let replacement = pending.join("new.sqlite");
    let old = pending.join("old");
    let old_exists = directory_or_absent(&old)?;
    if regular_or_absent(&replacement)? {
        ensure!(old_exists, "维护记录缺少原数据目录。");
        for name in &files {
            let source = data_dir.join(name);
            let dest = old.join(name);
            if !regular_or_absent(&dest)? && regular_or_absent(&source)? {
                fs::rename(source, dest)?;
            }
        }
        sync_dir(&old)?;
        sync_dir(data_dir)?;
        fs::rename(replacement, data_dir.join("inventory.sqlite"))?;
        sync_dir(data_dir)?;
        sync_dir(&pending)?;
    } else {
        ensure!(
            regular_or_absent(&data_dir.join("inventory.sqlite"))?,
            "维护未完成，缺少新数据库。请保留现场并联系管理员。"
        );
    }
    // Replay reports before applying incoming connection settings, using the destination's
    // configured storage. Keep the journal until every private upload succeeds.
    if regular_or_absent(&pending.join("reports.json"))? {
        let storage = crate::storage::FileStorage::from_env(data_dir)?;
        backup::restore_reports(&pending, &storage)
            .await
            .map_err(|e| anyhow::anyhow!(e.1))?;
        fs::remove_file(pending.join("reports.json"))?;
    }
    if directory_or_absent(&pending.join("reports"))? {
        fs::remove_dir_all(pending.join("reports"))?;
    }
    // Replay private configuration separately; reset never stages this directory.
    backup::restore_configs(&pending, data_dir).map_err(|e| anyhow::anyhow!(e.1))?;
    if directory_or_absent(&pending.join("config"))? {
        fs::remove_dir_all(pending.join("config"))?;
    }
    // The committed database is in place. Backups are never in this allowlist.
    for name in &files {
        let path = old.join(name);
        if regular_or_absent(&path)? {
            fs::remove_file(path)?;
        }
    }
    // Leave the empty old directory until the journal itself is gone so a crash
    // during cleanup can safely re-enter this function.
    if old_exists {
        sync_dir(&old)?;
    }
    fs::remove_file(manifest)?;
    sync_dir(&pending)?;
    if old_exists {
        fs::remove_dir(old)?;
    }
    fs::remove_dir(pending)?;
    sync_dir(data_dir)?;
    Ok(())
}

pub async fn list(data_dir: &Path) -> Result<Value> {
    let exists = directory_or_absent(data_dir)?;
    let data_dir = if exists {
        fs::canonicalize(data_dir)?
    } else {
        std::path::absolute(data_dir)?
    };
    directory_or_absent(&data_dir.join("backups"))?;
    let storage = crate::storage::FileStorage::from_env(&data_dir)?;
    let backups = storage.backups();
    let mut kinds = storage.kinds();
    for kind in backups.kinds() {
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    Ok(json!({
        "data_dir":data_dir, "backups_dir":backups.label(backups.primary, "backups"),
        "has_data":regular_or_absent(&data_dir.join("inventory.sqlite"))?,
        "items":backup::files_in(&data_dir, true).await.map_err(|e| anyhow::anyhow!(e.1))?,
        "pending":data_dir.join(PENDING).exists(),
        "storage_locations": kinds.iter().map(|kind| json!({
            "kind":kind,
            "backups":backups.kinds().contains(kind).then(|| backups.label(kind, "backups")),
            "attachments":storage.kinds().contains(kind).then(|| storage.label(kind, "attachments"))
        })).collect::<Vec<_>>(),
    }))
}

pub async fn run(
    data_dir: &Path,
    action: Action,
    source: Option<&Path>,
    confirmation: &str,
) -> Result<Value> {
    let required = match action {
        Action::Reset => "清空全部数据",
        Action::Restore => "恢复全部数据",
        Action::ClearBackups => "清空全部备份",
        Action::List => return list(data_dir).await,
    };
    ensure!(confirmation == required, "请输入“{required}”确认操作。");
    directory_or_absent(data_dir)?;
    directory_or_absent(&data_dir.join("backups"))?;
    finish_pending(data_dir).await?;
    if action == Action::ClearBackups {
        let count = backup::clear_in(data_dir)
            .await
            .map_err(|e| anyhow::anyhow!(e.1))?;
        return Ok(json!({"message":"备份文件已清空，当前数据未清空。", "deleted":count}));
    }
    for name in DATA_FILES {
        regular_or_absent(&data_dir.join(name))?;
    }
    let stage = tempfile::Builder::new()
        .prefix(".recovery-stage-")
        .tempdir_in(data_dir)?;
    let new_db = stage.path().join("new.sqlite");
    let previous_storage = if action == Action::Restore {
        Some(crate::storage::FileStorage::from_env(data_dir)?)
    } else {
        None
    };
    if action == Action::Restore {
        let source = source.context("请选择要恢复的完整备份文件。")?;
        let remote = stage.path().join("source.zip");
        let source = if source.to_string_lossy().starts_with("s3://") {
            backup::materialize_remote(data_dir, &source.to_string_lossy(), &remote)
                .await
                .map_err(|e| anyhow::anyhow!(e.1))?;
            remote.as_path()
        } else {
            source
        };
        ensure!(regular_or_absent(source)?, "备份文件不存在。");
        let current_schema = Migrator::migrations()
            .iter()
            .map(|m| m.name().to_string())
            .filter(|name| !["session_idle_v1", "query_indexes_v1"].contains(&name.as_str()))
            .collect::<Vec<_>>();
        let mut current_schema = current_schema;
        current_schema.sort();
        backup::prepare_restore(
            source.to_owned(),
            new_db.clone(),
            data_dir.to_owned(),
            0,
            current_schema,
        )
        .await
        .map_err(|e| anyhow::anyhow!(e.1))?;
        if remote.exists() {
            fs::remove_file(&remote)?;
        }
    }
    let path = new_db.clone();
    let mut options = ConnectOptions::new("sqlite://recovery-stage");
    options
        .max_connections(1)
        .sqlx_logging(false)
        .map_sqlx_sqlite_opts(move |o| {
            o.filename(&path)
                .create_if_missing(true)
                .journal_mode(sea_orm::sqlx::sqlite::SqliteJournalMode::Delete)
        });
    let staged = Database::connect(options).await?;
    let result: Result<()> = async {
        Migrator::up(&staged, None).await?;
        db::execute(&staged, "DELETE FROM sessions", vec![]).await?;
        Ok(())
    }
    .await;
    staged.close().await?;
    result?;
    let validated = backup::validate_database(&new_db)
        .await
        .map_err(|e| anyhow::anyhow!(e.1))?;
    validated.close().await?;
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&new_db)?
        .sync_all()?;
    let mut files = vec![];
    for name in DATA_FILES {
        if *name == "instance-id" && action == Action::Restore {
            if fs::read_to_string(data_dir.join(name))
                .ok()
                .and_then(|v| uuid::Uuid::parse_str(v.trim()).ok())
                .is_some()
            {
                continue;
            }
        }
        if data_dir.join(name).exists() {
            files.push(name.to_string());
        }
    }
    fs::create_dir(stage.path().join("old"))?;
    let mut journal = fs::File::create(stage.path().join("files.json"))?;
    journal.write_all(&serde_json::to_vec(&files)?)?;
    journal.sync_all()?;
    drop(journal);
    sync_dir(stage.path())?;
    let pending = data_dir.join(PENDING);
    if pending.exists() {
        bail!("已有维护操作尚未完成，请重试。");
    }
    fs::rename(stage.path(), &pending)?;
    sync_dir(data_dir)?;
    finish_pending(data_dir).await?;
    if action == Action::Reset {
        let storage = crate::storage::FileStorage::from_env(data_dir)?;
        storage.clear_attachments().await.map_err(|e| {
            anyhow::anyhow!(
                "业务数据已清空，但外置图片清理未完成，请检查存储配置后再次清空：{}",
                e.1
            )
        })?;
        // Import previews hold the customer names, phones and addresses of past
        // uploads, are never in the backup set, and were previously left behind
        // by a full wipe. The database is already gone by now, so a failure here
        // must not abort with a retry hint, and anything that is not a plain
        // directory is left alone rather than failing the whole reset.
        let imports = data_dir.join("imports");
        match fs::symlink_metadata(&imports) {
            Ok(meta) if meta.is_dir() && !is_link(&meta) => {
                if let Err(e) = fs::remove_dir_all(&imports) {
                    eprintln!("业务数据已清空，但导入预览清理未完成：{e}");
                }
            }
            Ok(_) => eprintln!("业务数据已清空，但 imports 不是普通目录，未清理导入预览。"),
            Err(_) => {}
        }
    } else {
        // A restore replaces the rows with the archive's inline images, so the
        // externalized objects are now unreferenced. Unlike the HTTP restore
        // path, this one takes no pre-restore snapshot, so there is no safety
        // copy of those objects — but the database that referenced them is
        // already gone. A cleanup failure must not report the restore as failed.
        let storage = previous_storage.as_ref().expect("restore storage");
        if let Err(e) = storage.clear_attachments().await {
            eprintln!("备份已恢复，但外置图片清理未完成：{}", e.1);
        }
    }
    Ok(
        json!({"message": if action == Action::Reset {"数据已清空（不含备份数据）。下次启动请重新创建管理员。"} else {"备份已恢复（包括凭证图片），请使用备份中的账号重新登录。"}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn interrupted_replacement_finishes_without_touching_backups() {
        for moved in 0..=2 {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path();
            let pending = root.join(PENDING);
            fs::create_dir_all(pending.join("old")).unwrap();
            fs::create_dir(root.join("backups")).unwrap();
            fs::write(root.join("backups/keep.zip"), b"backup with photos").unwrap();
            fs::write(
                pending.join("files.json"),
                br#"["inventory.sqlite","inventory.sqlite-wal"]"#,
            )
            .unwrap();
            for (index, name) in ["inventory.sqlite", "inventory.sqlite-wal"]
                .iter()
                .enumerate()
            {
                let target = if index < moved {
                    pending.join("old").join(name)
                } else {
                    root.join(name)
                };
                fs::write(target, b"old bytes").unwrap();
            }
            fs::write(pending.join("new.sqlite"), b"validated replacement").unwrap();
            finish_pending(root).await.unwrap();
            assert_eq!(
                fs::read(root.join("inventory.sqlite")).unwrap(),
                b"validated replacement"
            );
            assert!(!root.join("inventory.sqlite-wal").exists());
            assert!(!pending.exists());
            assert_eq!(
                fs::read(root.join("backups/keep.zip")).unwrap(),
                b"backup with photos"
            );
        }
    }

    #[tokio::test]
    async fn interrupted_post_commit_cleanup_keeps_new_database() {
        for (journal_present, old_present) in [(true, true), (false, true), (true, false)] {
            let dir = tempfile::tempdir().unwrap();
            let pending = dir.path().join(PENDING);
            fs::create_dir(&pending).unwrap();
            if old_present {
                fs::create_dir(pending.join("old")).unwrap();
            }
            if journal_present {
                fs::write(pending.join("files.json"), br#"["inventory.sqlite"]"#).unwrap();
                if old_present {
                    fs::write(pending.join("old/inventory.sqlite"), b"old").unwrap();
                }
            }
            fs::write(dir.path().join("inventory.sqlite"), b"new").unwrap();
            finish_pending(dir.path()).await.unwrap();
            assert_eq!(
                fs::read(dir.path().join("inventory.sqlite")).unwrap(),
                b"new"
            );
            assert!(!pending.exists());
        }
    }

    #[tokio::test]
    async fn invalid_journal_cannot_remove_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let pending = dir.path().join(PENDING);
        fs::create_dir_all(pending.join("old")).unwrap();
        fs::write(pending.join("files.json"), br#"["../outside"]"#).unwrap();
        fs::write(pending.join("new.sqlite"), b"new").unwrap();
        fs::write(dir.path().join("inventory.sqlite"), b"untouched").unwrap();
        assert!(finish_pending(dir.path()).await.is_err());
        assert_eq!(
            fs::read(dir.path().join("inventory.sqlite")).unwrap(),
            b"untouched"
        );
    }
}
