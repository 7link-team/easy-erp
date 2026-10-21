use crate::preferences::{self, LOCAL_URL, Mode, Preferences};
use crate::{recovery, updates};
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
    pub(crate) recovery_busy: std::sync::atomic::AtomicBool,
    url: Mutex<Option<url::Url>>,
    pub(crate) connection_lock: tokio::sync::Mutex<()>,
}

pub(crate) fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connection.json"))
}
/// Visible, platform-independent name for the business data directory, so the
/// operator finds the same folder on either system.
#[cfg(any(windows, target_os = "macos"))]
pub(crate) const DATA_DIRECTORY: &str = "EasyERP";

pub(crate) fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let legacy = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("server");
    #[cfg(windows)]
    {
        let preferred = app
            .path()
            .home_dir()
            .map_err(|e| e.to_string())?
            .join(DATA_DIRECTORY);
        crate::data_location::select(&preferred, &legacy)
    }
    #[cfg(target_os = "macos")]
    {
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        // Business data has lived in two earlier places: beside the application
        // support files, and then in a dot directory that Finder hides by
        // default. Both move into the visible directory, and the operator is
        // told to pick rather than having two inventories merged.
        crate::data_location::select_macos(
            &home.join(DATA_DIRECTORY),
            &[legacy, home.join(".EasyERP")],
        )
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    Ok(legacy)
}
fn launcher_origin_allowed(url: &url::Url, dev_url: Option<&url::Url>) -> bool {
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    ) || (cfg!(debug_assertions)
        && dev_url.is_some_and(|configured| url.origin() == configured.origin()))
}

#[cfg(test)]
mod launcher_origin_tests {
    use super::launcher_origin_allowed;
    use url::Url;

    #[test]
    fn accepts_packaged_launcher_without_development_server() {
        for address in [
            "tauri://localhost/",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
        ] {
            assert!(launcher_origin_allowed(&Url::parse(address).unwrap(), None));
        }
    }

    #[test]
    fn development_launcher_requires_the_configured_origin() {
        let configured = Url::parse("http://127.0.0.1:1430/").unwrap();
        assert_eq!(
            launcher_origin_allowed(&configured.join("index.html").unwrap(), Some(&configured)),
            cfg!(debug_assertions)
        );
        for address in [
            "http://127.0.0.1:4291/",
            "http://127.0.0.1:4280/",
            "http://localhost:1430/",
            "https://127.0.0.1:1430/",
            "https://example.com/",
        ] {
            let url = Url::parse(address).unwrap();
            assert!(!launcher_origin_allowed(&url, Some(&configured)));
            assert!(!launcher_origin_allowed(&url, None));
        }
    }
}

pub(crate) fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "launcher"
        && window
            .url()
            .is_ok_and(|url| launcher_origin_allowed(&url, window.config().build.dev_url.as_ref()))
    {
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
    let dir = data_dir(&app)?;
    let configured = dir.join("database.json").exists() || dir.join("inventory.sqlite").exists();
    Ok(
        serde_json::json!({"server_url":pref.server_url,"mode":pref.mode,"autostart":autostart,"database_configured":configured}),
    )
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

pub(crate) async fn verify_server(url: &url::Url) -> Result<String, String> {
    let response = reqwest::Client::builder()
        .no_proxy()
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

pub(crate) fn verify_local_identity(dir: &std::path::Path, actual: &str) -> Result<(), String> {
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
pub(crate) async fn open_business(
    app: &tauri::AppHandle,
    url: url::Url,
    visible: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("inventory") {
        window.destroy().map_err(|e| e.to_string())?;
        // The label is released only when the event loop delivers Destroyed;
        // building before that fails and leaves no business window at all.
        for _ in 0..40 {
            if app.get_webview_window("inventory").is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    let allowed = url.clone();
    app.add_capability(
        serde_json::json!({
            "identifier": "inventory-browser",
            "description": "Allow the connected inventory window to open a Web address only.",
            "local": false,
            "remote": { "urls": [format!("{}/*", url.origin().ascii_serialization())] },
            "windows": ["inventory"],
            "permissions": ["allow-file-locations", "allow-reveal-file", "allow-open-web-address", "allow-open-data-maintenance", "allow-print-document", "allow-update-info", "allow-check-update", "allow-set-update-channel", "allow-download-update", "allow-install-update"]
        })
        .to_string(),
    )
    .map_err(|e| e.to_string())?;
    // Record the address before building so a failed build cannot leave the
    // tray and the saved connection pointing at different hosts.
    *app.state::<Runtime>().url.lock().unwrap() = Some(url.clone());
    WebviewWindowBuilder::new(app, "inventory", WebviewUrl::External(url.clone()))
        .title("库存管理")
        .inner_size(1280., 850.)
        .min_inner_size(760., 560.)
        .visible(visible)
        .on_navigation(move |destination| destination.origin() == allowed.origin())
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(|webview, event| match event {
            tauri::webview::DownloadEvent::Requested { url, destination } => {
                match webview.app_handle().path().download_dir() {
                    Ok(folder) => {
                        *destination = download_destination(&folder, destination);
                        true
                    }
                    Err(_) => {
                        download_report(&webview, None, false);
                        eprintln!("找不到下载文件夹，已取消下载：{url}");
                        false
                    }
                }
            }
            // Taking over the destination also takes over telling the user:
            // both engines stop showing their own download UI once a host
            // handler answers, so without this the file lands in the download
            // folder and the button looks like it did nothing.
            tauri::webview::DownloadEvent::Finished { path, success, .. } => {
                download_report(&webview, path.as_deref(), success);
                true
            }
            _ => true,
        })
        .build()
        .map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("launcher") {
        let _ = window.hide();
    }
    eprintln!("库存业务窗口已打开");
    Ok(())
}

/// Business pages download through plain links. A packaged WKWebView or
/// WebView2 discards those unless a download handler is registered — the
/// navigation is allowed, nothing can render it, and 下载完整备份 looks like it
/// did nothing. The links carry `download` so the webview decides at the
/// navigation action rather than by guessing from the MIME type, which a CSV
/// export would otherwise render in place of the application.
/// The platform already resolves the user's download folder and
/// the file name the server suggested, so keep that choice and only add the
/// guard it lacks: a name that carries directories of its own is reduced to
/// its last component, and a rebuilt name is numbered rather than overwriting
/// an earlier download.
/// Tells the business pages where a download landed. Serialised as JSON so a
/// Windows path's backslashes survive the trip into the event detail.
fn download_report(webview: &tauri::Webview, path: Option<&std::path::Path>, success: bool) {
    let detail = serde_json::json!({
        "path": path.map(|p| p.to_string_lossy().into_owned()),
        "success": success,
    });
    let _ = webview.eval(format!(
        "window.dispatchEvent(new CustomEvent('erp:download-finished',{{detail:{detail}}}))"
    ));
}
fn download_destination(folder: &std::path::Path, suggested: &std::path::Path) -> PathBuf {
    if suggested.parent() == Some(folder) {
        return suggested.to_path_buf();
    }
    let name = suggested
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let bare = std::path::Path::new(&name);
    let stem = bare
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let extension = bare
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy()))
        .unwrap_or_default();
    let mut candidate = folder.join(&name);
    for attempt in 2..1000 {
        if !candidate.exists() {
            break;
        }
        candidate = folder.join(format!("{stem} ({attempt}){extension}"));
    }
    candidate
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
    open_business(&app, url, true).await
}
pub(crate) fn server_binary() -> Result<PathBuf, String> {
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
    let dir = data_dir(app)?;
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
        let token = updates::new_control_token();
        command
            .env("ERP_DESKTOP_CONTROL_TOKEN", &token)
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
        // A first launch after upgrading a large ledger may need minutes to
        // build query indexes. Keep checking the owned process while it works.
        let startup_deadline = std::time::Instant::now() + Duration::from_secs(600);
        while std::time::Instant::now() < startup_deadline {
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
        // Only now is the old secret safe to replace: a live service we failed
        // to probe keeps answering with the token it already loaded.
        if let Err(error) = updates::write_control_token(&dir, &token) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        *app.state::<Runtime>().child.lock().unwrap() = Some(child);
    }
    Ok(url)
}

/// Runs the inventory server once to write a configuration file, passing the
/// JSON on stdin so passwords never appear in argv. The first run has no
/// administrator yet, so the HTTP endpoints cannot be used for this.
fn configure_once(
    binary: PathBuf,
    dir: PathBuf,
    flag: &'static str,
    payload: serde_json::Value,
    fallback: &'static str,
) -> Result<(), String> {
    use std::io::Write;
    let mut command = Command::new(binary);
    command
        .arg("--data-dir")
        .arg(dir)
        .arg(flag)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "无法启动初始化程序。".to_owned())?;
    child
        .stdin
        .take()
        .ok_or("无法传入配置。")?
        .write_all(&serde_json::to_vec(&payload).map_err(|_| "配置格式无效。")?)
        .map_err(|_| "无法传入配置。")?;
    let output = child
        .wait_with_output()
        .map_err(|_| "初始化程序未正常结束。")?;
    if !output.status.success() {
        let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap_or_default();
        return Err(result["error"].as_str().unwrap_or(fallback).to_owned());
    }
    Ok(())
}

#[tauri::command]
async fn start_local(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    database: Option<serde_json::Value>,
    storage: Option<serde_json::Value>,
) -> Result<(), String> {
    trusted(&window)?;
    let runtime = app.state::<Runtime>();
    let _connection = runtime.connection_lock.lock().await;
    // Storage first: it is the step that can fail on a typo after a round trip
    // to the object store, and failing before the database is created leaves
    // the directory reusable instead of half initialised.
    for (flag, payload, fallback) in [
        (
            "--configure-storage",
            storage,
            "文件存储初始化失败，请检查桶名、endpoint、凭据及本机服务日志。",
        ),
        (
            "--configure-database",
            database,
            "数据库初始化失败，请检查连接信息及本机服务日志。",
        ),
    ] {
        let Some(payload) = payload else { continue };
        let dir = data_dir(&app)?;
        let binary = server_binary()?;
        tauri::async_runtime::spawn_blocking(move || {
            configure_once(binary, dir, flag, payload, fallback)
        })
        .await
        .map_err(|error| error.to_string())??;
    }
    let url = ensure_local(&app).await?;
    Preferences {
        mode: Some(Mode::Local),
        server_url: url.to_string(),
    }
    .save(&config_path(&app)?)?;
    open_business(&app, url, true).await
}

#[tauri::command]
async fn resume_last(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<bool, String> {
    trusted(&window)?;
    let runtime = app.state::<Runtime>();
    let _connection = runtime.connection_lock.lock().await;
    let prefs = Preferences::load(&config_path(&app)?)?;
    let url = match prefs.mode {
        // A saved local connection means this machine served its own data at
        // least once, so a data directory that is now gone was removed from
        // outside the application. Resuming would quietly start a new, empty
        // ledger behind a login screen; show the launcher and let the operator
        // decide instead. data_dir only resolves the path — ensure_local is
        // what would create it.
        Some(Mode::Local) if !data_dir(&app)?.exists() => return Ok(false),
        Some(Mode::Local) => ensure_local(&app).await?,
        Some(Mode::Remote) => {
            let url = preferences::server_url(&prefs.server_url)?;
            verify_server(&url).await?;
            url
        }
        None => return Ok(false),
    };
    let visible = !std::env::args().any(|arg| arg == "--tray");
    open_business(&app, url, visible).await?;
    Ok(true)
}

// Closing maintenance must not reconnect: doing so would destroy the current
// business window and lose its route or unsaved work.
#[tauri::command]
fn close_data_maintenance(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    trusted(&window)?;
    if app
        .state::<Runtime>()
        .recovery_busy
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("维护正在执行，请稍后关闭。".into());
    }
    if let Some(business) = app.get_webview_window("inventory") {
        business.unminimize().map_err(|e| e.to_string())?;
        business.show().map_err(|e| e.to_string())?;
        business.set_focus().map_err(|e| e.to_string())?;
        window.hide().map_err(|e| e.to_string())?;
        return Ok(true);
    }
    // No business window after startup failure or offline maintenance: leave
    // the existing connection controls available, without starting a service.
    Ok(false)
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
        || !crate::browser_address::print_query_allowed(&destination)
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
async fn print_document(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
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
        return Err("当前窗口没有打印权限。".into());
    }
    window.print().map_err(|e| format!("无法打开系统打印：{e}"))
}

// Business content may only reveal this installation's local data, never a
// remote server's path or an arbitrary path supplied by web content.
fn local_path_access(
    window: &tauri::WebviewWindow,
    app: &tauri::AppHandle,
) -> Result<bool, String> {
    if trusted(window).is_ok() {
        return Ok(true);
    }
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
        return Err("当前窗口没有查看本机文件的权限。".into());
    }
    Ok(
        Preferences::load(&config_path(app)?)?.mode == Some(Mode::Local)
            && source.as_str() == LOCAL_URL,
    )
}

#[tauri::command]
fn file_locations(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    if !local_path_access(&window, &app)? {
        return Ok(serde_json::json!({"local": false, "items": []}));
    }
    let dir = data_dir(&app)?;
    let config = config_path(&app)?;
    // Two folders the operator can open, not a row per file: the database, its
    // log, the backups and the attachments all sit in the data directory, and
    // the connection and update settings in the configuration directory. The
    // settings cannot move into the data directory, because a machine that only
    // connects to another inventory computer keeps no business data at all and
    // still has to know which host to reach.
    let mut items = vec![
        serde_json::json!({"label": "本机数据目录", "path": dir}),
        serde_json::json!({"label": "配置目录", "path": config.parent()}),
    ];
    for item in &mut items {
        if let Some(path) = item["path"].as_str().map(PathBuf::from) {
            if let Ok(metadata) = path.metadata() {
                item["exists"] = serde_json::json!(true);
                item["size"] = if metadata.is_file() {
                    serde_json::json!(metadata.len())
                } else {
                    serde_json::Value::Null
                };
                item["modified"] = serde_json::json!(
                    metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|t| t.as_millis() as u64)
                );
            } else {
                item["exists"] = serde_json::json!(false);
            }
        }
    }
    let details = serde_json::json!([
        {"label":"桌面版本", "value":app.package_info().version.to_string()},
        {"label":"开机启动", "value":match app.autolaunch().is_enabled() { Ok(true) => "开启", Ok(false) => "关闭", Err(_) => "无法读取" }},
        {"label":"更新渠道", "value":crate::update_channel::Channel::load(&config.parent().unwrap().join("update-channel.json")).map(|c| match c { crate::update_channel::Channel::Stable => "稳定版", crate::update_channel::Channel::Preview => "测试版" }).unwrap_or("无法读取")}
    ]);
    Ok(serde_json::json!({"local": true, "items": items, "details":details}))
}

fn reveal_target(
    path: &std::path::Path,
    root: Option<&std::path::Path>,
    config: Option<&std::path::Path>,
) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("只能查看本机的绝对文件路径。".into());
    }
    let target = path
        .canonicalize()
        .map_err(|e| format!("路径不存在或无法访问：{e}"))?;
    if let Some(root) = root {
        let within = root
            .canonicalize()
            .is_ok_and(|root| target.starts_with(root));
        let is_config = config.and_then(|p| p.parent()).is_some_and(|dir| {
            dir.canonicalize().is_ok_and(|p| p == target)
                || [
                    "connection.json",
                    "update-channel.json",
                    "update-check-stable.json",
                    "update-check-preview.json",
                ]
                .iter()
                .any(|name| dir.join(name).canonicalize().is_ok_and(|p| p == target))
        });
        if !within && !is_config {
            return Err("只能查看当前本机库存的数据文件。".into());
        }
    }
    if !target.is_file() && !target.is_dir() {
        return Err("该路径不是普通文件或目录。".into());
    }
    Ok(target)
}

#[tauri::command]
async fn reveal_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    if !local_path_access(&window, &app)? {
        return Err("这是远程库存电脑的路径，请到对应电脑查看。".into());
    }
    let launcher = trusted(&window).is_ok();
    let root = data_dir(&app)?;
    let config = config_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let target = reveal_target(
            std::path::Path::new(&path),
            (!launcher).then_some(root.as_path()),
            Some(&config),
        )
        .or_else(|error| {
            if !launcher
                && let Some(storage) =
                    std::env::var_os("ERP_STORAGE_LOCAL_DIR").filter(|v| !v.is_empty())
            {
                return reveal_target(
                    std::path::Path::new(&path),
                    Some(std::path::Path::new(&storage)),
                    Some(&config),
                );
            }
            Err(error)
        })?;
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut c = Command::new("open");
            if target.is_file() {
                c.arg("-R");
            }
            c.arg(&target);
            c
        };
        #[cfg(target_os = "windows")]
        let mut command = {
            use std::os::windows::process::CommandExt;
            let mut c = Command::new("explorer.exe");
            // Open the containing directory without ever executing the file.
            c.arg(if target.is_dir() {
                target.as_path()
            } else {
                target.parent().unwrap()
            });
            c.creation_flags(0x08000000);
            c
        };
        #[cfg(target_os = "linux")]
        let mut command = {
            let mut c = Command::new("xdg-open");
            c.arg(if target.is_dir() {
                target.as_path()
            } else {
                target.parent().unwrap()
            });
            c
        };
        #[cfg(target_os = "windows")]
        {
            // Explorer can hand off to an existing process and return a nonzero
            // status despite success; only report whether launching succeeded.
            command
                .spawn()
                .map_err(|e| format!("无法打开文件管理器：{e}"))?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            let status = command
                .status()
                .map_err(|e| format!("无法打开文件管理器：{e}"))?;
            if !status.success() {
                return Err("文件管理器未能打开该路径。".into());
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_data_maintenance(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
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
        return Err("请从库存管理窗口打开本机数据维护。".into());
    }
    let launcher = app
        .get_webview_window("launcher")
        .ok_or("找不到本机数据维护窗口，请重启桌面版。")?;
    launcher.show().map_err(|e| e.to_string())?;
    launcher.set_focus().map_err(|e| e.to_string())?;
    launcher
        .emit("open-recovery", ())
        .map_err(|e| e.to_string())
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
    let destination = match url::Url::parse(&address) {
        Ok(url) if crate::browser_address::project_url_allowed(&url) => url,
        _ => browser_destination(&source, &address)?,
    };
    let result = tauri::async_runtime::spawn_blocking(move || launch_browser(&destination))
        .await
        .map_err(|e| e.to_string())?;
    eprintln!("浏览器打开结果：{result:?}");
    result
}

#[tauri::command]
async fn open_browser(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || browser(&app))
        .await
        .map_err(|e| e.to_string())?
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
    if app
        .state::<Runtime>()
        .recovery_busy
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    match id {
        "recovery" => {
            if let Some(window) = app.get_webview_window("launcher") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("open-recovery", ());
            }
        }
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
        .plugin(tauri_plugin_dialog::init())
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
            recovery::recovery_list,
            recovery::recovery_select_backup,
            recovery::recovery_execute,
            connection_settings,
            set_autostart,
            connect_host,
            start_local,
            resume_last,
            show_launcher,
            open_browser,
            open_data_maintenance,
            close_data_maintenance,
            file_locations,
            reveal_file,
            open_web_address,
            print_document,
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
            let recovery = MenuItem::with_id(app, "recovery", "本机数据维护", true, None::<&str>)?;
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
            let menu = Menu::with_items(
                app,
                &[&open, &browser, &connection, &recovery, &quit, &quit_all],
            )?;
            let application_menu = Submenu::with_items(
                app,
                "库存管理",
                true,
                &[&open, &browser, &connection, &recovery, &quit, &quit_all],
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
                if !window
                    .app_handle()
                    .state::<Runtime>()
                    .recovery_busy
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("桌面应用启动失败")
        .run(|_app, _event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &_event
                && _app
                    .state::<Runtime>()
                    .recovery_busy
                    .load(std::sync::atomic::Ordering::SeqCst)
            {
                api.prevent_exit();
            }
            // macOS sends Reopen when the running application's Dock icon is
            // clicked; the single-instance callback does not receive it.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_app(_app);
            }
        });
}

#[cfg(test)]
mod file_location_tests {
    use super::reveal_target;
    use std::path::Path;

    #[test]
    fn reveal_requires_existing_absolute_path_within_local_scope() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let file = root.path().join("备份 with spaces.zip");
        std::fs::write(&file, "test").unwrap();
        assert_eq!(
            reveal_target(&file, Some(root.path()), None).unwrap(),
            file.canonicalize().unwrap()
        );
        assert!(reveal_target(root.path(), Some(root.path()), None).is_ok());
        assert!(reveal_target(Path::new("relative.zip"), None, None).is_err());
        assert!(reveal_target(&root.path().join("missing.zip"), None, None).is_err());
        assert!(reveal_target(Path::new("s3://bucket/backup.zip"), None, None).is_err());
        assert!(reveal_target(outside.path(), Some(root.path()), None).is_err());
        let config = outside.path().join("connection.json");
        std::fs::write(&config, "{}").unwrap();
        assert!(reveal_target(&config, Some(root.path()), Some(&config)).is_ok());
        assert!(reveal_target(outside.path(), Some(root.path()), Some(&config)).is_ok());
        let other = outside.path().join("not-allowed.json");
        std::fs::write(&other, "{}").unwrap();
        assert!(reveal_target(&other, Some(root.path()), Some(&config)).is_err());
        assert!(reveal_target(&config, None, None).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn reveal_rejects_symlink_escape() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let link = root.path().join("external");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        assert!(reveal_target(&link, Some(root.path()), None).is_err());
    }
}

#[cfg(test)]
mod download_tests {
    use super::download_destination;
    use std::path::Path;

    #[test]
    fn downloads_keep_the_platform_name_but_never_leave_the_download_folder() {
        let temporary = tempfile::tempdir().unwrap();
        let folder = temporary.path();
        // The folder and name the platform resolved are kept untouched.
        let suggested = folder.join("backup-20261019-180000-ab12cd34.zip");
        assert_eq!(download_destination(folder, &suggested), suggested);
        // Names the server sends are preserved verbatim, including non-ASCII.
        assert_eq!(
            download_destination(folder, Path::new("/tmp/库存-20261019.csv")),
            folder.join("库存-20261019.csv")
        );
        // A name carrying directories of its own cannot write outside.
        assert_eq!(
            download_destination(folder, &folder.join("../../etc/passwd")),
            folder.join("passwd")
        );
        assert_eq!(
            download_destination(folder, Path::new("/tmp/elsewhere/items.csv")),
            folder.join("items.csv")
        );
        assert_eq!(
            download_destination(folder, Path::new("/")),
            folder.join("download")
        );
        // A rebuilt name is numbered instead of replacing an earlier file.
        std::fs::write(folder.join("items.csv"), "one").unwrap();
        assert_eq!(
            download_destination(folder, Path::new("/tmp/items.csv")),
            folder.join("items (2).csv")
        );
        std::fs::write(folder.join("items (2).csv"), "two").unwrap();
        assert_eq!(
            download_destination(folder, Path::new("/tmp/items.csv")),
            folder.join("items (3).csv")
        );
        assert_eq!(
            std::fs::read_to_string(folder.join("items.csv")).unwrap(),
            "one"
        );
    }
}
