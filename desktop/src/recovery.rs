use crate::{
    desktop,
    preferences::{LOCAL_URL, Mode, Preferences},
    updates,
};
use fs2::FileExt;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

async fn cli(
    app: &tauri::AppHandle,
    action: &str,
    confirmation: &str,
    backup: Option<String>,
) -> Result<Value, String> {
    let binary = desktop::server_binary()?;
    let dir = desktop::data_dir(app)?;
    let action = action.to_owned();
    let confirmation = confirmation.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(binary);
        command
            .arg("--data-dir")
            .arg(dir)
            .arg("--recovery-action")
            .arg(action)
            .stdin(Stdio::null());
        if !confirmation.is_empty() {
            command.arg("--confirmation").arg(confirmation);
        }
        if let Some(backup) = backup {
            command.arg("--recovery-backup").arg(backup);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command
            .output()
            .map_err(|e| format!("无法运行本机维护：{e}"))?;
        let value: Value = serde_json::from_slice(&output.stdout).unwrap_or(Value::Null);
        if !output.status.success() {
            return Err(value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| String::from_utf8_lossy(&output.stderr).trim().to_owned()));
        }
        if !value.is_object() {
            return Err("本机维护返回了无法识别的结果。".into());
        }
        Ok(value)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn recovery_list(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    desktop::trusted(&window)?;
    let updates = app.state::<updates::Updates>();
    let _operation = updates
        .operation
        .try_lock()
        .map_err(|_| "正在更新或维护，请稍后再试。")?;
    let mut result = cli(&app, "list", "", None).await?;
    result["remote_mode"] =
        json!(Preferences::load(&desktop::config_path(&app)?)?.mode == Some(Mode::Remote));
    Ok(result)
}

#[tauri::command]
pub async fn recovery_select_backup(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    desktop::trusted(&window)?;
    let updates = app.state::<updates::Updates>();
    let _operation = updates
        .operation
        .try_lock()
        .map_err(|_| "正在更新或维护，请稍后再试。")?;
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("库存备份（ZIP / 旧版）", &["zip", "erpbackup"])
            .blocking_pick_file()
            .map(|file| {
                file.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

// Reject links before reading local control credentials or touching the lock.
// Missing files are allowed for a first launch; special files are not.
fn validate_control_paths(dir: &Path) -> Result<(), String> {
    for (path, directory) in std::iter::once((dir.to_path_buf(), true)).chain(
        ["server.lock", "instance-id", "desktop-control-token"]
            .into_iter()
            .map(|name| (dir.join(name), false)),
    ) {
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("无法检查本机维护路径 {}：{error}", path.display())),
        };
        let linked = metadata.file_type().is_symlink();
        #[cfg(windows)]
        let linked = {
            use std::os::windows::fs::MetadataExt;
            linked || metadata.file_attributes() & 0x400 != 0
        };
        if linked || (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
            return Err(format!(
                "本机维护路径不能是符号链接或特殊文件：{}。未请求停止服务。",
                path.display()
            ));
        }
    }
    Ok(())
}

/// A lock the local service already holds. Unix answers with EWOULDBLOCK, which
/// maps to `WouldBlock`; Windows answers with ERROR_LOCK_VIOLATION (33) or
/// ERROR_SHARING_VIOLATION (32), which map to nothing in particular — so the
/// service holding its own data read as a lock that could not be checked, and
/// 清空全部数据 refused to run instead of stopping the service first.
fn lock_held(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::WouldBlock
        || cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33))
}

// Maintenance must also work when the database cannot start. Only ask an
// already-running, identified local service to stop; never spawn or kill here.
async fn stop_for_recovery(app: &tauri::AppHandle) -> Result<bool, String> {
    let dir = desktop::data_dir(app)?;
    validate_control_paths(&dir)?;
    let path = dir.join("server.lock");
    let lock = match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
    {
        Ok(lock) => lock,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    match lock.try_lock_exclusive() {
        Ok(()) => return Ok(false),
        Err(error) if lock_held(&error) => {}
        Err(error) => return Err(format!("无法检查本机数据锁：{error}")),
    }
    let url = url::Url::parse(LOCAL_URL).unwrap();
    let actual = desktop::verify_server(&url).await.map_err(
        |_| "本机数据正在使用，但无法识别服务。请手动停止使用此目录的服务后重试；未修改数据。",
    )?;
    validate_control_paths(&dir)?;
    desktop::verify_local_identity(&dir, &actual)?;
    let token = std::fs::read_to_string(dir.join("desktop-control-token"))
        .map_err(|_| "无法安全停止此服务，请手动停止后重试；未修改数据。")?;
    let response = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?
        .post(url.join("api/desktop/prepare-recovery").unwrap())
        .header("X-ERP-Request", "1")
        .bearer_auth(token.trim())
        .send()
        .await
        .map_err(|e| format!("无法确认本机服务是否停止，维护尚未执行，请检查状态后重试：{e}"))?;
    if !response.status().is_success() {
        return Err("服务拒绝安全停止，维护尚未执行。请更新或手动停止本机服务后重试。".into());
    }
    for _ in 0..120 {
        if lock.try_lock_exclusive().is_ok() {
            desktop::wait_for_local_exit(app).await?;
            return Ok(true);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("本机服务尚未停止，维护尚未执行。请稍后重试。".into())
}

#[tauri::command]
pub async fn recovery_execute(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    action: String,
    confirmation: String,
    backup: Option<String>,
    restart: bool,
) -> Result<Value, String> {
    desktop::trusted(&window)?;
    let expected = match action.as_str() {
        "reset" => "清空全部数据",
        "restore" => "恢复全部数据",
        "clear-backups" => "清空全部备份",
        _ => return Err("未知维护操作。".into()),
    };
    if confirmation != expected {
        return Err(format!("请输入“{expected}”确认操作。"));
    }
    // Remote keys come from recovery_list; the service matches them against the
    // stored files before reading anything.
    if action == "restore"
        && !backup.as_ref().is_some_and(|p| {
            PathBuf::from(p).is_absolute()
                || p.strip_prefix("s3://").is_some_and(|key| !key.is_empty())
        })
    {
        return Err("请先选择要恢复的 ZIP 备份。".into());
    }
    let updates = app.state::<updates::Updates>();
    let _operation = updates
        .operation
        .try_lock()
        .map_err(|_| "正在更新或维护，请稍后再试。")?;
    let runtime = app.state::<desktop::Runtime>();
    let _connection = runtime
        .connection_lock
        .try_lock()
        .map_err(|_| "正在连接库存电脑，请稍后再维护。")?;
    runtime.recovery_busy.store(true, Ordering::SeqCst);
    let _busy = Busy(&runtime.recovery_busy);
    let stopped = stop_for_recovery(&app).await?;
    // Invalidate local business pages (including authentication) after stop.
    if let Some(business) = app.get_webview_window("inventory")
        && business
            .url()
            .is_ok_and(|url| url.origin() == url::Url::parse(LOCAL_URL).unwrap().origin())
    {
        business.destroy().map_err(|e| e.to_string())?;
    }
    let mut result = cli(&app, &action, &confirmation, backup).await.map_err(|e| {
        format!("维护失败：{e}。本机服务现已停止；可重试维护，或关闭维护窗口后点击“使用本机并进入库存管理”手动启动。")
    })?;
    result["stopped_previous_service"] = json!(stopped);
    result["started"] = json!(false);
    if restart {
        let url = desktop::ensure_local(&app)
            .await
            .map_err(|e| format!("维护已完成，但本机启动失败：{e}。可重试启动或继续维护。"))?;
        Preferences {
            mode: Some(Mode::Local),
            server_url: url.to_string(),
        }
        .save(&desktop::config_path(&app)?)?;
        desktop::open_business(&app, url, true).await?;
        result["started"] = json!(true);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{lock_held, validate_control_paths};

    #[test]
    fn control_paths_allow_missing_and_regular_files() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("server");
        validate_control_paths(&dir).unwrap();
        std::fs::create_dir(&dir).unwrap();
        for name in ["server.lock", "instance-id", "desktop-control-token"] {
            std::fs::write(dir.join(name), "local").unwrap();
        }
        validate_control_paths(&dir).unwrap();
        std::fs::remove_file(dir.join("server.lock")).unwrap();
        std::fs::create_dir(dir.join("server.lock")).unwrap();
        assert!(validate_control_paths(&dir).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn control_paths_reject_linked_directory_and_each_control_file() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let outside = root.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("secret"), "must remain untouched").unwrap();
        let dir = root.path().join("server");
        symlink(&outside, &dir).unwrap();
        assert!(validate_control_paths(&dir).is_err());
        std::fs::remove_file(&dir).unwrap();
        std::fs::create_dir(&dir).unwrap();
        for name in ["server.lock", "instance-id", "desktop-control-token"] {
            let path = dir.join(name);
            symlink(outside.join("secret"), &path).unwrap();
            assert!(validate_control_paths(&dir).is_err(), "must reject {name}");
            std::fs::remove_file(&path).unwrap();
            symlink(outside.join("missing"), &path).unwrap();
            assert!(
                validate_control_paths(&dir).is_err(),
                "must reject dangling {name}"
            );
            std::fs::remove_file(path).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(outside.join("secret")).unwrap(),
            "must remain untouched"
        );
    }

    #[test]
    fn a_lock_the_service_already_holds_is_recognised_on_either_system() {
        use std::io::{Error, ErrorKind};
        assert!(lock_held(&Error::from(ErrorKind::WouldBlock)));
        // ERROR_LOCK_VIOLATION / ERROR_SHARING_VIOLATION: what Windows answers
        // instead of WouldBlock, and the reason 清空全部数据 reported that the
        // lock could not be checked rather than stopping the service first.
        for code in [32, 33] {
            assert_eq!(lock_held(&Error::from_raw_os_error(code)), cfg!(windows));
        }
        assert!(!lock_held(&Error::from(ErrorKind::PermissionDenied)));
    }

}
