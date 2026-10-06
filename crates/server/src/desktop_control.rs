//! Local installer coordination. The capability is supplied only by the native
//! launcher, never returned to a browser or accepted from a remote peer.
use crate::{
    auth::User,
    backup,
    error::{ApiError, Result},
    state::AppState,
};
use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::HeaderMap,
};
use serde_json::{Value, json};
use std::{net::SocketAddr, sync::atomic::Ordering};

pub async fn prepare_update(
    State(s): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<Value>> {
    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !peer.ip().is_loopback() || !authorized(s.desktop_token.as_deref(), provided) {
        return Err(ApiError::forbidden());
    }
    // Drain in-flight requests, then prevent any new writes until shutdown.
    let _maintenance = s.maintenance.write().await;
    if s.updating.load(Ordering::Acquire) {
        return Err(ApiError::conflict("库存服务正在准备更新。"));
    }
    let actor = User {
        id: "system".into(),
        username: "system".into(),
        name: "退出或升级前备份".into(),
        role: "admin".into(),
        can_in: false,
        can_out: false,
        can_count: false,
        active: true,
    };
    let backup = backup::create(&s, &actor).await?;
    s.updating.store(true, Ordering::Release);
    s.shutdown.notify_one();
    Ok(Json(
        json!({"backup": backup, "instance_id": s.instance_id}),
    ))
}

fn authorized(expected: Option<&str>, supplied: &str) -> bool {
    let Some(expected) = expected else {
        return false;
    };
    if expected.len() != 64 || supplied.len() != 64 {
        return false;
    }
    expected
        .bytes()
        .zip(supplied.bytes())
        .fold(0, |diff, (a, b)| diff | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capability_requires_configured_exact_secret() {
        let secret = "a".repeat(64);
        assert!(authorized(Some(&secret), &secret));
        assert!(!authorized(None, &secret));
        assert!(!authorized(Some(""), ""));
        assert!(!authorized(Some(&secret), &"b".repeat(64)));
        assert!(!authorized(Some(&secret), &secret[..63]));
    }
}
