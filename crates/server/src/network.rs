use crate::{auth, error::Result, state::AppState};
use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::HeaderMap,
};
use serde_json::{Value, json};
use std::net::{IpAddr, SocketAddr};

/// Only advertise interfaces actually covered by the listening socket.
pub fn addresses(bind: SocketAddr) -> std::io::Result<Vec<String>> {
    let mut ips = if bind.ip().is_unspecified() && bind.is_ipv4() {
        if_addrs::get_if_addrs()?
            .into_iter()
            .filter_map(|interface| match interface.ip() {
                IpAddr::V4(ip) if !ip.is_unspecified() && !ip.is_multicast() => Some(ip),
                _ => None,
            })
            .collect::<Vec<_>>()
    } else if let IpAddr::V4(ip) = bind.ip() {
        vec![ip]
    } else {
        vec![]
    };
    ips.sort();
    ips.dedup();
    Ok(ips.into_iter().map(|ip| ip.to_string()).collect())
}

pub async fn list(
    State(s): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    auth::current(&s, &headers).await?;
    let addresses = addresses(s.bind)?;
    let items = addresses
        .iter()
        .filter_map(|ip| {
            let local = ip.parse::<IpAddr>().ok()?.is_loopback();
            if local && !peer.ip().is_loopback() {
                return None;
            }
            Some(json!({"ip": ip, "local": local}))
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"items": items, "port": s.bind.port()})))
}
