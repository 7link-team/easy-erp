//! Mobile is a remote-only client: no database, sidecar, tray, or autostart.
use crate::preferences::{self, Mode, Preferences};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::Manager;

#[derive(Default)]
struct Mobile {
    launcher: Mutex<Option<url::Url>>,
    server: Mutex<Option<url::Url>>,
    connection: tokio::sync::Mutex<()>,
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connection.json"))
}
fn trusted(
    window: &tauri::WebviewWindow,
    app: &tauri::AppHandle,
    local_only: bool,
) -> Result<(), String> {
    let state = app.state::<Mobile>();
    let url = window.url().map_err(|e| e.to_string())?;
    let local = state
        .launcher
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|u| {
            // tauri:// has an opaque URL origin. Compare the exact bundled
            // page instead; origin() equality only works for HTTP(S) here.
            u.scheme() == url.scheme()
                && u.host_str() == url.host_str()
                && u.port() == url.port()
                && u.path() == url.path()
        });
    let remote = !local_only
        && state
            .server
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|u| u.origin() == url.origin());
    if window.label() == "launcher" && (local || remote) {
        Ok(())
    } else {
        Err("当前页面没有连接设置权限。".into())
    }
}
#[tauri::command]
fn mobile_settings(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Value, String> {
    trusted(&window, &app, true)?;
    let prefs = Preferences::load(&path(&app)?)?;
    Ok(json!({"server_url":prefs.server_url,"version":app.package_info().version.to_string()}))
}
async fn connect(
    window: &tauri::WebviewWindow,
    app: &tauri::AppHandle,
    address: &str,
) -> Result<(), String> {
    let state = app.state::<Mobile>();
    let _connection = state
        .connection
        .try_lock()
        .map_err(|_| "正在连接，请稍候。")?;
    let url = preferences::server_url(address)?;
    let response: Value = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?
        .get(url.join("api/status").map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|_| "连接不到库存电脑，请确认手机与电脑在同一网络，并已允许局域网访问。")?
        .error_for_status()
        .map_err(|_| "库存电脑拒绝了连接，请检查服务设置。")?
        .json()
        .await
        .map_err(|_| "该地址不是库存管理服务。")?;
    if response
        .get("instance_id")
        .and_then(Value::as_str)
        .is_none()
        || response
            .get("initialized")
            .and_then(Value::as_bool)
            .is_none()
    {
        return Err("该地址不是库存管理服务。".into());
    }
    app.add_capability(
        json!({
            "identifier":"mobile-connection",
            "local":false,
            "remote":{"urls":[format!("{}/*",url.origin().ascii_serialization())]},
            "windows":["launcher"],
            "permissions":["allow-mobile-disconnect","allow-update-info"]
        })
        .to_string(),
    )
    .map_err(|e| e.to_string())?;
    Preferences {
        mode: Some(Mode::Remote),
        server_url: url.to_string(),
    }
    .save(&path(app)?)?;
    *state.server.lock().unwrap() = Some(url.clone());
    window.navigate(url).map_err(|e| e.to_string())
}
#[tauri::command]
async fn mobile_connect(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    address: String,
) -> Result<(), String> {
    trusted(&window, &app, true)?;
    connect(&window, &app, &address).await
}
#[tauri::command]
async fn mobile_resume(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    trusted(&window, &app, true)?;
    let prefs = Preferences::load(&path(&app)?)?;
    if prefs.server_url.is_empty() {
        return Ok(false);
    }
    connect(&window, &app, &prefs.server_url).await?;
    Ok(true)
}
#[tauri::command]
fn mobile_disconnect(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    trusted(&window, &app, false)?;
    let mut launcher = app
        .state::<Mobile>()
        .launcher
        .lock()
        .unwrap()
        .clone()
        .ok_or("连接页面不可用。")?;
    launcher.set_fragment(Some("settings"));
    window.navigate(launcher).map_err(|e| e.to_string())
}
#[tauri::command]
fn update_info(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Value, String> {
    trusted(&window, &app, false)?;
    Ok(json!({"version":app.package_info().version.to_string(),"mobile":true,"enabled":false}))
}
pub fn run() {
    #[cfg(debug_assertions)]
    eprintln!("Starting inventory mobile client");
    tauri::Builder::default()
        .manage(Mobile::default())
        .invoke_handler(tauri::generate_handler![
            mobile_settings,
            mobile_connect,
            mobile_resume,
            mobile_disconnect,
            update_info
        ])
        .on_page_load(|webview, payload| {
            // WKWebView.URL can be nil during setup; Wry's URL getter unwraps
            // it. Capture the initial local document from the load event instead.
            if webview.label() == "launcher" && payload.url().path() == "/mobile.html" {
                let state = webview.state::<Mobile>();
                let mut launcher = state.launcher.lock().unwrap();
                if launcher.is_none() {
                    *launcher = Some(payload.url().clone());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("移动应用启动失败");
}
