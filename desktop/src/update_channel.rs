use semver::Version;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Channel {
    #[default]
    Stable,
    Preview,
}

impl Channel {
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("无法读取更新渠道：{e}")),
        }
    }

    pub fn save(self, path: &Path) -> Result<(), String> {
        use std::io::Write;
        let parent = path.parent().ok_or("更新渠道保存位置无效。")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, &self).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(path)
            .map_err(|e| format!("保存更新渠道失败：{e}"))?;
        Ok(())
    }

    pub fn offers(self, current: &Version, candidate: &Version) -> bool {
        candidate.cmp_precedence(current).is_gt()
            && (self == Self::Preview || candidate.pre.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_persistence() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("channel.json");
        assert_eq!(Channel::load(&file).unwrap(), Channel::Stable);
        Channel::Preview.save(&file).unwrap();
        assert_eq!(Channel::load(&file).unwrap(), Channel::Preview);
        Channel::Stable.save(&file).unwrap();
        assert_eq!(Channel::load(&file).unwrap(), Channel::Stable);
        std::fs::write(&file, b"corrupt").unwrap();
        assert_eq!(Channel::load(&file).unwrap(), Channel::Stable);
    }
    #[test]
    fn stable_excludes_prereleases_and_neither_channel_downgrades() {
        let version = |v: &str| Version::parse(v).unwrap();
        assert!(!Channel::Stable.offers(&version("1.0.0"), &version("2.0.0-beta.1")));
        assert!(Channel::Preview.offers(&version("1.0.0"), &version("2.0.0-rc.1")));
        assert!(!Channel::Stable.offers(&version("2.0.0-rc.1"), &version("1.9.0")));
        assert!(Channel::Stable.offers(&version("2.0.0-rc.1"), &version("2.0.0")));
        assert!(Channel::Preview.offers(&version("2.0.0-rc.1"), &version("2.0.0")));
        assert!(!Channel::Preview.offers(&version("2.0.0"), &version("2.0.0+build.2")));
    }
}
