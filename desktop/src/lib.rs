#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;
mod preferences;
#[cfg(desktop)]
mod update_channel;
#[cfg(desktop)]
mod updates;
#[cfg(desktop)]
mod update_network;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    desktop::run();
    #[cfg(mobile)]
    mobile::run();
}
