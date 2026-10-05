use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LOCAL_URL: &str = "http://127.0.0.1:4280/";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Local,
    Remote,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Preferences {
    pub mode: Option<Mode>,
    pub server_url: String,
}

pub fn server_url(address: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(address.trim())
        .map_err(|_| "请输入保存库存的电脑地址，例如 http://192.168.1.20:4280".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "请填写完整电脑地址，例如 http://192.168.1.20:4280，不要加后面的页面名称。".into(),
        );
    }
    Ok(url)
}

impl Preferences {
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => return Err(format!("无法读取连接设置：{error}")),
        };
        let mut prefs: Self = serde_json::from_slice(&bytes)
            .map_err(|_| "连接设置文件损坏，请重新选择库存电脑。".to_string())?;
        // Preserve the choice saved by the original launcher.
        if prefs.mode.is_none() && !prefs.server_url.is_empty() {
            prefs.mode = Some(if server_url(&prefs.server_url)?.as_str() == LOCAL_URL {
                Mode::Local
            } else {
                Mode::Remote
            });
        }
        Ok(prefs)
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let temporary = path.with_extension("json.tmp");
        std::fs::write(
            &temporary,
            serde_json::to_vec(self).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(temporary, path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_root_http_addresses() {
        assert_eq!(
            server_url(" http://127.0.0.1:4280 ").unwrap().as_str(),
            LOCAL_URL
        );
        for value in [
            "file:///tmp",
            "javascript:alert(1)",
            "https://user@host/",
            "http://host/api",
            "http://host/?token=secret",
        ] {
            assert!(server_url(value).is_err());
        }
    }
    #[test]
    fn persists_mode_and_migrates_legacy_choice() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("connection.json");
        assert_eq!(Preferences::load(&path).unwrap().mode, None);
        std::fs::write(&path, format!(r#"{{"server_url":"{LOCAL_URL}"}}"#)).unwrap();
        assert_eq!(Preferences::load(&path).unwrap().mode, Some(Mode::Local));
        Preferences {
            mode: Some(Mode::Remote),
            server_url: "https://stock.example.com/".into(),
        }
        .save(&path)
        .unwrap();
        assert_eq!(Preferences::load(&path).unwrap().mode, Some(Mode::Remote));
        Preferences {
            mode: Some(Mode::Local),
            server_url: LOCAL_URL.into(),
        }
        .save(&path)
        .unwrap();
        assert_eq!(Preferences::load(&path).unwrap().mode, Some(Mode::Local));
    }
}
