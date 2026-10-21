use sea_orm::DatabaseConnection;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, RwLock};

pub struct State {
    pub db: DatabaseConnection,
    pub database_info: serde_json::Value,
    pub files: std::sync::RwLock<Arc<crate::storage::FileStorage>>,
    pub server_mode: bool,
    pub setup_token: Option<String>,
    pub writes: Mutex<()>,
    pub data_dir: PathBuf,
    pub instance_id: String,
    pub failures: Mutex<HashMap<String, (u32, i64)>>,
    pub browser_tickets: Mutex<HashMap<String, crate::auth::BrowserTicket>>,
    pub backup_lock: Mutex<()>,
    pub secure: bool,
    pub trusted_proxy: bool,
    pub bind: std::net::SocketAddr,
    pub maintenance: RwLock<()>,
    pub desktop_token: Option<String>,
    pub updating: std::sync::atomic::AtomicBool,
    pub shutdown: tokio::sync::Notify,
}
pub type AppState = Arc<State>;

impl State {
    pub fn files(&self) -> Arc<crate::storage::FileStorage> {
        self.files.read().unwrap().clone()
    }
}
