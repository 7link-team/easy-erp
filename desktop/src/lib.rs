mod browser_address;
#[cfg(all(desktop, any(windows, test)))]
mod data_location;
#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;
mod preferences;
#[cfg(desktop)]
mod update_channel;
#[cfg(desktop)]
mod update_network;
#[cfg(desktop)]
mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    desktop::run();
    #[cfg(mobile)]
    mobile::run();
}
