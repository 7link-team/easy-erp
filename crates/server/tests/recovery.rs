//! Exercise maintenance against disposable directories and real server processes.
use fs2::FileExt;
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read, Write},
    net::TcpListener,
    path::Path,
    process::{Output, Stdio},
    time::Duration,
};
use tempfile::TempDir;
use tokio::{
    process::{Child, Command},
    time::{sleep, timeout},
};

const PASSWORD: &str = "Recovery-test-2026";
const TOKEN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

struct Server {
    child: Child,
    base: String,
    client: Client,
}

impl Server {
    async fn start(data: &Path, client: Option<Client>) -> Self {
        Self::start_mode(data, client, false).await
    }

    async fn start_mode(data: &Path, client: Option<Client>, server_mode: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let log_path = data.join("test-server.log");
        let log = fs::File::create(&log_path).unwrap();
        let mut command = Command::new(env!("CARGO_BIN_EXE_easy-erp-server"));
        command
            .env_remove("ERP_DATABASE_URL")
            .env_remove("ERP_SETUP_TOKEN")
            .env("ERP_SERVER_MODE", server_mode.to_string());
        if server_mode {
            command.env("ERP_SETUP_TOKEN", TOKEN);
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let child = command
            .arg("--data-dir")
            .arg(data)
            .arg("--bind")
            .arg(address.to_string())
            .env("ERP_DESKTOP_CONTROL_TOKEN", TOKEN)
            .env("ERP_SECURE_COOKIE", "false")
            .env_remove("ERP_WEB_DIR")
            .stdout(Stdio::null())
            .stderr(log)
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut server = Self {
            child,
            base: format!("http://{address}"),
            client: client.unwrap_or_else(|| {
                Client::builder()
                    .cookie_store(true)
                    .timeout(Duration::from_secs(15))
                    .build()
                    .unwrap()
            }),
        };
        for _ in 0..200 {
            if let Some(status) = server.child.try_wait().unwrap() {
                panic!(
                    "server exited {status}: {}",
                    fs::read_to_string(&log_path).unwrap()
                );
            }
            if let Ok(response) = server
                .client
                .get(format!("{}/api/status", server.base))
                .send()
                .await
                && response.status().is_success()
            {
                return server;
            }
            sleep(Duration::from_millis(50)).await;
        }
        panic!(
            "server did not start: {}",
            fs::read_to_string(log_path).unwrap()
        );
    }

    async fn get(&self, path: &str) -> Value {
        json_response(
            self.client
                .get(format!("{}/api{path}", self.base))
                .send()
                .await
                .unwrap(),
        )
        .await
    }

    async fn post(&self, path: &str, payload: Value) -> Value {
        json_response(
            self.client
                .post(format!("{}/api{path}", self.base))
                .header("X-ERP-Request", "1")
                .json(&payload)
                .send()
                .await
                .unwrap(),
        )
        .await
    }

    async fn login(&self) {
        self.post("/login", json!({"username":"manager","password":PASSWORD}))
            .await;
    }

    async fn setup(&self) {
        self.post(
            "/setup",
            json!({"username":"manager","password":PASSWORD,"name":"恢复测试管理员"}),
        )
        .await;
        self.login().await;
    }

    async fn stop(&mut self) {
        json_response(
            self.client
                .post(format!("{}/api/desktop/prepare-recovery", self.base))
                .header("X-ERP-Request", "1")
                .bearer_auth(TOKEN)
                .send()
                .await
                .unwrap(),
        )
        .await;
        let status = timeout(Duration::from_secs(20), self.child.wait())
            .await
            .expect("prepare-recovery must stop the server")
            .unwrap();
        assert!(status.success(), "server shutdown failed: {status}");
    }
}

async fn json_response(response: reqwest::Response) -> Value {
    let status = response.status();
    let body = response.text().await.unwrap();
    assert!(status.is_success(), "HTTP {status}: {body}");
    serde_json::from_str(&body).unwrap_or_else(|error| panic!("invalid JSON: {error}: {body}"))
}

async fn recovery(
    data: &Path,
    action: &str,
    confirmation: Option<&str>,
    backup: Option<&Path>,
) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_easy-erp-server"));
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
        .arg("--data-dir")
        .arg(data)
        .arg("--recovery-action")
        .arg(action)
        .kill_on_drop(true);
    if let Some(confirmation) = confirmation {
        command.arg("--confirmation").arg(confirmation);
    }
    if let Some(backup) = backup {
        command.arg("--recovery-backup").arg(backup);
    }
    timeout(Duration::from_secs(30), command.output())
        .await
        .expect("maintenance command timed out")
        .unwrap()
}

fn success(output: Output) -> Output {
    assert!(
        output.status.success(),
        "maintenance failed: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn failure(output: Output) {
    assert!(
        !output.status.success(),
        "unsafe maintenance unexpectedly succeeded: {}",
        String::from_utf8_lossy(&output.stdout)
    );
}

fn files(directory: &Path) -> BTreeMap<String, Vec<u8>> {
    if !directory.exists() {
        return BTreeMap::new();
    }
    fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap())
        .filter(|entry| entry.file_type().unwrap().is_file())
        .map(|entry| {
            (
                entry.file_name().to_string_lossy().into_owned(),
                fs::read(entry.path()).unwrap(),
            )
        })
        .collect()
}

struct Fixture {
    item_id: String,
    customer_id: String,
    sale_id: String,
    photos: Vec<(String, Vec<u8>, &'static str)>,
}

async fn fixture(server: &Server) -> Fixture {
    server.setup().await;
    let item = server
        .post(
            "/items",
            json!({"name":"恢复测试物料","kind":"成品","unit":"公斤","cost_price":"3.4567","sale_price":"8.1234"}),
        )
        .await;
    server
        .post(
            "/movements",
            json!({"request_id":uuid::Uuid::new_v4().to_string(),"kind":"receipt",
        "lines":[{"item_id":item["id"],"quantity":"100"}]}),
        )
        .await;
    let customer = server
        .post(
            "/sales/catalog",
            json!({"kind":"customer","name":"恢复测试客户",
        "data":{"phone":"13800000000","contact":"经办人","address":"测试仓库"}}),
        )
        .await;
    let sale = server
        .post(
            "/sales/commands",
            json!({"request_id":uuid::Uuid::new_v4().to_string(),"action":"confirm",
        "input":{"customer_id":customer["id"],"type_id":"sale","business_date":"2026-10-09",
            "discount_rate":"100","rounding":"0","note":"欠款及图片恢复验收",
            "lines":[{"item_id":item["id"],"quantity":"10","price":"12.50"}]}}),
        )
        .await;
    assert_eq!(sale["debt"], 12500);
    let mut photos = vec![];
    for (format, extension, mime) in [
        (image::ImageFormat::Png, "png", "image/png"),
        (image::ImageFormat::Jpeg, "jpg", "image/jpeg"),
    ] {
        let picture = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(3, 2, |x, y| {
            image::Rgb([(x * 80) as u8, (y * 120) as u8, 180])
        }));
        let mut encoded = Cursor::new(Vec::new());
        picture.write_to(&mut encoded, format).unwrap();
        let bytes = encoded.into_inner();
        let boundary = "recovery-integration-boundary";
        let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"receipt.{extension}\"\r\nContent-Type: {mime}\r\n\r\n").into_bytes();
        body.extend_from_slice(&bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let uploaded = json_response(
            server
                .client
                .post(format!(
                    "{}/api/sales/{}/attachments",
                    server.base,
                    sale["id"].as_str().unwrap()
                ))
                .header("X-ERP-Request", "1")
                .header(
                    "Content-Type",
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(body)
                .send()
                .await
                .unwrap(),
        )
        .await;
        photos.push((uploaded["id"].as_str().unwrap().to_owned(), bytes, mime));
    }
    json_response(
        server
            .client
            .put(format!("{}/api/backups/schedule", server.base))
            .header("X-ERP-Request", "1")
            .json(&json!({"keep_days":19}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    Fixture {
        item_id: item["id"].as_str().unwrap().into(),
        customer_id: customer["id"].as_str().unwrap().into(),
        sale_id: sale["id"].as_str().unwrap().into(),
        photos,
    }
}

async fn verify_fixture(server: &Server, fixture: &Fixture) {
    let prices = server.get("/items?q=恢复测试物料").await;
    assert_eq!(prices["items"][0]["cost_price"], 34567);
    assert_eq!(prices["items"][0]["sale_price"], 81234);
    let items = server.get("/items").await;
    let item = items["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == fixture.item_id)
        .unwrap();
    assert_eq!(item["balance"], 90000);
    let sale = server.get(&format!("/sales/{}", fixture.sale_id)).await;
    assert_eq!(sale["customer_id"], fixture.customer_id);
    assert_eq!(sale["total"], 12500);
    assert_eq!(sale["paid"], 0);
    assert_eq!(sale["debt"], 12500);
    assert_eq!(sale["attachments"].as_array().unwrap().len(), 2);
    let finance = server.get("/sales/finance?period=all").await;
    assert_eq!(finance["debt"], 12500);
    assert_eq!(server.get("/backups").await["schedule"]["keep_days"], 19);
    for (id, bytes, mime) in &fixture.photos {
        let response = server
            .client
            .get(format!("{}/api/sales/attachments/{id}", server.base))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["content-type"].to_str().unwrap(), *mime);
        let actual = response.bytes().await.unwrap();
        assert_eq!(actual.as_ref(), bytes.as_slice());
        assert_eq!(Sha256::digest(&actual), Sha256::digest(bytes));
    }
}

async fn assert_logged_out(server: &Server) {
    assert_eq!(
        server
            .client
            .get(format!("{}/api/me", server.base))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn complete_backup_reset_restore_and_clear_preserve_their_respective_data() {
    let data = TempDir::new().unwrap();
    let external = TempDir::new().unwrap();
    let mut server = Server::start(data.path(), None).await;
    let fixture = fixture(&server).await;
    verify_fixture(&server, &fixture).await;
    let backup_session = server
        .post("/login", json!({"username":"manager","password":PASSWORD}))
        .await["token"]
        .as_str()
        .unwrap()
        .to_owned();
    let backup = server.post("/backups", json!({})).await;
    let backup_path = data
        .path()
        .join("backups")
        .join(backup["name"].as_str().unwrap());
    let legacy = external.path().join("external.erpbackup");
    fs::copy(&backup_path, &legacy).unwrap();
    let original_backups = files(&data.path().join("backups"));
    let original_client = server.client.clone();
    server.stop().await;
    assert_eq!(
        files(&data.path().join("backups")),
        original_backups,
        "prepare-recovery must not make an exit backup"
    );
    let listed: Value =
        serde_json::from_slice(&success(recovery(data.path(), "list", None, None).await).stdout)
            .unwrap();
    assert_eq!(listed["has_data"], true);
    assert_eq!(
        Path::new(listed["data_dir"].as_str().unwrap()),
        data.path().canonicalize().unwrap()
    );
    assert_eq!(
        Path::new(listed["backups_dir"].as_str().unwrap()),
        data.path().canonicalize().unwrap().join("backups")
    );
    assert!(
        listed["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["name"] == backup["name"])
    );

    success(recovery(data.path(), "reset", Some("清空全部数据"), None).await);
    assert_eq!(files(&data.path().join("backups")), original_backups);
    let mut empty = Server::start(data.path(), Some(original_client.clone())).await;
    assert_eq!(empty.get("/status").await["initialized"], false);
    assert_logged_out(&empty).await;
    empty.setup().await;
    assert!(
        empty.get("/items").await["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(empty.get("/backups").await["schedule"]["keep_days"], 7);
    for (id, _, _) in &fixture.photos {
        assert_eq!(
            empty
                .client
                .get(format!("{}/api/sales/attachments/{id}", empty.base))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    let reset_client = empty.client.clone();
    empty.stop().await;

    // Restore the external legacy extension and invalidate the reset account's session.
    success(recovery(data.path(), "restore", Some("恢复全部数据"), Some(&legacy)).await);
    let mut restored = Server::start(data.path(), Some(reset_client)).await;
    assert_logged_out(&restored).await;
    restored.login().await;
    verify_fixture(&restored, &fixture).await;
    restored.stop().await;

    // The ZIP extension restores the same image BLOBs and invalidates saved backup sessions.
    success(
        recovery(
            data.path(),
            "restore",
            Some("恢复全部数据"),
            Some(&backup_path),
        )
        .await,
    );
    let mut restored = Server::start(data.path(), Some(original_client)).await;
    assert_logged_out(&restored).await;
    assert_eq!(
        restored
            .client
            .get(format!("{}/api/me", restored.base))
            .bearer_auth(&backup_session)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED,
        "sessions contained in the backup must also be revoked"
    );
    restored.login().await;
    verify_fixture(&restored, &fixture).await;
    restored.stop().await;
    let db_before = fs::read(data.path().join("inventory.sqlite")).unwrap();
    let backups = data.path().join("backups");
    fs::copy(&legacy, backups.join("legacy.erpbackup")).unwrap();
    fs::write(backups.join("keep.txt"), b"unrelated file").unwrap();
    fs::create_dir(backups.join("nested.zip")).unwrap();
    fs::write(backups.join("nested.zip/keep.zip"), b"nested file").unwrap();
    success(recovery(data.path(), "clear-backups", Some("清空全部备份"), None).await);
    assert_eq!(
        fs::read(data.path().join("inventory.sqlite")).unwrap(),
        db_before
    );
    assert_eq!(
        files(&backups),
        BTreeMap::from([("keep.txt".to_owned(), b"unrelated file".to_vec())])
    );
    assert_eq!(
        fs::read(backups.join("nested.zip/keep.zip")).unwrap(),
        b"nested file"
    );
    let mut restored = Server::start(data.path(), None).await;
    restored.login().await;
    verify_fixture(&restored, &fixture).await;
    restored.stop().await;
    success(recovery(data.path(), "reset", Some("清空全部数据"), None).await);
    let mut empty = Server::start(data.path(), None).await;
    assert_eq!(empty.get("/status").await["initialized"], false);
    empty.stop().await;
}

#[tokio::test]
async fn wrong_confirmation_and_live_server_lock_never_modify_data() {
    let data = TempDir::new().unwrap();
    let mut server = Server::start(data.path(), None).await;
    let fixture = fixture(&server).await;
    let backup = server.post("/backups", json!({})).await;
    let backup = data
        .path()
        .join("backups")
        .join(backup["name"].as_str().unwrap());
    let rejected = server
        .client
        .post(format!("{}/api/desktop/prepare-recovery", server.base))
        .header("X-ERP-Request", "1")
        .bearer_auth("b".repeat(64))
        .send()
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::FORBIDDEN);
    assert!(server.child.try_wait().unwrap().is_none());
    for (action, confirmation) in [
        ("reset", "清空全部数据"),
        ("restore", "恢复全部数据"),
        ("clear-backups", "清空全部备份"),
    ] {
        failure(
            recovery(
                data.path(),
                action,
                Some(confirmation),
                (action == "restore").then_some(backup.as_path()),
            )
            .await,
        );
    }
    verify_fixture(&server, &fixture).await;
    server.stop().await;
    let before = fs::read(data.path().join("inventory.sqlite")).unwrap();
    let backups = files(&data.path().join("backups"));
    for action in ["reset", "restore", "clear-backups"] {
        for confirmation in [None, Some("确认"), Some("清空全部数据 ")] {
            failure(
                recovery(
                    data.path(),
                    action,
                    confirmation,
                    (action == "restore").then_some(backup.as_path()),
                )
                .await,
            );
            assert_eq!(
                fs::read(data.path().join("inventory.sqlite")).unwrap(),
                before
            );
            assert_eq!(files(&data.path().join("backups")), backups);
        }
    }
}

fn rewrite_archive(
    source: &Path,
    destination: &Path,
    mut change: impl FnMut(&str, Vec<u8>) -> Vec<u8>,
) {
    let mut source = zip::ZipArchive::new(fs::File::open(source).unwrap()).unwrap();
    let mut destination = zip::ZipWriter::new(fs::File::create(destination).unwrap());
    for index in 0..source.len() {
        let mut entry = source.by_index(index).unwrap();
        let name = entry.name().to_owned();
        let mut bytes = vec![];
        entry.read_to_end(&mut bytes).unwrap();
        destination
            .start_file(&name, zip::write::SimpleFileOptions::default())
            .unwrap();
        destination.write_all(&change(&name, bytes)).unwrap();
    }
    destination.finish().unwrap();
}

#[tokio::test]
async fn damaged_database_can_be_recovered_but_invalid_archives_leave_it_untouched() {
    let data = TempDir::new().unwrap();
    let external = TempDir::new().unwrap();
    let mut server = Server::start(data.path(), None).await;
    let fixture = fixture(&server).await;
    let backup = server.post("/backups", json!({})).await;
    let valid = external.path().join("valid.zip");
    fs::copy(
        data.path()
            .join("backups")
            .join(backup["name"].as_str().unwrap()),
        &valid,
    )
    .unwrap();
    server.stop().await;
    let database = data.path().join("inventory.sqlite");
    fs::write(
        &database,
        b"damaged SQLite database -- keep until validation succeeds",
    )
    .unwrap();
    let damaged = fs::read(&database).unwrap();
    let backups_before = files(&data.path().join("backups"));
    let listed: Value =
        serde_json::from_slice(&success(recovery(data.path(), "list", None, None).await).stdout)
            .unwrap();
    assert_eq!(listed["has_data"], true);
    assert!(!listed["items"].as_array().unwrap().is_empty());
    assert_eq!(fs::read(&database).unwrap(), damaged);
    let bad_zip = external.path().join("bad.zip");
    fs::write(&bad_zip, b"this is not a ZIP").unwrap();
    for variant in ["zip", "format", "schema", "hash"] {
        let archive = if variant == "zip" {
            bad_zip.clone()
        } else {
            let archive = external.path().join(format!("bad-{variant}.zip"));
            rewrite_archive(&valid, &archive, |name, bytes| {
                if name != "manifest.json" {
                    return bytes;
                }
                let mut manifest: Value = serde_json::from_slice(&bytes).unwrap();
                match variant {
                    "format" => manifest["format"] = json!(999),
                    "schema" => manifest["schema"] = json!(["future_schema_v999"]),
                    "hash" => manifest["sha256"] = json!("0".repeat(64)),
                    _ => unreachable!(),
                }
                serde_json::to_vec(&manifest).unwrap()
            });
            archive
        };
        failure(recovery(data.path(), "restore", Some("恢复全部数据"), Some(&archive)).await);
        assert_eq!(
            fs::read(&database).unwrap(),
            damaged,
            "failed {variant} validation modified the live database"
        );
        assert_eq!(files(&data.path().join("backups")), backups_before);
    }
    // Extra ZIP entries are never extracted, including traversal paths.
    let marker = format!("recovery-escape-{}", uuid::Uuid::new_v4());
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&valid)
        .unwrap();
    let mut archive = zip::ZipWriter::new_append(file).unwrap();
    archive
        .start_file(
            format!("../{marker}"),
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    archive.write_all(b"must never be extracted").unwrap();
    archive.finish().unwrap();
    success(recovery(data.path(), "restore", Some("恢复全部数据"), Some(&valid)).await);
    assert!(!data.path().join(&marker).exists());
    assert!(!data.path().parent().unwrap().join(&marker).exists());
    assert!(!external.path().join(&marker).exists());
    let mut restored = Server::start(data.path(), None).await;
    restored.login().await;
    verify_fixture(&restored, &fixture).await;
    restored.stop().await;
    fs::write(&database, b"damaged again").unwrap();
    success(recovery(data.path(), "reset", Some("清空全部数据"), None).await);
    let mut empty = Server::start(data.path(), None).await;
    assert_eq!(empty.get("/status").await["initialized"], false);
    empty.stop().await;
}

#[tokio::test]
async fn maintenance_obeys_an_existing_exclusive_lock_even_when_sqlite_is_damaged() {
    let data = TempDir::new().unwrap();
    fs::write(data.path().join("inventory.sqlite"), b"broken").unwrap();
    fs::create_dir(data.path().join("backups")).unwrap();
    fs::write(data.path().join("backups/keep.zip"), b"keep archive").unwrap();
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(data.path().join("server.lock"))
        .unwrap();
    lock.try_lock_exclusive().unwrap();
    for (action, phrase) in [
        ("reset", "清空全部数据"),
        ("clear-backups", "清空全部备份"),
        ("restore", "恢复全部数据"),
    ] {
        failure(
            recovery(
                data.path(),
                action,
                Some(phrase),
                (action == "restore")
                    .then_some(data.path().join("backups/keep.zip"))
                    .as_deref(),
            )
            .await,
        );
        assert_eq!(
            fs::read(data.path().join("inventory.sqlite")).unwrap(),
            b"broken"
        );
        assert_eq!(
            fs::read(data.path().join("backups/keep.zip")).unwrap(),
            b"keep archive"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn clear_backups_never_follows_a_directory_symlink_outside_the_data_directory() {
    use std::os::unix::fs::symlink;
    let data = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::write(outside.path().join("keep.zip"), b"external backup").unwrap();
    fs::write(data.path().join("inventory.sqlite"), b"untouched database").unwrap();
    symlink(outside.path(), data.path().join("backups")).unwrap();
    failure(recovery(data.path(), "clear-backups", Some("清空全部备份"), None).await);
    assert_eq!(
        fs::read(outside.path().join("keep.zip")).unwrap(),
        b"external backup"
    );
    assert_eq!(
        fs::read(data.path().join("inventory.sqlite")).unwrap(),
        b"untouched database"
    );
}

async fn configure_server(server: &Server, settings: Value) {
    json_response(
        server
            .client
            .post(format!("{}/api/database/setup", server.base))
            .header("X-ERP-Request", "1")
            .header("X-ERP-Setup-Token", TOKEN)
            .json(&settings)
            .send()
            .await
            .unwrap(),
    )
    .await;
    for _ in 0..100 {
        if let Ok(response) = server
            .client
            .get(format!("{}/api/status", server.base))
            .send()
            .await
            && let Ok(status) = response.json::<Value>().await
            && status["database_configured"] == true
        {
            return;
        }
        sleep(Duration::from_millis(50)).await;
    }
    panic!("configured service did not become ready");
}
async fn setup_server_admin(server: &Server) {
    json_response(
        server
            .client
            .post(format!("{}/api/setup", server.base))
            .header("X-ERP-Request", "1")
            .header("X-ERP-Setup-Token", TOKEN)
            .json(&json!({"username":"manager","password":PASSWORD,"name":"服务器管理员"}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    server.login().await;
}

#[tokio::test]
async fn server_first_setup_requires_token_and_persists_sqlite_across_restarts() {
    let data = TempDir::new().unwrap();
    let mut server = Server::start_mode(data.path(), None, true).await;
    assert_eq!(server.get("/status").await["database_configured"], false);
    let denied = server
        .client
        .post(format!("{}/api/database/setup", server.base))
        .header("X-ERP-Request", "1")
        .json(&json!({"kind":"sqlite"}))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let bad = server.client.post(format!("{}/api/database/setup",server.base))
        .header("X-ERP-Request","1").header("X-ERP-Setup-Token",TOKEN)
        .json(&json!({"kind":"mysql","host":"127.0.0.1","port":1,"database":"missing","username":"bad","password":"DO-NOT-EXPOSE"})).send().await.unwrap();
    assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    assert!(!bad.text().await.unwrap().contains("DO-NOT-EXPOSE"));
    assert!(!data.path().join("database.json").exists());
    assert!(!data.path().join("inventory.sqlite").exists());
    configure_server(&server, json!({"kind":"sqlite"})).await;
    let denied = server
        .client
        .post(format!("{}/api/setup", server.base))
        .header("X-ERP-Request", "1")
        .json(&json!({"username":"bad","password":PASSWORD,"name":"不允许"}))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    setup_server_admin(&server).await;
    server
        .post(
            "/items",
            json!({"name":"重启保留","kind":"成品","unit":"个"}),
        )
        .await;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(data.path().join("database.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    server.stop().await;
    let mut restarted = Server::start_mode(data.path(), None, true).await;
    assert_eq!(restarted.get("/status").await["initialized"], true);
    restarted.login().await;
    assert_eq!(
        restarted.get("/items?q=重启保留").await["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let response = restarted
        .client
        .post(format!("{}/api/database/setup", restarted.base))
        .header("X-ERP-Request", "1")
        .json(&json!({"kind":"sqlite"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    restarted.stop().await;
}

#[tokio::test]
async fn mysql_web_setup_restart_and_full_backup_restore() {
    let Ok(url) = std::env::var("ERP_MYSQL_TEST_URL") else {
        eprintln!("ERP_MYSQL_TEST_URL not set: MySQL integration requires a disposable database");
        return;
    };
    let url = reqwest::Url::parse(&url).unwrap();
    let data = TempDir::new().unwrap();
    let mut server = Server::start_mode(data.path(), None, true).await;
    configure_server(&server,json!({"kind":"mysql","host":url.host_str().unwrap(),"port":url.port().unwrap_or(3306),"database":url.path().trim_start_matches('/'),"username":url.username(),"password":url.password().unwrap_or(""),"tls":false})).await;
    assert!(!data.path().join("inventory.sqlite").exists());
    setup_server_admin(&server).await;
    let item = server
        .post(
            "/items",
            json!({"name":"MySQL重启库存","kind":"成品","unit":"个","cost_price":"2.3456","sale_price":"8.1234"}),
        )
        .await;
    server.post("/movements",json!({"request_id":uuid::Uuid::new_v4().to_string(),"kind":"receipt","lines":[{"item_id":item["id"],"quantity":"10"}]})).await;
    let backup = server.post("/backups", json!({})).await;
    server
        .post(
            "/items",
            json!({"name":"备份后新增","kind":"成品","unit":"个"}),
        )
        .await;
    let restored = server
        .post(
            "/backups/restore",
            json!({"name":backup["name"],"confirmation":"恢复全部数据"}),
        )
        .await;
    assert_eq!(restored["ok"], true);
    server.login().await;
    assert_eq!(
        server.get("/items?q=备份后新增").await["items"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        server.get("/items?q=MySQL重启库存").await["items"][0]["balance"],
        10000
    );
    server.stop().await;
    let mut restarted = Server::start_mode(data.path(), None, true).await;
    restarted.login().await;
    assert_eq!(
        restarted.get("/items?q=MySQL重启库存").await["items"][0]["balance"],
        10000
    );
    let priced = restarted.get("/items?q=MySQL重启库存").await;
    assert_eq!(priced["items"][0]["cost_price"], 23456);
    assert_eq!(priced["items"][0]["sale_price"], 81234);
    assert_eq!(priced["inventory_value"], "23.46");
    assert!(!data.path().join("inventory.sqlite").exists());
    restarted.stop().await;
}

#[tokio::test]
async fn desktop_database_setup_reads_stdin_and_keeps_an_existing_database() {
    use tokio::io::AsyncWriteExt;
    let data = TempDir::new().unwrap();
    for first in [true, false] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_easy-erp-server"));
        command
            .arg("--data-dir")
            .arg(data.path())
            .arg("--configure-database")
            .env_remove("ERP_DATABASE_URL")
            .env_remove("ERP_SETUP_TOKEN")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command.spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(b"{\"kind\":\"sqlite\"}").await.unwrap();
        drop(stdin);
        let output = child.wait_with_output().await.unwrap();
        if first {
            success(output);
            let settings: Value =
                serde_json::from_slice(&fs::read(data.path().join("database.json")).unwrap())
                    .unwrap();
            assert_eq!(settings, json!({"kind":"sqlite"}));
        } else {
            failure(output);
        }
    }
    let mut server = Server::start(data.path(), None).await;
    server.setup().await;
    server.stop().await;
}
