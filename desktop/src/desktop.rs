use crate::preferences::{self, LOCAL_URL, Mode, Preferences};
use crate::updates;
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt;

#[derive(Default)]
pub(crate) struct Runtime {
    child: Mutex<Option<Child>>,
    url: Mutex<Option<url::Url>>,
    pub(crate) connection_lock: tokio::sync::Mutex<()>,
}

pub(crate) fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connection.json"))
}
fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "launcher" {
        Ok(())
    } else {
        Err("业务窗口没有本机管理权限。".into())
    }
}

#[tauri::command]
async fn connection_settings(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    let pref = Preferences::load(&config_path(&app)?)?;
    let autostart = app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"server_url":pref.server_url,"mode":pref.mode,"autostart":autostart}))
}
#[tauri::command]
async fn set_autostart(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    trusted(&window)?;
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|e| e.to_string())
}

async fn verify_server(url: &url::Url) -> Result<String, String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?
        .get(url.join("api/status").map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|_| {
            "连接不到库存电脑，请检查地址、网络，并确认保存库存的电脑已经开机。".to_string()
        })?;
    let info: serde_json::Value = response
        .error_for_status()
        .map_err(|_| {
            "保存库存的电脑拒绝了连接，请联系管理员检查是否允许这个访问地址。".to_string()
        })?
        .json()
        .await
        .map_err(|_| "该地址不是库存管理服务。".to_string())?;
    if info.get("version").and_then(|v| v.as_str()).is_none()
        || info.get("initialized").and_then(|v| v.as_bool()).is_none()
    {
        return Err("该地址不是库存管理服务。".into());
    }
    info.get("instance_id")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "无法识别这套库存数据，请更新保存库存的电脑上的应用。".to_string())
}

fn verify_local_identity(dir: &std::path::Path, actual: &str) -> Result<(), String> {
    let expected = std::fs::read_to_string(dir.join("instance-id")).map_err(|_| {
        "4280 端口已有其他服务，无法确认它属于本机库存目录。请在连接设置中重新选择保存库存的电脑。"
            .to_string()
    })?;
    if expected.trim() != actual {
        return Err(
            "4280 端口属于另一套库存数据，已停止连接。请在连接设置中重新选择保存库存的电脑。"
                .into(),
        );
    }
    Ok(())
}
fn open_business(app: &tauri::AppHandle, url: url::Url, visible: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("inventory") {
        window.destroy().map_err(|e| e.to_string())?;
    }
    let allowed = url.clone();
    app.add_capability(
        serde_json::json!({
            "identifier": "inventory-browser",
            "description": "Allow the connected inventory window to open a Web address only.",
            "local": false,
            "remote": { "urls": [format!("{}/*", url.origin().ascii_serialization())] },
            "windows": ["inventory"],
            "permissions": ["allow-open-web-address", "allow-update-info", "allow-check-update", "allow-set-update-channel", "allow-download-update", "allow-install-update"]
        })
        .to_string(),
    )
    .map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(app, "inventory", WebviewUrl::External(url.clone()))
        .title("库存管理")
        .inner_size(1280., 850.)
        .min_inner_size(760., 560.)
        .visible(visible)
        .on_navigation(move |destination| destination.origin() == allowed.origin())
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|e| e.to_string())?;
    *app.state::<Runtime>().url.lock().unwrap() = Some(url);
    if let Some(window) = app.get_webview_window("launcher") {
        let _ = window.hide();
    }
    eprintln!("库存业务窗口已打开");
    Ok(())
}
#[tauri::command]
async fn connect_host(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    address: String,
) -> Result<(), String> {
    trusted(&window)?;
    let runtime = app.state::<Runtime>();
    let _connection = runtime.connection_lock.lock().await;
    let url = preferences::server_url(&address)?;
    verify_server(&url).await?;
    Preferences {
        mode: Some(Mode::Remote),
        server_url: url.to_string(),
    }
    .save(&config_path(&app)?)?;
    open_business(&app, url, true)
}
fn server_binary() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("无法找到应用目录")?;
    #[cfg(windows)]
    let name = "easy-erp-server.exe";
    #[cfg(not(windows))]
    let name = "easy-erp-server";
    let installed = dir.join(name);
    if installed.exists() {
        return Ok(installed);
    }
    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/debug")
            .join(name);
        if development.exists() {
            return Ok(development);
        }
    }
    Err("找不到内置服务程序，请重新安装完整桌面包。".into())
}
pub(crate) async fn ensure_local(app: &tauri::AppHandle) -> Result<url::Url, String> {
    let url = url::Url::parse(LOCAL_URL).unwrap();
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("server");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Ok(actual) = verify_server(&url).await {
        verify_local_identity(&dir, &actual)?;
    } else {
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("server.log"))
            .map_err(|e| e.to_string())?;
        let mut command = Command::new(server_binary()?);
        let token = updates::new_control_token(&dir)?;
        command
            .env("ERP_DESKTOP_CONTROL_TOKEN", token)
            .arg("--data-dir")
            .arg(&dir)
            .arg("--bind")
            .arg("0.0.0.0:4280")
            .stdin(Stdio::null())
            .stderr(log.try_clone().map_err(|e| e.to_string())?)
            .stdout(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("启动本机服务失败：{e}"))?;
        let mut ready = false;
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_millis(250)).await;
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                return Err(format!(
                    "本机服务启动后退出（{status}），请检查 {}。",
                    dir.join("server.log").display()
                ));
            }
            if let Ok(actual) = verify_server(&url).await {
                if let Err(error) = verify_local_identity(&dir, &actual) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
                ready = true;
                break;
            }
        }
        if !ready {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "本机服务未能启动，请检查 {}。",
                dir.join("server.log").display()
            ));
        }
        *app.state::<Runtime>().child.lock().unwrap() = Some(child);
    }
    Ok(url)
}

#[tauri::command]
async fn start_local(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    trusted(&window)?;
    let runtime = app.state::<Runtime>();
    let _connection = runtime.connection_lock.lock().await;
    let url = ensure_local(&app).await?;
    Preferences {
        mode: Some(Mode::Local),
        server_url: url.to_string(),
    }
    .save(&config_path(&app)?)?;
    open_business(&app, url, true)
}

#[tauri::command]
async fn resume_last(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<bool, String> {
    trusted(&window)?;
    let runtime = app.state::<Runtime>();
    let _connection = runtime.connection_lock.lock().await;
    let prefs = Preferences::load(&config_path(&app)?)?;
    let url = match prefs.mode {
        Some(Mode::Local) => ensure_local(&app).await?,
        Some(Mode::Remote) => {
            let url = preferences::server_url(&prefs.server_url)?;
            verify_server(&url).await?;
            url
        }
        None => return Ok(false),
    };
    open_business(&app, url, !std::env::args().any(|arg| arg == "--tray"))?;
    Ok(true)
}

#[tauri::command]
fn show_launcher(window: tauri::WebviewWindow) -> Result<(), String> {
    trusted(&window)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

fn browser(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("inventory") {
        return window
            .eval("window.dispatchEvent(new Event('erp:open-browser'))")
            .map_err(|e| e.to_string());
    }
    let address = app
        .state::<Runtime>()
        .url
        .lock()
        .unwrap()
        .clone()
        .ok_or("请先连接库存电脑。")?;
    launch_browser(&address)
}

fn launch_browser(address: &url::Url) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    command
        .arg(address.as_str())
        .status()
        .map_err(|e| format!("无法打开浏览器：{e}"))?
        .success()
        .then_some(())
        .ok_or("无法打开默认浏览器。".into())
}

fn browser_destination(source: &url::Url, address: &str) -> Result<url::Url, String> {
    let destination = url::Url::parse(address).map_err(|_| "访问地址格式不正确。")?;
    if !matches!(destination.scheme(), "http" | "https")
        || destination.scheme() != source.scheme()
        || destination.port_or_known_default() != source.port_or_known_default()
        || !destination.username().is_empty()
        || destination.password().is_some()
        || destination.path() != "/"
        || destination.query().is_some()
        || destination.fragment().is_some_and(|fragment| {
            !fragment
                .strip_prefix("/browser-login/")
                .is_some_and(|ticket| {
                    ticket.len() == 64 && ticket.bytes().all(|b| b.is_ascii_hexdigit())
                })
        })
        || !(destination.host() == source.host()
            || destination
                .host_str()
                .is_some_and(|h| h.parse::<std::net::Ipv4Addr>().is_ok()))
    {
        return Err("只能打开当前库存服务的访问地址。".into());
    }
    Ok(destination)
}

#[tauri::command]
async fn open_web_address(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    address: String,
) -> Result<(), String> {
    let source = app
        .state::<Runtime>()
        .url
        .lock()
        .unwrap()
        .clone()
        .ok_or("请先连接库存电脑。")?;
    if window.label() != "inventory"
        || window.url().map_err(|e| e.to_string())?.origin() != source.origin()
    {
        return Err("当前窗口没有打开浏览器的权限。".into());
    }
    let destination = browser_destination(&source, &address)?;
    let result = tauri::async_runtime::spawn_blocking(move || launch_browser(&destination))
        .await
        .map_err(|e| e.to_string())?;
    eprintln!("浏览器打开结果：{result:?}");
    result
}

#[tauri::command]
fn open_browser(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    trusted(&window)?;
    browser(&app)
}

pub(crate) async fn wait_for_local_exit(app: &tauri::AppHandle) -> Result<(), String> {
    for _ in 0..120 {
        {
            let runtime = app.state::<Runtime>();
            let mut child = runtime.child.lock().unwrap();
            if let Some(process) = child.as_mut() {
                if process.try_wait().map_err(|e| e.to_string())?.is_some() {
                    *child = None;
                    return Ok(());
                }
            } else {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("库存服务进程尚未结束，请稍后重试。".into())
}

fn menu_action(app: &tauri::AppHandle, id: &str) {
    match id {
        "open" => show_app(app),
        "connection" => {
            if let Some(w) = app.get_webview_window("launcher") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        "browser" => {
            let handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = browser(&handle)
                    && let Some(w) = handle.get_webview_window("launcher")
                {
                    let _ = w.show();
                    let _ = w.emit("startup-error", error);
                }
            });
        }
        "quit" => app.exit(0),
        "quit-all" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = updates::quit_all(&app).await {
                    if let Some(window) = app.get_webview_window("launcher") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("startup-error", format!("未能全部退出：{error}"));
                    }
                }
            });
        }
        _ => {}
    }
}

fn show_app(app: &tauri::AppHandle) {
    if let Some(window) = app
        .get_webview_window("inventory")
        .or_else(|| app.get_webview_window("launcher"))
    {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn tray_image() -> tauri::image::Image<'static> {
    tauri::image::Image::new(include_bytes!("../icons/tray.rgba"), 36, 36)
}
pub fn run() {
    tauri::Builder::default()
        .manage(Runtime::default())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_app(app)
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--tray"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            connection_settings,
            set_autostart,
            connect_host,
            start_local,
            resume_last,
            show_launcher,
            open_browser,
            open_web_address,
            updates::update_info,
            updates::check_update,
            updates::set_update_channel,
            updates::download_update,
            updates::install_update
        ])
        .setup(|app| {
            if app.config().plugins.0.contains_key("updater") {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            updates::resume_service(app.handle());
            let open = MenuItem::with_id(app, "open", "打开库存管理", true, None::<&str>)?;
            let connection =
                MenuItem::with_id(app, "connection", "连接与启动设置", true, None::<&str>)?;
            let quit =
                MenuItem::with_id(app, "quit", "仅退出界面（共享继续）", true, None::<&str>)?;
            let quit_all = MenuItem::with_id(
                app,
                "quit-all",
                "全部退出（停止本机共享）",
                true,
                None::<&str>,
            )?;
            let browser = MenuItem::with_id(app, "browser", "在浏览器中打开", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &browser, &connection, &quit, &quit_all])?;
            let application_menu = Submenu::with_items(
                app,
                "库存管理",
                true,
                &[&open, &browser, &connection, &quit, &quit_all],
            )?;
            let edit = Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;
            app.set_menu(Menu::with_items(app, &[&application_menu, &edit])?)?;
            TrayIconBuilder::new()
                .icon(tray_image())
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("库存管理 · 关闭窗口后继续在托盘运行")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_app(tray.app_handle());
                    }
                })
                .build(app)?;
            if std::env::args().any(|v| v == "--tray")
                && let Some(w) = app.get_webview_window("launcher")
            {
                w.hide()?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| menu_action(app, event.id.as_ref()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("桌面应用启动失败")
        .run(|_app, _event| {
            // macOS sends Reopen when the running application's Dock icon is
            // clicked; the single-instance callback does not receive it.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_app(_app);
            }
        });
}
