use sea_orm::DatabaseConnection;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, RwLock};

pub struct State {
    pub db: DatabaseConnection,
    pub writes: Mutex<()>,
    pub data_dir: PathBuf,
    pub instance_id: String,
    pub failures: Mutex<HashMap<String, (u32, i64)>>,
    pub browser_tickets: Mutex<HashMap<String, crate::auth::BrowserTicket>>,
    pub backup_lock: Mutex<()>,
    pub secure: bool,
    pub bind: std::net::SocketAddr,
    pub maintenance: RwLock<()>,
}
pub type AppState = Arc<State>;
