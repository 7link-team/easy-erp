use std::path::{Path, PathBuf};

/// Keep old inventory usable if an interrupted installer has not migrated it yet.
/// Never silently choose one of two independent databases.
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
