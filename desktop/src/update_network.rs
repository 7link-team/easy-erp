//! Keep release URLs canonical; the proxy is only a transport for public assets.
use crate::update_channel::Channel;
use semver::Version;
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const PROXY: &str = "https://gh-proxy.com/";

#[derive(Clone, Copy, serde::Serialize)]
pub(crate) struct RouteStatus {
    source: &'static str,
    fallback: bool,
    state: &'static str,
}

impl RouteStatus {
    fn new(url: &Url, fallback: bool) -> Self {
        Self {
            source: if url.as_str().starts_with(PROXY) {
                "proxy"
            } else if matches!(url.host_str(), Some("github.com" | "api.github.com")) {
                "github"
            } else {
                "custom"
            },
            fallback,
            state: "connecting",
        }
    }
}

fn github_release(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path_segments().is_some_and(|mut parts| {
            parts.next().is_some_and(|s| !s.is_empty())
                && parts.next().is_some_and(|s| !s.is_empty())
                && parts.next() == Some("releases")
        })
}

fn github_api(url: &Url) -> bool {
    let parts: Vec<_> = url.path_segments().into_iter().flatten().collect();
    url.scheme() == "https"
        && url.host_str() == Some("api.github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.fragment().is_none()
        && matches!(url.query(), None | Some("per_page=100"))
        && parts.len() == 4
        && parts[0] == "repos"
        && parts[3] == "releases"
        && !parts[1].is_empty()
        && !parts[2].is_empty()
}

/// Never proxy private/local services or recursively wrap an existing proxy URL.
pub(crate) fn routes(url: &Url) -> Vec<Url> {
    let original = url
        .as_str()
        .strip_prefix(PROXY)
        .and_then(|inner| Url::parse(inner).ok())
        .filter(|url| github_release(url) || github_api(url))
        .unwrap_or_else(|| url.clone());
    if github_release(&original) || github_api(&original) {
        vec![
            Url::parse(&format!("{PROXY}{original}")).expect("valid proxy URL"),
            original,
        ]
    } else {
        vec![original]
    }
}

pub(crate) async fn check<R: Runtime>(
    app: &AppHandle<R>,
    channel: Channel,
    mut route: impl FnMut(RouteStatus),
) -> Result<Option<Update>, String> {
    let endpoints = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("endpoints"))
        .and_then(serde_json::Value::as_array)
        .ok_or("未配置版本检查地址。")?;
    let mut candidates = Vec::new();
    for endpoint in endpoints {
        let url = Url::parse(endpoint.as_str().ok_or("版本检查地址无效。")?)
            .map_err(|e| e.to_string())?;
        let url = if channel == Channel::Preview {
            match preview_manifest(&url, &mut route).await? {
                Some(url) => url,
                None => return Ok(None),
            }
        } else {
            url
        };
        for route in routes(&url) {
            if !candidates.contains(&route) {
                candidates.push(route);
            }
        }
    }
    check_candidates(app, candidates, channel, &mut route).await
}

#[derive(serde::Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    assets: Vec<ReleaseAsset>,
}

#[derive(serde::Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

fn repository(endpoint: &Url) -> Result<String, String> {
    let original = routes(endpoint).pop().ok_or("更新地址无效。")?;
    let parts: Vec<_> = original.path_segments().into_iter().flatten().collect();
    if !github_release(&original) || parts.len() < 3 {
        return Err("测试渠道需要使用 GitHub Release 更新地址。".into());
    }
    Ok(format!("{}/{}", parts[0], parts[1]))
}

fn select_preview(releases: Vec<Release>, repo: &str) -> Option<Url> {
    releases
        .into_iter()
        .filter(|release| !release.draft)
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.strip_prefix('v')?).ok()?;
            let expected = format!(
                "https://github.com/{repo}/releases/download/{}/latest.json",
                release.tag_name
            );
            release
                .assets
                .iter()
                .any(|asset| asset.name == "latest.json" && asset.browser_download_url == expected)
                .then(|| {
                    (
                        version,
                        Url::parse(&expected).expect("validated release URL"),
                    )
                })
        })
        .max_by(|a, b| a.0.cmp_precedence(&b.0))
        .map(|(_, url)| url)
}

async fn preview_manifest(
    endpoint: &Url,
    route: &mut impl FnMut(RouteStatus),
) -> Result<Option<Url>, String> {
    let repo = repository(endpoint)?;
    let api = Url::parse(&format!(
        "https://api.github.com/repos/{repo}/releases?per_page=100"
    ))
    .map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .user_agent("easy-erp-updater")
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let mut last_error = String::new();
    for (attempt, url) in routes(&api).into_iter().enumerate() {
        let status = RouteStatus::new(&url, attempt > 0);
        route(status);
        let result = async {
            client
                .get(url)
                .header("Cache-Control", "no-cache")
                .send()
                .await?
                .error_for_status()?
                .json::<Vec<Release>>()
                .await
        }
        .await;
        match result {
            Ok(releases) => {
                route(RouteStatus {
                    state: "success",
                    ..status
                });
                return Ok(select_preview(releases, &repo));
            }
            Err(error) => {
                route(RouteStatus {
                    state: "failed",
                    ..status
                });
                last_error = error.to_string();
            }
        }
    }
    Err(format!(
        "无法读取测试渠道版本列表，请稍后重试。{last_error}"
    ))
}

async fn check_candidates<R: Runtime>(
    app: &AppHandle<R>,
    candidates: Vec<Url>,
    channel: Channel,
    route: &mut impl FnMut(RouteStatus),
) -> Result<Option<Update>, String> {
    let mut last_error = "未配置版本检查地址。".to_owned();
    // Separate checks also handle a proxy returning HTTP 200 with HTML instead
    // of JSON. The plugin's endpoint list does not fall back on that parse error.
    for (attempt, endpoint) in candidates.into_iter().enumerate() {
        let status = RouteStatus::new(&endpoint, attempt > 0);
        route(status);
        let result = app
            .updater_builder()
            .version_comparator(move |current, release| channel.offers(&current, &release.version))
            .endpoints(vec![endpoint])
            .map_err(|e| e.to_string())?
            .timeout(Duration::from_secs(12))
            .header("Cache-Control", "no-cache")
            .map_err(|e| e.to_string())?
            .configure_client(|client| {
                client
                    .connect_timeout(Duration::from_secs(8))
                    .read_timeout(Duration::from_secs(15))
            })
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await;
        match result {
            Ok(update) => {
                route(RouteStatus {
                    state: "success",
                    ..status
                });
                return Ok(update);
            }
            Err(error) => {
                route(RouteStatus {
                    state: "failed",
                    ..status
                });
                last_error = error.to_string();
            }
        }
    }
    Err(format!(
        "更新线路均无法连接或返回无效内容，请稍后重试。{last_error}"
    ))
}

pub(crate) async fn download(
    update: &Update,
    mut progress: impl FnMut(u64, Option<u64>, bool),
    mut route: impl FnMut(RouteStatus),
) -> Result<Vec<u8>, String> {
    download_candidates(
        update,
        routes(&update.download_url),
        &mut progress,
        &mut route,
    )
    .await
}

async fn download_candidates(
    update: &Update,
    candidates: Vec<Url>,
    progress: &mut impl FnMut(u64, Option<u64>, bool),
    route: &mut impl FnMut(RouteStatus),
) -> Result<Vec<u8>, String> {
    let mut last_error = "没有可用的下载地址。".to_owned();
    for (attempt, url) in candidates.into_iter().enumerate() {
        let status = RouteStatus::new(&url, attempt > 0);
        route(status);
        let mut candidate = update.clone();
        candidate.download_url = url;
        // Downloading a large installer must not inherit the short check timeout.
        // The client still abandons a stalled connection after 15 seconds.
        candidate.timeout = Some(Duration::from_secs(15 * 60));
        let mut downloaded = 0;
        progress(0, None, attempt > 0);
        let result = candidate
            .download(
                |chunk, total| {
                    downloaded += chunk as u64;
                    progress(downloaded, total, attempt > 0);
                },
                || {},
            )
            .await;
        match result {
            // The official updater verifies both the signature and signed version.
            Ok(bytes) => {
                route(RouteStatus {
                    state: "success",
                    ..status
                });
                return Ok(bytes);
            }
            Err(error) => {
                route(RouteStatus {
                    state: "failed",
                    ..status
                });
                last_error = error.to_string();
            }
        }
    }
    Err(format!(
        "下载线路均失败或更新包验证未通过，未修改已安装的应用。请重新下载。{last_error}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, Ordering},
        },
    };

    // Disposable fixture identity, unrelated to the application's release key.
    const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDM2ODkwM0NDMjMzMEI4OTIKUldTU3VEQWp6QU9KTnI1cVMrZ2lUQklnbGs4UWxqdnpxQXpMR0hzTGIrV29Vd3IyWjl5aktBRmsK";
    const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTU3VEQWp6QU9KTnBFVng3OXdPdDdnSGozekdJQks1VnllUEErWnZMM0tCNUR3TE02UEk2TDkyMWRGN01KdFdpRjBKMU9XTHBtTjlVdGdzZ0s2Y2NxaC9DdU5OMEhQNWdrPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxMjU1MDY2CWZpbGU6dHJhbnNwb3J0LWZpeHR1cmUudHh0CXZlcnNpb246MC4yLjAKT3hrblJHbVNmNTlhNlpwV1pYQVFwRDJQeFFyS0txVzZWNUpBYS8vc0lWME9zSXlSVHNKYlZ1Y2RwWW9Sb093RlRMenhmWXRmNTFLRmxETWsxS1orREE9PQo=";
    const PACKAGE: &[u8] = b"easy-erp updater transport fixture\n";
    static MOCK_APP: Mutex<()> = Mutex::new(());

    struct Fixture {
        base: Url,
        requests: Arc<Mutex<Vec<String>>>,
        stopped: Arc<AtomicBool>,
        worker: Option<std::thread::JoinHandle<()>>,
    }

    impl Fixture {
        fn new() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let base = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
            let manifest = serde_json::json!({"version":"0.2.0", "url":base.join("package").unwrap().as_str(), "signature":SIGNATURE}).to_string();
            let preview_manifest = manifest.replace("0.2.0", "0.3.0-beta.1");
            let requests = Arc::new(Mutex::new(Vec::new()));
            let stopped = Arc::new(AtomicBool::new(false));
            let (seen, stop) = (requests.clone(), stopped.clone());
            let worker = std::thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    let Ok((mut stream, _)) = listener.accept() else {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    };
                    // BSD/macOS inherits O_NONBLOCK on accepted sockets.
                    // This fixture reads complete HTTP lines synchronously.
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut reader = BufReader::new(&stream);
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() {
                        continue;
                    }
                    let path = line.split_whitespace().nth(1).unwrap_or("").to_owned();
                    loop {
                        line.clear();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                            break;
                        }
                    }
                    seen.lock().unwrap().push(path.clone());
                    let (status, body) = match path.as_str() {
                        "/manifest" => ("200 OK", manifest.as_bytes()),
                        "/preview-manifest" => ("200 OK", preview_manifest.as_bytes()),
                        "/package" | "/truncated" => ("200 OK", PACKAGE),
                        "/html" => ("200 OK", b"<html>Proxy unavailable</html>".as_slice()),
                        "/corrupt" => ("200 OK", b"tampered package".as_slice()),
                        _ => ("503 Service Unavailable", b"unavailable".as_slice()),
                    };
                    let length = body.len() + if path == "/truncated" { 100 } else { 0 };
                    let _ = write!(
                        stream,
                        "HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
                    );
                    let _ = stream.write_all(body);
                }
            });
            Self {
                base,
                requests,
                stopped,
                worker: Some(worker),
            }
        }

        fn url(&self, path: &str) -> Url {
            self.base.join(path).unwrap()
        }
        fn app(&self) -> tauri::App<tauri::test::MockRuntime> {
            let mut context = tauri::test::mock_context(tauri::test::noop_assets());
            context.package_info_mut().version = "0.1.0".parse().unwrap();
            context.config_mut().plugins.0.insert(
                "updater".into(),
                serde_json::json!({
                    "pubkey": PUBLIC_KEY, "endpoints": [self.url("manifest")],
                    "requireSignedVersion": true, "dangerousInsecureTransportProtocol": true
                }),
            );
            tauri::test::mock_builder()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .build(context)
                .unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.stopped.store(true, Ordering::Relaxed);
            self.worker.take().unwrap().join().unwrap();
        }
    }

    #[test]
    fn invalid_proxy_responses_fall_back_to_valid_manifest() {
        let _mock_app = MOCK_APP.lock().unwrap();
        let fixture = Fixture::new();
        let app = fixture.app();
        tauri::async_runtime::block_on(async {
            for failure in ["unavailable", "html", "truncated"] {
                let mut statuses = Vec::new();
                let update = check_candidates(
                    app.handle(),
                    vec![fixture.url(failure), fixture.url("manifest")],
                    Channel::Stable,
                    &mut |status| statuses.push(status),
                )
                .await
                .unwrap_or_else(|error| {
                    panic!(
                        "{failure}: {error}; requests: {:?}",
                        fixture.requests.lock().unwrap()
                    )
                })
                .unwrap();
                assert_eq!(update.version, "0.2.0");
                assert_eq!(
                    statuses.iter().map(|s| s.state).collect::<Vec<_>>(),
                    ["connecting", "failed", "connecting", "success"]
                );
                assert!(!statuses[0].fallback);
                assert!(statuses[3].fallback);
            }
            assert!(
                check_candidates(
                    app.handle(),
                    vec![fixture.url("html"), fixture.url("unavailable")],
                    Channel::Stable,
                    &mut |_| {}
                )
                .await
                .is_err()
            );
        });
        assert_eq!(
            &fixture.requests.lock().unwrap()[..2],
            ["/unavailable", "/manifest"]
        );
    }

    #[test]
    fn download_fallback_resets_progress_and_requires_valid_signature() {
        let _mock_app = MOCK_APP.lock().unwrap();
        let fixture = Fixture::new();
        let app = fixture.app();
        tauri::async_runtime::block_on(async {
            let update = check(app.handle(), Channel::Stable, |_| {})
                .await
                .unwrap()
                .unwrap();
            for failure in ["unavailable", "corrupt", "truncated"] {
                let mut events = Vec::new();
                let mut statuses = Vec::new();
                let bytes = download_candidates(
                    &update,
                    vec![fixture.url(failure), fixture.url("package")],
                    &mut |bytes, _, fallback| events.push((bytes, fallback)),
                    &mut |status| statuses.push(status),
                )
                .await
                .unwrap();
                assert_eq!(bytes, PACKAGE);
                assert_eq!(
                    statuses.iter().map(|s| s.state).collect::<Vec<_>>(),
                    ["connecting", "failed", "connecting", "success"]
                );
                assert!(statuses[3].fallback);
                assert_eq!(events[0], (0, false));
                assert!(events.contains(&(0, true)));
                assert_eq!(events.last(), Some(&(PACKAGE.len() as u64, true)));
            }
            assert!(
                download_candidates(
                    &update,
                    vec![fixture.url("corrupt"), fixture.url("corrupt")],
                    &mut |_, _, _| {},
                    &mut |_| {}
                )
                .await
                .is_err()
            );
            let mut forged = update.clone();
            forged.version = "0.3.0".into();
            assert!(
                download_candidates(
                    &forged,
                    vec![fixture.url("package")],
                    &mut |_, _, _| {},
                    &mut |_| {}
                )
                .await
                .is_err()
            );
        });
    }

    #[test]
    fn public_release_uses_proxy_then_original_without_double_wrapping() {
        let original = Url::parse(
            "https://github.com/7link-team/easy-erp/releases/latest/download/latest.json",
        )
        .unwrap();
        let expected = vec![Url::parse(&format!("{PROXY}{original}")).unwrap(), original];
        assert_eq!(routes(&expected[1]), expected);
        assert_eq!(routes(&expected[0]), expected);
        let asset = Url::parse(
            "https://github.com/7link-team/easy-erp/releases/download/v0.1.1/app.tar.gz",
        )
        .unwrap();
        assert_eq!(routes(&asset).last(), Some(&asset));
        assert_eq!(routes(&asset).len(), 2);
        let api =
            Url::parse("https://api.github.com/repos/7link-team/easy-erp/releases?per_page=100")
                .unwrap();
        assert_eq!(routes(&api).len(), 2);
        assert_eq!(routes(&routes(&api)[0]), routes(&api));
    }

    #[test]
    fn preview_selects_highest_published_version_with_canonical_manifest() {
        let release = |version: &str, draft: bool| {
            serde_json::json!({
                "tag_name": format!("v{version}"), "draft": draft,
                "assets": [{"name":"latest.json", "browser_download_url":format!("https://github.com/org/repo/releases/download/v{version}/latest.json")}]
            })
        };
        let parse = |values| {
            serde_json::from_value::<Vec<Release>>(serde_json::Value::Array(values)).unwrap()
        };
        let chosen = select_preview(
            parse(vec![
                release("1.9.0", false),
                release("1.10.0-beta.2", false),
                release("3.0.0", true),
                release("1.10.0-beta.10", false),
            ]),
            "org/repo",
        )
        .unwrap();
        assert!(chosen.path().contains("1.10.0-beta.10"));
        let chosen = select_preview(
            parse(vec![
                release("1.10.0-rc.1", false),
                release("1.10.0", false),
            ]),
            "org/repo",
        )
        .unwrap();
        assert!(chosen.path().contains("/v1.10.0/"));
        assert!(select_preview(parse(vec![release("2.0.0", true)]), "org/repo").is_none());
        assert!(select_preview(parse(vec![release("2.0.0", false)]), "other/repo").is_none());
        assert!(
            select_preview(
                parse(vec![
                    serde_json::json!({"tag_name":"v9.0.0", "draft":false, "assets":[]})
                ]),
                "org/repo"
            )
            .is_none()
        );
    }

    #[test]
    fn stable_rejects_mislabelled_prerelease_manifest() {
        let _mock_app = MOCK_APP.lock().unwrap();
        let fixture = Fixture::new();
        let app = fixture.app();
        tauri::async_runtime::block_on(async {
            assert!(
                check_candidates(
                    app.handle(),
                    vec![fixture.url("preview-manifest")],
                    Channel::Stable,
                    &mut |_| {}
                )
                .await
                .unwrap()
                .is_none()
            );
            assert_eq!(
                check_candidates(
                    app.handle(),
                    vec![fixture.url("preview-manifest")],
                    Channel::Preview,
                    &mut |_| {}
                )
                .await
                .unwrap()
                .unwrap()
                .version,
                "0.3.0-beta.1"
            );
        });
    }

    #[test]
    fn other_services_and_credentials_never_go_to_proxy() {
        for value in [
            "http://127.0.0.1:65280/latest.json",
            "https://example.com/latest.json",
            "https://github.com.evil.test/org/repo/releases/latest",
            "https://user:secret@github.com/org/repo/releases/latest",
            "https://github.com/org/repo/issues/1",
        ] {
            let url = Url::parse(value).unwrap();
            assert_eq!(routes(&url), vec![url]);
        }
    }
}
