use crate::update_channel::Channel;
use crate::{desktop, preferences::LOCAL_URL};
use fs2::FileExt;
use rand::RngCore;
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_updater::Update;

#[derive(Default)]
pub struct Updates {
    operation: tokio::sync::Mutex<()>,
    pending: Mutex<Option<(Update, Option<tempfile::NamedTempFile>)>>,
}

fn authorize(window: &tauri::WebviewWindow, app: &tauri::AppHandle) -> Result<(), String> {
    if window.label() == "launcher" {
        return Ok(());
    }
    let pref = crate::preferences::Preferences::load(&desktop::config_path(app)?)?;
    let source = crate::preferences::server_url(&pref.server_url)?;
    if window.label() == "inventory"
        && window.url().map_err(|e| e.to_string())?.origin() == source.origin()
    {
        Ok(())
    } else {
        Err("当前窗口没有应用更新权限。".into())
    }
}

fn configured(app: &tauri::AppHandle) -> bool {
    let Some(config) = app.config().plugins.0.get("updater") else {
        return false;
    };
    let signed = config
        .get("pubkey")
        .and_then(Value::as_str)
        .is_some_and(|v| !v.is_empty());
    #[cfg(target_os = "linux")]
    {
        signed && app.env().appimage.is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        signed
    }
}

#[tauri::command]
pub fn update_info(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Value, String> {
    authorize(&window, &app)?;
    Ok(
        json!({"version": app.package_info().version.to_string(), "enabled": configured(&app), "mobile": false, "channel": Channel::load(&channel_path(&app)?)?}),
    )
}

fn channel_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("update-channel.json"))
}

#[tauri::command]
pub async fn set_update_channel(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    channel: Channel,
) -> Result<(), String> {
    authorize(&window, &app)?;
    let state = app.state::<Updates>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "正在处理更新，请稍后再切换渠道。")?;
    channel.save(&channel_path(&app)?)?;
    *state.pending.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn check_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    automatic: bool,
) -> Result<Value, String> {
    authorize(&window, &app)?;
    if !configured(&app) {
        return Ok(json!({"enabled":false}));
    }
    let state = app.state::<Updates>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "正在处理更新，请稍后再试。")?;
    let channel = Channel::load(&channel_path(&app)?)?;
    let stamp = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(match channel {
            Channel::Stable => "update-check-stable.json",
            Channel::Preview => "update-check-preview.json",
        });
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let last = std::fs::read_to_string(&stamp)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    if automatic && now.saturating_sub(last) < 86400 {
        let pending = state.pending.lock().unwrap();
        return Ok(match pending.as_ref() {
            Some((update, package)) => {
                json!({"enabled":true,"version":update.version,"notes":update.body,"ready":package.is_some(),"cached":true})
            }
            None => json!({"skipped":true}),
        });
    }
    let update =
        crate::update_network::check(&app, channel, |status| emit_route(&window, "check", status))
            .await?;
    let response = match &update {
        Some(update) => json!({"enabled":true,"version":update.version,"notes":update.body}),
        None => json!({"enabled":true,"current":true}),
    };
    *state.pending.lock().unwrap() = update.map(|update| (update, None));
    if let Some(parent) = stamp.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(stamp, now.to_string()).map_err(|e| e.to_string())?;
    Ok(response)
}

#[tauri::command]
pub async fn download_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    authorize(&window, &app)?;
    let state = app.state::<Updates>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "正在处理更新，请稍后再试。")?;
    let update = state
        .pending
        .lock()
        .unwrap()
        .as_ref()
        .map(|(u, _)| u.clone())
        .ok_or("请先检查新版本。")?;
    let mut last = std::time::Instant::now();
    let bytes = crate::update_network::download(
        &update,
        |downloaded, total, fallback| {
            if downloaded > 0 && last.elapsed() < Duration::from_millis(200) {
                return;
            }
            last = std::time::Instant::now();
            let progress = json!({"downloaded": downloaded, "total":total, "fallback":fallback});
            let _ = window.eval(format!(
                "window.dispatchEvent(new CustomEvent('erp:update-progress',{{detail:{progress}}}))"
            ));
        },
        |status| emit_route(&window, "download", status),
    )
    .await?;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let package = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        use std::io::Write;
        std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let mut package = tempfile::NamedTempFile::new_in(cache).map_err(|e| e.to_string())?;
        package.write_all(&bytes).map_err(|e| e.to_string())?;
        package.as_file().sync_all().map_err(|e| e.to_string())?;
        Ok(package)
    })
    .await
    .map_err(|e| e.to_string())??;
    *state.pending.lock().unwrap() = Some((update, Some(package)));
    Ok(())
}

fn emit_route(
    window: &tauri::WebviewWindow,
    operation: &str,
    status: crate::update_network::RouteStatus,
) {
    let detail = json!({"operation":operation,"status":status});
    let _ = window.eval(format!(
        "window.dispatchEvent(new CustomEvent('erp:update-route',{{detail:{detail}}}))"
    ));
}

pub fn new_control_token(dir: &Path) -> Result<String, String> {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let path = dir.join("desktop-control-token");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(token.as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(token)
}

async fn stop_local(app: &tauri::AppHandle, for_update: bool) -> Result<bool, String> {
    let dir = desktop::data_dir(app)?;
    let lock_path = dir.join("server.lock");
    if !lock_path.exists() {
        return Ok(false);
    }
    if !for_update {
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|e| e.to_string())?;
        if lock.try_lock_exclusive().is_ok() {
            return Ok(false);
        }
    }
    // Even an offline local database must be backed up before its next migration.
    // Starting the current service also validates ownership of the local port.
    desktop::ensure_local(app).await?;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    if lock.try_lock_exclusive().is_ok() {
        return Err("库存服务意外退出，请检查日志。".into());
    }
    let token = std::fs::read_to_string(dir.join("desktop-control-token"))
        .map_err(|_| "旧版库存服务不支持安全停止，请先备份并手动退出库存服务后再试。")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    // Persist recovery intent before asking the service to stop. A timeout or
    // application crash must not leave a stopped service with no recovery marker.
    let marker = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("resume-service-after-update");
    {
        use std::io::Write;
        let mut file = std::fs::File::create(marker).map_err(|e| e.to_string())?;
        file.write_all(b"1").map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    let response = client
        .post(format!("{LOCAL_URL}api/desktop/prepare-update"))
        .header("X-ERP-Request", "1")
        .bearer_auth(token.trim())
        .send()
        .await
        .map_err(|e| {
            format!("无法确认库存服务是否完成备份与停止，操作已中止。请重新打开应用后重试。{e}")
        })?;
    if !response.status().is_success() {
        clear_resume_marker(app);
        return Err("库存服务未能完成备份，请检查服务日志；操作已中止。".into());
    }
    for _ in 0..120 {
        if lock.try_lock_exclusive().is_ok() {
            return Ok(true);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("库存服务还未退出，操作已中止。请检查服务状态后重试。".into())
}

#[tauri::command]
pub async fn install_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    authorize(&window, &app)?;
    let state = app.state::<Updates>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "正在处理更新，请稍后再试。")?;
    if !state
        .pending
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|(_, bytes)| bytes.is_some())
    {
        return Err("请先下载并验证新版本。".into());
    }
    let runtime = app.state::<desktop::Runtime>();
    let _connection = runtime.connection_lock.lock().await;
    let package = state
        .pending
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|(_, package)| package.as_ref())
        .unwrap()
        .path()
        .to_owned();
    let bytes = tokio::fs::read(package)
        .await
        .map_err(|_| "读取更新包失败，请重新下载。")?;
    let stopped = stop_local(&app, true).await?;
    desktop::wait_for_local_exit(&app).await?;
    let (update, _package) = state.pending.lock().unwrap().take().unwrap();
    let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())
        .and_then(|result| result.map_err(|e| e.to_string()));
    if let Err(error) = result {
        if stopped {
            desktop::ensure_local(&app)
                .await
                .map_err(|restart| format!("安装失败：{error}；重启库存服务失败：{restart}"))?;
            clear_resume_marker(&app);
        }
        return Err(format!("安装失败，原有库存数据保留：{error}"));
    }
    app.restart();
}

pub async fn quit_all(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Updates>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "正在处理更新或退出，请稍后再试。".to_string())?;
    let runtime = app.state::<desktop::Runtime>();
    let _connection = runtime.connection_lock.lock().await;
    stop_local(app, false).await?;
    desktop::wait_for_local_exit(app).await?;
    clear_resume_marker(app);
    app.exit(0);
    Ok(())
}

fn clear_resume_marker(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::remove_file(dir.join("resume-service-after-update"));
    }
}

pub fn resume_service(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    if !dir.join("resume-service-after-update").exists() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let runtime = app.state::<desktop::Runtime>();
        let _connection = runtime.connection_lock.lock().await;
        match desktop::ensure_local(&app).await {
            Ok(_) => clear_resume_marker(&app),
            Err(error) => {
                eprintln!("更新后库存服务启动失败：{error}");
                if let Some(window) = app.get_webview_window("launcher") {
                    let _ = window.show();
                }
            }
        }
    });
}
