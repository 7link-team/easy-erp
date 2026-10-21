//! Local-calendar report jobs. Settings persist both pending attempts and successful keys.
use crate::{
    auth::{User, current},
    db::{all, execute, one, text},
    error::{ApiError, Result},
    reports::{self, Format, Period},
    state::AppState,
};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{Local, NaiveDate, Timelike};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::sync::Mutex;

// Serializes reentrant ticks and configuration updates, without holding business writes
// across network requests. The server holds its existing exclusive data-directory lock.
static TICK: Mutex<()> = Mutex::const_new(());

#[derive(Clone, Serialize, Deserialize)]
pub struct Schedule {
    webhook: String,
    format: Format,
    hour: u32,
    minute: u32,
    periods: Vec<Period>,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            webhook: String::new(),
            format: Format::Xlsx,
            hour: 18,
            minute: 0,
            periods: vec![],
        }
    }
}
async fn value(db: &DatabaseConnection, key: &str) -> Result<String> {
    Ok(one(
        db,
        "SELECT value FROM settings WHERE id=?",
        vec![key.into()],
    )
    .await?
    .map(|r| text(&r, "value"))
    .unwrap_or_default())
}
async fn save(db: &DatabaseConnection, key: &str, value: &str) -> Result<()> {
    execute(db, "INSERT INTO settings (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", vec![key.into(), value.into()]).await?;
    Ok(())
}
async fn settings(db: &DatabaseConnection) -> Result<Schedule> {
    let raw = value(db, "report_schedule").await?;
    if raw.is_empty() {
        return Ok(Schedule::default());
    }
    serde_json::from_str(&raw).map_err(|_| ApiError::bad("报告计划配置无效，请重新保存。"))
}
fn masked(config: &Schedule) -> Value {
    // A boolean-only mask cannot disclose short keys or be mistaken for a saved URL.
    json!({"webhook": if config.webhook.is_empty() { "" } else { "****" },
        "webhook_set": !config.webhook.is_empty(), "format": config.format,
        "hour":config.hour, "minute":config.minute, "periods":config.periods})
}
pub async fn get(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    current(&s, &headers).await?;
    let mut out = masked(&settings(&s.db).await?);
    out["last_error"] = value(&s.db, "report_last_error").await?.into();
    Ok(Json(out))
}
pub async fn put(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<Schedule>,
) -> Result<Json<Value>> {
    current(&s, &headers).await?.admin()?;
    if input.hour > 23 || input.minute > 59 {
        return Err(ApiError::bad("报告时间无效。"));
    }
    let _tick = TICK.lock().await;
    // Round-tripping the mask preserves the existing secret; empty explicitly clears it.
    if input.webhook == "****" {
        input.webhook = settings(&s.db).await?.webhook;
    }
    if !input.webhook.is_empty() {
        endpoints(&input.webhook)?;
    }
    let _writes = s.writes.lock().await;
    save(
        &s.db,
        "report_schedule",
        &serde_json::to_string(&input).unwrap(),
    )
    .await?;
    Ok(Json(masked(&input)))
}
fn endpoints(webhook: &str) -> Result<(reqwest::Url, reqwest::Url, String)> {
    let invalid = || ApiError::bad("企业微信机器人地址无效。");
    let send = reqwest::Url::parse(webhook).map_err(|_| invalid())?;
    if !matches!(send.scheme(), "http" | "https")
        || send.host_str().is_none()
        || !send.username().is_empty()
        || send.password().is_some()
        || send.fragment().is_some()
    {
        return Err(invalid());
    }
    let keys: Vec<_> = send.query_pairs().filter(|(k, _)| k == "key").collect();
    if keys.len() != 1 || keys[0].1.is_empty() {
        return Err(invalid());
    }
    let key = keys[0].1.to_string();
    let mut upload = send.clone();
    upload.set_path("/cgi-bin/webhook/upload_media");
    upload.set_query(None);
    upload
        .query_pairs_mut()
        .append_pair("key", &key)
        .append_pair("type", "file");
    Ok((send, upload, key))
}
fn redact(message: &str, webhook: &str, key: &str) -> String {
    let encoded = reqwest::Url::parse(webhook)
        .ok()
        .and_then(|u| u.query().map(str::to_owned))
        .unwrap_or_default();
    let mut safe = message
        .replace(webhook, "[webhook]")
        .replace(key, "[redacted]");
    if !encoded.is_empty() {
        safe = safe.replace(&encoded, "[redacted]");
    }
    // Also remove percent-encoded key values if the service echoes the request URL.
    if let Some(raw) = encoded.split('&').find_map(|p| p.strip_prefix("key=")) {
        if !raw.is_empty() {
            safe = safe.replace(raw, "[redacted]");
        }
    }
    safe.chars().take(1000).collect()
}
async fn response(request: reqwest::RequestBuilder, webhook: &str, key: &str) -> Result<Value> {
    // Never format reqwest errors: they contain the full URL including the secret.
    let reply = request
        .send()
        .await
        .map_err(|_| ApiError::bad("企业微信请求失败或超时。"))?;
    if !reply.status().is_success() {
        return Err(ApiError::bad(format!(
            "企业微信 HTTP {}",
            reply.status().as_u16()
        )));
    }
    let body: Value = reply
        .json()
        .await
        .map_err(|_| ApiError::bad("企业微信响应无效或超时。"))?;
    if body["errcode"].as_i64() != Some(0) {
        return Err(ApiError::bad(format!(
            "企业微信：{}",
            redact(
                body["errmsg"].as_str().unwrap_or("响应缺少成功状态"),
                webhook,
                key
            )
        )));
    }
    Ok(body)
}
fn client(timeout: Duration) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ApiError::bad("无法创建企业微信客户端。"))
}
async fn upload(
    client: &reqwest::Client,
    webhook: &str,
    report: &reports::Generated,
) -> Result<String> {
    let (_, url, key) = endpoints(webhook)?;
    let part =
        reqwest::multipart::Part::bytes(report.bytes.clone()).file_name(report.filename.clone());
    let body = response(
        client
            .post(url)
            .multipart(reqwest::multipart::Form::new().part("media", part)),
        webhook,
        &key,
    )
    .await?;
    body["media_id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| ApiError::bad("企业微信未返回素材编号。"))
}
async fn send(client: &reqwest::Client, webhook: &str, body: Value) -> Result<()> {
    let (url, _, key) = endpoints(webhook)?;
    response(client.post(url).json(&body), webhook, &key).await?;
    Ok(())
}
#[derive(Serialize, Deserialize)]
struct Job {
    period: Period,
    format: Format,
    date: String,
    last_attempt: Option<i64>,
    summary_sent: bool,
}
fn due(period: Period, date: NaiveDate) -> Result<bool> {
    Ok(period.bounds(&date.to_string())?.1 == date.to_string())
}
fn job_key(period: Period, format: Format, date: NaiveDate) -> Result<String> {
    Ok(format!(
        "report_job:{}:{}:{}",
        serde_json::to_value(period).unwrap().as_str().unwrap(),
        period.bounds(&date.to_string())?.0,
        serde_json::to_value(format).unwrap().as_str().unwrap()
    ))
}
// Kept separate from the clock and generation so restart/reentry tests use real settings.
async fn enqueue(
    db: &DatabaseConnection,
    config: &Schedule,
    date: NaiveDate,
    minute: u32,
) -> Result<()> {
    if minute != config.hour * 60 + config.minute {
        return Ok(());
    }
    for &period in &config.periods {
        if !due(period, date)? {
            continue;
        }
        let key = job_key(period, config.format, date)?;
        if value(db, &key).await?.is_empty() {
            let job = Job {
                period,
                format: config.format,
                date: date.to_string(),
                last_attempt: None,
                summary_sent: false,
            };
            save(db, &key, &serde_json::to_string(&job).unwrap()).await?;
        }
    }
    Ok(())
}
async fn attempt<F, Fut>(db: &DatabaseConnection, key: &str, minute: i64, deliver: F) -> Result<()>
where
    F: FnOnce(Job) -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    let raw = value(db, key).await?;
    if raw == "sent" {
        return Ok(());
    }
    let mut job: Job =
        serde_json::from_str(&raw).map_err(|_| ApiError::bad("报告待发任务损坏。"))?;
    if job.last_attempt.is_some_and(|last| minute <= last) {
        return Ok(());
    }
    job.last_attempt = Some(minute);
    save(db, key, &serde_json::to_string(&job).unwrap()).await?;
    deliver(job).await?;
    // Retain every successful period key, so even a large clock rollback is safe.
    save(db, key, "sent").await
}
async fn tick(s: &AppState) -> Result<()> {
    let _tick = TICK.lock().await;
    let config = settings(&s.db).await?;
    if config.webhook.is_empty() || config.periods.is_empty() {
        return Ok(());
    }
    let now = Local::now();
    enqueue(
        &s.db,
        &config,
        now.date_naive(),
        now.hour() * 60 + now.minute(),
    )
    .await?;
    let client = client(Duration::from_secs(30))?;
    let mut errors = Vec::new();
    for row in all(
        &s.db,
        "SELECT id,value FROM settings WHERE id LIKE 'report_job:%'",
        vec![],
    )
    .await?
    {
        let key = text(&row, "id");
        let raw = text(&row, "value");
        if raw == "sent" {
            continue;
        }
        let job: Job =
            serde_json::from_str(&raw).map_err(|_| ApiError::bad("报告待发任务损坏。"))?;
        if !config.periods.contains(&job.period) || job.format != config.format {
            continue;
        }
        let client = &client;
        let webhook = &config.webhook;
        let job_key = &key;
        let result = attempt(
            &s.db,
            &key,
            now.timestamp().div_euclid(60),
            |mut job| async move {
                let actor = User {
                    id: "system".into(),
                    username: "system".into(),
                    name: "自动报告".into(),
                    role: "admin".into(),
                    role_name: "管理员".into(),
                    permissions: vec![],
                    can_in: false,
                    can_out: false,
                    can_count: false,
                    active: true,
                };
                let report = reports::generate(
                    s,
                    &actor,
                    reports::Request {
                        period: job.period,
                        date: job.date.clone(),
                        format: job.format,
                    },
                )
                .await?;
                let media = upload(client, webhook, &report).await?;
                if !job.summary_sent {
                    send(
                        client,
                        webhook,
                        json!({"msgtype":"text","text":{"content":report.summary}}),
                    )
                    .await?;
                    job.summary_sent = true;
                    save(&s.db, job_key, &serde_json::to_string(&job).unwrap()).await?;
                }
                send(
                    client,
                    webhook,
                    json!({"msgtype":"file","file":{"media_id":media}}),
                )
                .await
            },
        )
        .await;
        if let Err(error) = result {
            errors.push(error.1);
        }
    }
    // Don't clear an earlier failure on a duplicate tick that made no attempt.
    let pending = all(
        &s.db,
        "SELECT value FROM settings WHERE id LIKE 'report_job:%' AND value != 'sent'",
        vec![],
    )
    .await?;
    if !errors.is_empty() {
        save(&s.db, "report_last_error", &errors.join("\n")).await?;
    } else if pending.is_empty() {
        save(&s.db, "report_last_error", "").await?;
    }
    Ok(())
}
pub async fn scheduler(s: AppState) {
    let mut timer = tokio::time::interval(Duration::from_secs(60));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        timer.tick().await;
        let _maintenance = s.maintenance.read().await;
        if s.updating.load(std::sync::atomic::Ordering::Acquire) {
            return;
        }
        if let Err(error) = tick(&s).await {
            tracing::error!("scheduled report failed");
            let _ = save(&s.db, "report_last_error", &error.1).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, body::Bytes, http::StatusCode, response::IntoResponse, routing::post};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[test]
    fn every_calendar_boundary() {
        for (date, expected) in [
            ("2026-02-27", vec![Period::Day]),
            ("2026-02-28", vec![Period::Day, Period::Month]),
            ("2024-02-28", vec![Period::Day]),
            ("2024-02-29", vec![Period::Day, Period::Month]),
            (
                "2026-03-31",
                vec![Period::Day, Period::Month, Period::Quarter],
            ),
            (
                "2026-06-30",
                vec![Period::Day, Period::Month, Period::Quarter],
            ),
            (
                "2026-09-30",
                vec![Period::Day, Period::Month, Period::Quarter],
            ),
            (
                "2026-12-31",
                vec![Period::Day, Period::Month, Period::Quarter, Period::Year],
            ),
            ("2026-10-25", vec![Period::Day, Period::Week]),
            ("2026-05-31", vec![Period::Day, Period::Week, Period::Month]),
            (
                "2023-12-31",
                vec![
                    Period::Day,
                    Period::Week,
                    Period::Month,
                    Period::Quarter,
                    Period::Year,
                ],
            ),
        ] {
            let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
            let actual: Vec<_> = [
                Period::Day,
                Period::Week,
                Period::Month,
                Period::Quarter,
                Period::Year,
            ]
            .into_iter()
            .filter(|&p| due(p, date).unwrap())
            .collect();
            assert_eq!(actual, expected, "{date}");
        }
        assert_eq!(
            Period::Week.bounds("2026-05-31").unwrap(),
            ("2026-05-25".into(), "2026-05-31".into())
        );
    }

    #[tokio::test]
    async fn durable_idempotency_retry_and_clock_rollback() {
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}?mode=rwc", dir.path().join("jobs.db").display());
        let db = sea_orm::Database::connect(&url).await.unwrap();
        execute(
            &db,
            "CREATE TABLE settings (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
            vec![],
        )
        .await
        .unwrap();
        let config = Schedule {
            webhook: "unused".into(),
            periods: vec![
                Period::Day,
                Period::Day,
                Period::Month,
                Period::Quarter,
                Period::Year,
            ],
            ..Schedule::default()
        };
        save(
            &db,
            "report_schedule",
            &serde_json::to_string(&config).unwrap(),
        )
        .await
        .unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
        enqueue(&db, &config, date, 1079).await.unwrap();
        assert!(
            all(
                &db,
                "SELECT id FROM settings WHERE id LIKE 'report_job:%'",
                vec![]
            )
            .await
            .unwrap()
            .is_empty()
        );
        enqueue(&db, &config, date, 1080).await.unwrap();
        assert_eq!(
            all(
                &db,
                "SELECT id FROM settings WHERE id LIKE 'report_job:%'",
                vec![]
            )
            .await
            .unwrap()
            .len(),
            4
        );
        let key = job_key(Period::Day, Format::Xlsx, date).unwrap();
        let calls = AtomicUsize::new(0);
        assert!(
            attempt(&db, &key, 100, |_| async {
                calls.fetch_add(1, Ordering::SeqCst);
                Err(ApiError::bad("failed"))
            })
            .await
            .is_err()
        );
        for time in [100, 99] {
            attempt(&db, &key, time, |_| async {
                panic!("duplicate minute or rollback");
            })
            .await
            .unwrap();
        }
        drop(db);
        let db = sea_orm::Database::connect(&url).await.unwrap();
        let config = settings(&db).await.unwrap();
        enqueue(&db, &config, date, 1081).await.unwrap();
        attempt(&db, &key, 101, |_| async {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await
        .unwrap();
        drop(db);
        let db = sea_orm::Database::connect(&url).await.unwrap();
        enqueue(&db, &settings(&db).await.unwrap(), date, 1082)
            .await
            .unwrap();
        for time in [102, 98] {
            attempt(&db, &key, time, |_| async {
                panic!("sent period after restart");
            })
            .await
            .unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let mut pdf = config;
        pdf.format = Format::Pdf;
        enqueue(&db, &pdf, date, 1080).await.unwrap();
        assert_ne!(
            value(&db, &job_key(Period::Day, Format::Pdf, date).unwrap())
                .await
                .unwrap(),
            "sent"
        );
    }

    #[derive(Clone)]
    struct Fake {
        mode: Arc<AtomicUsize>,
        requests: Arc<std::sync::Mutex<Vec<(String, String)>>>,
    }
    async fn fake(
        State(fake): State<Fake>,
        uri: axum::http::Uri,
        body: Bytes,
    ) -> axum::response::Response {
        let path = uri.path().to_owned();
        fake.requests
            .lock()
            .unwrap()
            .push((path.clone(), String::from_utf8_lossy(&body).into()));
        let uploading = path.ends_with("upload_media");
        let mode = fake.mode.load(Ordering::SeqCst);
        if mode == 5 {
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        if (mode == 1 && uploading) || (mode == 2 && !uploading) {
            return (StatusCode::BAD_GATEWAY, "secret-test-key").into_response();
        }
        if (mode == 3 && uploading) || (mode == 4 && !uploading) {
            return Json(json!({"errcode":400,"errmsg":"invalid secret-test-key"})).into_response();
        }
        Json(json!({"errcode":0,"media_id":"temporary-file"})).into_response()
    }
    #[derive(Clone)]
    struct Log(Arc<std::sync::Mutex<Vec<u8>>>);
    impl std::io::Write for Log {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Log {
        type Writer = Log;
        fn make_writer(&'a self) -> Log {
            self.clone()
        }
    }
    #[tokio::test]
    async fn local_delivery_success_failures_timeouts_and_secret_redaction() {
        let logs = Log(Arc::new(std::sync::Mutex::new(Vec::new())));
        let subscriber = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::DEBUG)
            .with_writer(logs.clone())
            .finish();
        let _guard = tracing::subscriber::set_default(subscriber);
        let fake_state = Fake {
            mode: Arc::new(AtomicUsize::new(0)),
            requests: Default::default(),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let webhook = format!(
            "http://{}/cgi-bin/webhook/send?key=secret-test-key",
            listener.local_addr().unwrap()
        );
        let server = tokio::spawn(
            axum::serve(
                listener,
                Router::new()
                    .route("/cgi-bin/webhook/upload_media", post(fake))
                    .route("/cgi-bin/webhook/send", post(fake))
                    .with_state(fake_state.clone()),
            )
            .into_future(),
        );
        let client = client(Duration::from_millis(60)).unwrap();
        for extension in ["xlsx", "pdf"] {
            let report = reports::Generated {
                metadata: json!({}),
                bytes: b"file contents".to_vec(),
                filename: format!("report.{extension}"),
                summary: "期间 入库总额 出库总额 销售合计".into(),
            };
            let media = upload(&client, &webhook, &report).await.unwrap();
            send(
                &client,
                &webhook,
                json!({"msgtype":"text","text":{"content":report.summary}}),
            )
            .await
            .unwrap();
            send(
                &client,
                &webhook,
                json!({"msgtype":"file","file":{"media_id":media}}),
            )
            .await
            .unwrap();
            let requests = fake_state.requests.lock().unwrap();
            let last = &requests[requests.len() - 3..];
            assert!(last[0].1.contains("name=\"media\""));
            assert!(
                last[0]
                    .1
                    .contains(&format!("filename=\"report.{extension}\""))
            );
            assert_eq!(
                serde_json::from_str::<Value>(&last[1].1).unwrap()["msgtype"],
                "text"
            );
            assert_eq!(
                serde_json::from_str::<Value>(&last[2].1).unwrap()["file"]["media_id"],
                "temporary-file"
            );
        }
        for mode in 1..=5 {
            fake_state.mode.store(mode, Ordering::SeqCst);
            let error = if mode == 1 || mode == 3 || mode == 5 {
                upload(
                    &client,
                    &webhook,
                    &reports::Generated {
                        metadata: json!({}),
                        bytes: vec![1],
                        filename: "report.xlsx".into(),
                        summary: String::new(),
                    },
                )
                .await
                .unwrap_err()
            } else {
                send(
                    &client,
                    &webhook,
                    json!({"msgtype":"file","file":{"media_id":"x"}}),
                )
                .await
                .unwrap_err()
            };
            assert!(!format!("{error:?}").contains("secret-test-key"));
            if mode == 3 || mode == 4 {
                assert!(error.1.contains("invalid [redacted]"));
            }
            tracing::error!(%error, "delivery failed");
        }
        // The send path independently applies the same total request timeout.
        assert!(
            send(&client, &webhook, json!({}))
                .await
                .unwrap_err()
                .1
                .contains("超时")
        );
        let config = Schedule {
            webhook: webhook.clone(),
            ..Schedule::default()
        };
        assert!(!masked(&config).to_string().contains("secret-test-key"));
        assert!(
            !String::from_utf8(logs.0.lock().unwrap().clone())
                .unwrap()
                .contains("secret-test-key")
        );
        server.abort();
    }
}
