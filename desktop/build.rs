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
        ]),
    ))
    .expect("build desktop permissions")
}
