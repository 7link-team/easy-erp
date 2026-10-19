use std::path::{Path, PathBuf};

/// Keep old inventory usable if an interrupted installer has not migrated it yet.
/// Never silently choose one of two independent databases.
#[cfg(any(windows, test))]
pub(crate) fn select(preferred: &Path, legacy: &Path) -> Result<PathBuf, String> {
    let old_exists = legacy.join("inventory.sqlite").exists();
    if old_exists && preferred.join("inventory.sqlite").exists() {
        return Err(format!(
            "发现两套库存数据，请先确认要保留哪一套；应用不会自动覆盖。新目录：{}；旧目录：{}。",
            preferred.display(),
            legacy.display()
        ));
    }
    Ok(if old_exists { legacy } else { preferred }.to_path_buf())
}

/// macOS keeps business data outside the app-associated support directory.
/// Rename the complete directory (including WAL, backups and identity) only
/// while the server is offline. Never copy individual database files or merge.
#[cfg(target_os = "macos")]
pub(crate) fn select_macos(preferred: &Path, legacy: &Path) -> Result<PathBuf, String> {
    use fs2::FileExt;
    use std::fs::{self, OpenOptions};
    fn directory(path: &Path) -> Result<bool, String> {
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(true),
            Ok(_) => Err(format!(
                "数据目录不能是符号链接或普通文件：{}。未迁移数据。",
                path.display()
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!("无法检查数据目录 {}：{error}", path.display())),
        }
    }
    let new_exists = directory(preferred)?;
    if !directory(legacy)? {
        return Ok(preferred.to_path_buf());
    }
    let old_has_files = fs::read_dir(legacy)
        .map_err(|e| e.to_string())?
        .next()
        .transpose()
        .map_err(|e| e.to_string())?
        .is_some();
    if new_exists {
        if old_has_files {
            return Err(format!(
                "新旧数据目录同时存在，请先核对，应用不会合并或覆盖。新目录：{}；旧目录：{}。",
                preferred.display(),
                legacy.display()
            ));
        }
        return Ok(preferred.to_path_buf());
    }
    if let Some(storage) = std::env::var_os("ERP_STORAGE_LOCAL_DIR").filter(|v| !v.is_empty()) {
        let storage = Path::new(&storage)
            .canonicalize()
            .map_err(|e| format!("无法检查配置的文件存储目录：{e}"))?;
        let old = legacy.canonicalize().map_err(|e| e.to_string())?;
        if storage.starts_with(old) {
            return Err(
                "ERP_STORAGE_LOCAL_DIR 指向旧数据目录内部，请先迁移并更新该配置；未移动数据。"
                    .into(),
            );
        }
    }
    let lock_path = legacy.join("server.lock");
    match fs::symlink_metadata(&lock_path) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
            return Err("旧数据目录的服务锁不是普通文件，未迁移数据。".into());
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.to_string()),
        _ => {}
    }
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| format!("无法锁定旧数据目录：{e}"))?;
    lock.try_lock_exclusive().map_err(|_| {
        "旧数据目录仍有服务运行，请先全部退出旧版应用（停止本机共享），再重试。未迁移数据。"
            .to_string()
    })?;
    // A second caller may have opened the old lock before the first renamed it.
    // Recheck both names under the lock; exclusive rename also guards against a
    // destination appearing between this check and the filesystem operation.
    if !directory(legacy)? {
        return Ok(preferred.to_path_buf());
    }
    if directory(preferred)? {
        return Err("目标数据目录已存在，未覆盖任何文件。请重新打开应用核对目录。".into());
    }
    rename_macos_exclusive(legacy, preferred).map_err(|e| {
        format!(
            "数据目录迁移未完成：{e}。原目录：{}；目标：{}。未复制或覆盖数据。",
            legacy.display(),
            preferred.display()
        )
    })?;
    Ok(preferred.to_path_buf())
}

#[cfg(target_os = "macos")]
fn rename_macos_exclusive(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    unsafe extern "C" {
        fn renamex_np(
            from: *const std::ffi::c_char,
            to: *const std::ffi::c_char,
            flags: u32,
        ) -> std::ffi::c_int;
    }
    let source = CString::new(source.as_os_str().as_bytes())?;
    let destination = CString::new(destination.as_os_str().as_bytes())?;
    // Darwin RENAME_EXCL: fail if any destination exists, including an empty
    // directory. Cross-device moves also fail without copying/deleting data.
    let result = unsafe { renamex_np(source.as_ptr(), destination.as_ptr(), 0x00000004) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_and_migrated_installs_use_the_visible_user_directory() {
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join("EasyErp");
        let legacy = root.path().join("legacy");
        assert_eq!(select(&preferred, &legacy).unwrap(), preferred);
        std::fs::create_dir(&preferred).unwrap();
        std::fs::write(preferred.join("inventory.sqlite"), "new").unwrap();
        assert_eq!(select(&preferred, &legacy).unwrap(), preferred);
    }

    #[test]
    fn interrupted_migration_uses_old_inventory_but_conflicts_are_not_hidden() {
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join("EasyErp");
        let legacy = root.path().join("legacy");
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("inventory.sqlite"), "old").unwrap();
        assert_eq!(select(&preferred, &legacy).unwrap(), legacy);
        std::fs::create_dir(&preferred).unwrap();
        std::fs::write(preferred.join("inventory.sqlite"), "new").unwrap();
        assert!(select(&preferred, &legacy).is_err());
        assert_eq!(
            std::fs::read_to_string(legacy.join("inventory.sqlite")).unwrap(),
            "old"
        );
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::*;
    use fs2::FileExt;
    use std::fs;

    #[test]
    fn fresh_macos_uses_home_directory_without_creating_a_database() {
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join(".EasyERP");
        let legacy = root.path().join("Application Support/server");
        assert_eq!(select_macos(&preferred, &legacy).unwrap(), preferred);
        assert!(!preferred.exists());
        fs::create_dir(&preferred).unwrap();
        fs::write(preferred.join("inventory.sqlite"), "new").unwrap();
        assert_eq!(select_macos(&preferred, &legacy).unwrap(), preferred);
    }

    #[test]
    fn migration_keeps_database_wal_identity_backups_and_configuration_together() {
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join(".EasyERP");
        let legacy = root.path().join("Application Support/server");
        fs::create_dir_all(legacy.join("backups/2026/10/19")).unwrap();
        fs::create_dir_all(legacy.join("attachments")).unwrap();
        let names = [
            "inventory.sqlite",
            "inventory.sqlite-wal",
            "inventory.sqlite-shm",
            "instance-id",
            "database.json",
            "server.log",
            "backups/policy.json",
            "backups/2026/10/19/archive.zip",
            "attachments/photo.png",
        ];
        for name in names {
            fs::write(legacy.join(name), format!("original {name}")).unwrap();
        }
        assert_eq!(select_macos(&preferred, &legacy).unwrap(), preferred);
        assert!(!legacy.exists());
        for name in names {
            assert_eq!(
                fs::read_to_string(preferred.join(name)).unwrap(),
                format!("original {name}")
            );
        }
        assert_eq!(select_macos(&preferred, &legacy).unwrap(), preferred);
    }

    #[test]
    fn backups_without_database_are_migrated_and_conflicts_never_merge() {
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join(".EasyERP");
        let legacy = root.path().join("legacy");
        fs::create_dir_all(legacy.join("backups")).unwrap();
        fs::write(legacy.join("backups/only.zip"), "backup").unwrap();
        fs::create_dir(&preferred).unwrap();
        assert!(select_macos(&preferred, &legacy).is_err());
        assert_eq!(
            fs::read_to_string(legacy.join("backups/only.zip")).unwrap(),
            "backup"
        );
        assert_eq!(fs::read_dir(&preferred).unwrap().count(), 0);
        fs::remove_dir(&preferred).unwrap();
        select_macos(&preferred, &legacy).unwrap();
        assert_eq!(
            fs::read_to_string(preferred.join("backups/only.zip")).unwrap(),
            "backup"
        );
        fs::create_dir(&legacy).unwrap();
        assert_eq!(select_macos(&preferred, &legacy).unwrap(), preferred);
        fs::write(legacy.join("inventory.sqlite"), "other").unwrap();
        assert!(select_macos(&preferred, &legacy).is_err());
        assert_eq!(
            fs::read_to_string(legacy.join("inventory.sqlite")).unwrap(),
            "other"
        );
    }

    #[test]
    fn running_server_prevents_migration_until_its_lock_is_released() {
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join(".EasyERP");
        let legacy = root.path().join("legacy");
        fs::create_dir(&legacy).unwrap();
        fs::write(legacy.join("inventory.sqlite"), "data").unwrap();
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(legacy.join("server.lock"))
            .unwrap();
        lock.lock_exclusive().unwrap();
        assert!(
            select_macos(&preferred, &legacy)
                .unwrap_err()
                .contains("仍有服务运行")
        );
        assert!(!preferred.exists());
        assert_eq!(
            fs::read_to_string(legacy.join("inventory.sqlite")).unwrap(),
            "data"
        );
        drop(lock);
        select_macos(&preferred, &legacy).unwrap();
    }

    #[test]
    fn symlinks_and_a_destination_appearing_before_rename_are_rejected() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let preferred = root.path().join(".EasyERP");
        let legacy = root.path().join("legacy");
        let outside = root.path().join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, &legacy).unwrap();
        assert!(select_macos(&preferred, &legacy).is_err());
        fs::remove_file(&legacy).unwrap();
        fs::create_dir(&legacy).unwrap();
        symlink(&outside, &preferred).unwrap();
        assert!(select_macos(&preferred, &legacy).is_err());
        fs::remove_file(&preferred).unwrap();
        symlink(outside.join("lock"), legacy.join("server.lock")).unwrap();
        assert!(select_macos(&preferred, &legacy).is_err());
        fs::remove_file(legacy.join("server.lock")).unwrap();
        fs::create_dir(&preferred).unwrap();
        assert!(rename_macos_exclusive(&legacy, &preferred).is_err());
        assert!(legacy.is_dir());
        assert!(preferred.is_dir());
    }
}
