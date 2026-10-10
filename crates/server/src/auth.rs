use crate::{
    db::*,
    error::{ApiError, Result},
    state::AppState,
};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Json,
    extract::{ConnectInfo, Path, Request, State},
    http::{HeaderMap, HeaderValue, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use rand::{RngCore, rngs::OsRng};
use sea_orm::TransactionTrait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;

const STANDARD_IDLE: i64 = 8 * 3600;
const REMEMBERED_IDLE: i64 = 30 * 86400;
const RENEW_INTERVAL: i64 = 5 * 60 * 1000;

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| {
                    v.split(';')
                        .find_map(|p| p.trim().strip_prefix("erp_session="))
                })
        })
}

fn session_cookie(raw: &str, age: i64, secure: bool) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "erp_session={raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age={age}{}",
        if secure { "; Secure" } else { "" }
    ))
    .expect("generated session cookie")
}

/// Renew only successful authenticated traffic; never recreate a revoked session.
pub async fn renew(State(s): State<AppState>, request: Request, next: Next) -> Response {
    let eligible = request.uri().path().starts_with("/api/")
        && !matches!(
            request.uri().path(),
            "/api/login"
                | "/api/logout"
                | "/api/setup"
                | "/api/status"
                | "/api/backups/restore"
                | "/api/browser-login/consume"
        );
    let raw = eligible
        .then(|| session_token(request.headers()).map(str::to_owned))
        .flatten();
    let mut response = next.run(request).await;
    if response.status().is_success()
        && let Some(raw) = raw
    {
        match renew_session(&s, &raw).await {
            Ok(Some(age)) => {
                response
                    .headers_mut()
                    .insert(header::SET_COOKIE, session_cookie(&raw, age, s.secure));
            }
            Ok(None) => {}
            Err(error) => tracing::warn!(?error, "登录续期失败；保留原有有效期"),
        }
    }
    response
}

async fn renew_session(s: &AppState, raw: &str) -> Result<Option<i64>> {
    let key = digest(raw);
    let time = now();
    let Some(row) = one(&s.db, "SELECT idle_seconds, expires_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=? AND sessions.expires_at>? AND users.active=1", vec![key.clone().into(),time.into()]).await? else { return Ok(None); };
    let age = int(&row, "idle_seconds");
    let expires = int(&row, "expires_at");
    if expires > time + age * 1000 - RENEW_INTERVAL {
        return Ok(None);
    }
    let updated = execute(&s.db, "UPDATE sessions SET expires_at=? WHERE id=? AND expires_at=? AND expires_at>? AND EXISTS (SELECT 1 FROM users WHERE users.id=sessions.user_id AND users.active=1)", vec![(time + age * 1000).into(),key.into(),expires.into(),time.into()]).await?;
    Ok((updated.rows_affected() == 1).then_some(age))
}

#[derive(Clone, Debug, Serialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub name: String,
    pub role: String,
    pub role_name: String,
    pub permissions: Vec<String>,
    pub can_in: bool,
    pub can_out: bool,
    pub can_count: bool,
    pub active: bool,
}
impl User {
    pub fn can(&self, permission: &str) -> bool {
        self.role == "admin" || self.permissions.iter().any(|p| p == permission)
    }
    pub fn require(&self, permission: &str) -> Result<()> {
        if self.can(permission) {
            Ok(())
        } else {
            Err(ApiError::forbidden())
        }
    }

    pub fn admin(&self) -> Result<()> {
        if self.role == "admin" {
            Ok(())
        } else {
            Err(ApiError::forbidden())
        }
    }
}
async fn user(db: &impl sea_orm::ConnectionTrait, row: &sea_orm::QueryResult) -> Result<User> {
    let writable = text(row, "role") != "viewer";
    let mut result = User {
        role_name: String::new(),
        permissions: vec![],
        id: text(row, "id"),
        username: text(row, "username"),
        name: text(row, "name"),
        role: text(row, "role"),
        can_in: writable && int(row, "can_in") == 1,
        can_out: writable && int(row, "can_out") == 1,
        can_count: writable && int(row, "can_count") == 1,
        active: int(row, "active") == 1,
    };
    crate::roles::hydrate(db, &mut result).await?;
    Ok(result)
}
pub fn token() -> String {
    let mut bytes = [0; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
pub fn digest(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
pub fn clean(value: &str, label: &str, max: usize, required: bool) -> Result<String> {
    let v = value.trim();
    if (required && v.is_empty())
        || v.chars().count() > max
        || v.chars().any(|c| c.is_control() && c != '\n')
    {
        return Err(ApiError::bad(format!(
            "{label}{}，最多 {max} 个字符。",
            if required {
                "不能为空"
            } else {
                "格式不正确"
            }
        )));
    }
    Ok(v.to_string())
}
fn username(value: &str) -> Result<String> {
    let v = value.trim().to_ascii_lowercase();
    if v.len() < 3
        || v.len() > 32
        || !v
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(ApiError::bad(
            "登录账号需为 3–32 位字母、数字、下划线或短横线。",
        ));
    }
    Ok(v)
}
async fn hash(password: String) -> Result<String> {
    if password.chars().count() < 8 || password.len() > 128 {
        return Err(ApiError::bad(
            "密码至少 8 个字符，最多 128 字节；可以使用一句容易记住的话。",
        ));
    }
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string())
    })
    .await
    .map_err(|_| ApiError::bad("密码处理失败，请重试。"))?
    .map_err(|_| ApiError::bad("密码处理失败，请重试。"))
}
pub async fn current(state: &AppState, headers: &HeaderMap) -> Result<User> {
    let cookie = headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "));
    let session = bearer
        .or_else(|| {
            cookie
                .split(';')
                .find_map(|part| part.trim().strip_prefix("erp_session="))
        })
        .ok_or_else(ApiError::unauthorized)?;
    let row=one(&state.db,"SELECT users.* FROM sessions JOIN users ON sessions.user_id=users.id WHERE sessions.id=? AND sessions.expires_at>? AND users.active=1",vec![digest(session).into(),now().into()]).await?.ok_or_else(ApiError::unauthorized)?;
    user(&state.db, &row).await
}
pub async fn status(State(s): State<AppState>) -> Result<Json<serde_json::Value>> {
    let initialized = one(&s.db, "SELECT id FROM users LIMIT 1", vec![])
        .await?
        .is_some();
    Ok(Json(
        json!({"initialized":initialized,"name":"库存主机","version":env!("CARGO_PKG_VERSION"),"instance_id":s.instance_id}),
    ))
}
#[derive(Deserialize)]
pub struct Setup {
    username: String,
    name: String,
    password: String,
}
pub async fn setup(
    State(s): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(input): Json<Setup>,
) -> Result<Json<serde_json::Value>> {
    if !peer.ip().is_loopback() {
        return Err(ApiError::forbidden());
    }
    let name = clean(&input.name, "姓名", 50, true)?;
    let login = username(&input.username)?;
    let password = hash(input.password).await?;
    let _lock = s.writes.lock().await;
    if one(&s.db, "SELECT id FROM users LIMIT 1", vec![])
        .await?
        .is_some()
    {
        return Err(ApiError::conflict("已经设置过管理员，请直接登录。"));
    }
    let txn = s.db.begin().await?;
    let uid = id();
    execute(
        &txn,
        "INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)",
        vec![
            uid.clone().into(),
            login.clone().into(),
            name.clone().into(),
            password.into(),
            "admin".into(),
            1i64.into(),
            1i64.into(),
            1i64.into(),
            1i64.into(),
            now().into(),
        ],
    )
    .await?;
    let actor = User {
        id: uid,
        username: login,
        name,
        role: "admin".into(),
        role_name: "管理员".into(),
        permissions: vec![],
        can_in: true,
        can_out: true,
        can_count: true,
        active: true,
    };
    audit(&txn, &actor, "初始化主机", "", json!({})).await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct Login {
    username: String,
    password: String,
    #[serde(default)]
    remember: bool,
}
pub async fn login(
    State(s): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(input): Json<Login>,
) -> Result<Response> {
    let login = username(&input.username)?;
    if input.password.len() > 128 {
        return Err(ApiError::bad("账号或密码不正确。"));
    }
    let key = peer.ip().to_string();
    {
        let mut failures = s.failures.lock().await;
        failures.retain(|_, (_, since)| now() - *since < 900_000);
        let (count, _) = failures.entry(key.clone()).or_insert((0, now()));
        if *count >= 15 {
            return Err(ApiError(
                axum::http::StatusCode::TOO_MANY_REQUESTS,
                "尝试次数较多，请 15 分钟后重试。".into(),
            ));
        }
        *count += 1;
    }
    let row = one(
        &s.db,
        "SELECT * FROM users WHERE username=? AND active=1",
        vec![login.into()],
    )
    .await?;
    let encoded = row.as_ref().map(|r| text(r, "password_hash"));
    let valid = tokio::task::spawn_blocking(move || {
        encoded
            .as_ref()
            .and_then(|h| PasswordHash::new(h).ok())
            .map(|h| {
                Argon2::default()
                    .verify_password(input.password.as_bytes(), &h)
                    .is_ok()
            })
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false);
    if !valid {
        return Err(ApiError(
            axum::http::StatusCode::UNAUTHORIZED,
            "账号或密码不正确，请检查后重试。".into(),
        ));
    }
    let actor = user(&s.db, &row.unwrap()).await?;
    let raw = token();
    let age = if input.remember {
        REMEMBERED_IDLE
    } else {
        STANDARD_IDLE
    };
    let _lock = s.writes.lock().await;
    // Recheck after password work: a concurrent account disable must take effect.
    if one(
        &s.db,
        "SELECT id FROM users WHERE id=? AND active=1",
        vec![actor.id.clone().into()],
    )
    .await?
    .is_none()
    {
        return Err(ApiError::unauthorized());
    }
    execute(
        &s.db,
        "INSERT INTO sessions (id,user_id,expires_at,created_at,idle_seconds) VALUES (?,?,?,?,?)",
        vec![
            digest(&raw).into(),
            actor.id.clone().into(),
            (now() + age * 1000).into(),
            now().into(),
            age.into(),
        ],
    )
    .await?;
    s.failures.lock().await.remove(&key);
    let mut response = Json(json!({"user":actor,"token":raw})).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, session_cookie(&raw, age, s.secure));
    Ok(response)
}
pub async fn me(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<User>> {
    Ok(Json(current(&s, &headers).await?))
}

pub struct BrowserTicket {
    source_session: String,
    target_host: String,
    expires_at: i64,
}

#[derive(Deserialize)]
pub struct BrowserTarget {
    target: String,
}

pub async fn browser_ticket(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<BrowserTarget>,
) -> Result<Json<serde_json::Value>> {
    let _lock = s.writes.lock().await;
    current(&s, &headers).await?;
    let uri = input
        .target
        .parse::<axum::http::Uri>()
        .map_err(|_| ApiError::bad("访问地址不正确。"))?;
    let authority = uri
        .authority()
        .ok_or_else(|| ApiError::bad("访问地址不正确。"))?;
    let host = authority.as_str();
    let current_host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let local_host = authority.port_u16() == Some(s.bind.port())
        && crate::network::addresses(s.bind)?
            .iter()
            .any(|ip| ip == authority.host());
    if !matches!(uri.scheme_str(), Some("http" | "https"))
        || (host != current_host && !local_host)
        || host.contains('@')
        || uri.path() != "/"
        || uri.query().is_some()
        || (s.secure && uri.scheme_str() != Some("https"))
    {
        return Err(ApiError::bad("只能为当前库存服务生成登录链接。"));
    }
    let source_session = digest(session_token(&headers).ok_or_else(ApiError::unauthorized)?);
    let raw = token();
    let mut tickets = s.browser_tickets.lock().await;
    tickets.retain(|_, t| t.expires_at > now());
    // Limit each session's outstanding links without affecting other users.
    tickets.retain(|_, t| t.source_session != source_session);
    tickets.insert(
        digest(&raw),
        BrowserTicket {
            source_session,
            target_host: host.to_string(),
            expires_at: now() + 30_000,
        },
    );
    Ok(Json(json!({"ticket": raw})))
}

#[derive(Deserialize)]
pub struct BrowserExchange {
    ticket: String,
}

pub async fn consume_browser_ticket(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<BrowserExchange>,
) -> Result<Response> {
    let invalid = || ApiError::bad("自动登录链接已失效，请返回桌面版重新点击“打开”。");
    if input.ticket.len() != 64 {
        return Err(invalid());
    }
    let _lock = s.writes.lock().await;
    let ticket = s
        .browser_tickets
        .lock()
        .await
        .remove(&digest(&input.ticket))
        .ok_or_else(invalid)?;
    if ticket.expires_at <= now()
        || headers.get(header::HOST).and_then(|v| v.to_str().ok())
            != Some(ticket.target_host.as_str())
    {
        return Err(invalid());
    }
    let row = one(&s.db, "SELECT users.*,sessions.idle_seconds FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=? AND sessions.expires_at>? AND users.active=1", vec![ticket.source_session.into(),now().into()]).await?.ok_or_else(invalid)?;
    let actor = user(&s.db, &row).await?;
    let age = int(&row, "idle_seconds");
    let raw = token();
    execute(
        &s.db,
        "INSERT INTO sessions (id,user_id,expires_at,created_at,idle_seconds) VALUES (?,?,?,?,?)",
        vec![
            digest(&raw).into(),
            actor.id.clone().into(),
            (now() + age * 1000).into(),
            now().into(),
            age.into(),
        ],
    )
    .await?;
    let mut response = Json(json!({"user": actor})).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, session_cookie(&raw, age, s.secure));
    Ok(response)
}
pub async fn logout(State(s): State<AppState>, headers: HeaderMap) -> Result<Response> {
    let _lock = s.writes.lock().await;
    let raw = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| {
                    v.split(';')
                        .find_map(|p| p.trim().strip_prefix("erp_session="))
                })
        });
    if let Some(t) = raw {
        execute(
            &s.db,
            "DELETE FROM sessions WHERE id=?",
            vec![digest(t).into()],
        )
        .await?;
    }
    let mut res = Json(json!({"ok":true})).into_response();
    res.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("erp_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"),
    );
    Ok(res)
}
pub async fn users(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<User>>> {
    current(&s, &headers).await?.admin()?;
    let mut users = Vec::new();
    for row in all(&s.db, "SELECT * FROM users ORDER BY created_at", vec![]).await? {
        users.push(user(&s.db, &row).await?);
    }
    Ok(Json(users))
}
#[derive(Deserialize)]
pub struct NewUser {
    username: String,
    name: String,
    password: String,
    role: String,
    #[serde(default = "enabled")]
    active: bool,
    #[serde(default)]
    can_in: bool,
    #[serde(default)]
    can_out: bool,
    #[serde(default)]
    can_count: bool,
}
fn enabled() -> bool {
    true
}
pub async fn create_user(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<NewUser>,
) -> Result<Json<User>> {
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    let login = username(&input.username)?;
    let name = clean(&input.name, "姓名", 50, true)?;
    let hash = hash(input.password).await?;
    let _lock = s.writes.lock().await;
    if one(
        &s.db,
        "SELECT id FROM users WHERE username=?",
        vec![login.clone().into()],
    )
    .await?
    .is_some()
    {
        return Err(ApiError::conflict("该登录账号已存在，请换一个账号。"));
    }
    let role = crate::roles::resolve(
        &s.db,
        &input.role,
        input.can_in,
        input.can_out,
        input.can_count,
    )
    .await?;
    let writable = role != "viewer";
    let mut u = User {
        role_name: String::new(),
        permissions: vec![],
        id: id(),
        username: login,
        name,
        role,
        can_in: writable && input.can_in,
        can_out: writable && input.can_out,
        can_count: writable && input.can_count,
        active: input.active,
    };
    let txn = s.db.begin().await?;
    execute(
        &txn,
        "INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)",
        vec![
            u.id.clone().into(),
            u.username.clone().into(),
            u.name.clone().into(),
            hash.into(),
            u.role.clone().into(),
            (u.can_in as i64).into(),
            (u.can_out as i64).into(),
            (u.can_count as i64).into(),
            (u.active as i64).into(),
            now().into(),
        ],
    )
    .await?;
    audit(
        &txn,
        &actor,
        "新增账号",
        &u.id,
        json!({"name":u.name,"role":u.role}),
    )
    .await?;
    txn.commit().await?;
    crate::roles::hydrate(&s.db, &mut u).await?;
    Ok(Json(u))
}
#[derive(Deserialize)]
pub struct UpdateUser {
    name: String,
    role: Option<String>,
    active: bool,
    #[serde(default)]
    can_in: bool,
    #[serde(default)]
    can_out: bool,
    #[serde(default)]
    can_count: bool,
    password: Option<String>,
}
pub async fn update_user(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(uid): Path<String>,
    Json(input): Json<UpdateUser>,
) -> Result<Json<serde_json::Value>> {
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    let name = clean(&input.name, "姓名", 50, true)?;
    let hash = match input.password {
        Some(p) if !p.is_empty() => Some(hash(p).await?),
        _ => None,
    };
    let _lock = s.writes.lock().await;
    let old = one(
        &s.db,
        "SELECT * FROM users WHERE id=?",
        vec![uid.clone().into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    if text(&old, "role") == "admin" && !input.active {
        return Err(ApiError::bad("不能停用管理员账号。"));
    }
    let old_role = text(&old, "role");
    let requested = input.role.as_deref().unwrap_or(&old_role);
    let role = if old_role == "admin" {
        if requested != "admin" {
            return Err(ApiError::bad("管理员角色不能更改。"));
        }
        "admin".to_string()
    } else {
        crate::roles::resolve(
            &s.db,
            requested,
            input.can_in,
            input.can_out,
            input.can_count,
        )
        .await?
    };
    let can_in = role != "viewer" && input.can_in;
    let can_out = role != "viewer" && input.can_out;
    let can_count = role != "viewer" && input.can_count;
    let txn = s.db.begin().await?;
    execute(
        &txn,
        "UPDATE users SET name=?,active=?,can_in=?,can_out=?,can_count=?,role=? WHERE id=?",
        vec![
            name.into(),
            (input.active as i64).into(),
            (can_in as i64).into(),
            (can_out as i64).into(),
            (can_count as i64).into(),
            role.clone().into(),
            uid.clone().into(),
        ],
    )
    .await?;
    if let Some(p) = hash {
        execute(
            &txn,
            "UPDATE users SET password_hash=? WHERE id=?",
            vec![p.into(), uid.clone().into()],
        )
        .await?;
    }
    execute(
        &txn,
        "DELETE FROM sessions WHERE user_id=?",
        vec![uid.clone().into()],
    )
    .await?;
    audit(&txn,&actor,"修改账号权限",&uid,json!({"role":role,"active":input.active,"can_in":can_in,"can_out":can_out,"can_count":can_count})).await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
