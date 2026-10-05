fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "connection_settings",
            "set_autostart",
            "connect_host",
            "start_local",
            "resume_last",
            "show_launcher",
            "open_browser",
            "open_web_address",
            "update_info",
            "check_update",
            "download_update",
            "install_update",
            "mobile_settings",
            "mobile_connect",
            "mobile_resume",
            "mobile_disconnect",
        ]),
    ))
    .expect("build desktop permissions")
}
