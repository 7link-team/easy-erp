//! File storage configured by environment or private storage.json.
use crate::error::{ApiError, Result};
use bytes::Bytes;
use futures::TryStreamExt;
use object_store::{
    ClientOptions, GetResult, ObjectMeta, ObjectStore, RetryConfig, aws::AmazonS3Builder,
    buffered::BufWriter, local::LocalFileSystem, path::Path as ObjectPath, prefix::PrefixStore,
};
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::io::AsyncWriteExt;

pub struct FileStorage {
    pub primary: &'static str,
    pub local_root: PathBuf,
    legacy_root: PathBuf,
    local: Arc<dyn ObjectStore>,
    legacy: Option<Arc<dyn ObjectStore>>,
    remote: Option<Arc<dyn ObjectStore>>,
    remote_label: String,
    /// Kept to sign the one request object_store cannot make: setting an
    /// object's ACL to private after it is written.
    s3: Option<S3Settings>,
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|s| !s.is_empty())
}
pub fn storage_error(error: object_store::Error) -> ApiError {
    if matches!(error, object_store::Error::NotFound { .. }) {
        ApiError::missing()
    } else {
        // SDK errors may contain endpoints or credentials; do not expose them.
        ApiError::bad("文件存储操作失败，请检查存储配置、网络和读写权限。")
    }
}
fn key(value: &str) -> Result<ObjectPath> {
    if value.is_empty()
        || value.starts_with('/')
        || value
            .split('/')
            .any(|v| v.is_empty() || v == "." || v == "..")
        || value.contains('\\')
    {
        return Err(ApiError::bad("文件存储路径无效。"));
    }
    ObjectPath::parse(value).map_err(|_| ApiError::bad("文件存储路径无效。"))
}

/// Slashes and surrounding blanks are decoration: "/", " / " and "" all name
/// the bucket root, which attachments and backups must never use.
fn trimmed_prefix(prefix: &str) -> &str {
    prefix.trim_matches(|c: char| c == '/' || c.is_whitespace())
}
impl FileStorage {
    pub fn from_env(data_dir: &Path) -> anyhow::Result<Self> {
        let (settings, source) = Settings::load(data_dir)?;
        Self::from_settings(data_dir, &settings, source == "env")
    }
    fn from_settings(
        data_dir: &Path,
        settings: &Settings,
        environment: bool,
    ) -> anyhow::Result<Self> {
        settings.validate()?;
        let backend = settings.backend.as_str();
        anyhow::ensure!(
            matches!(backend, "local" | "s3"),
            "ERP_FILE_STORAGE须为local或s3。"
        );
        let local_root = environment
            .then(|| env("ERP_STORAGE_LOCAL_DIR"))
            .flatten()
            .map(PathBuf::from)
            .unwrap_or_else(|| data_dir.to_owned());
        std::fs::create_dir_all(&local_root)?;
        std::fs::create_dir_all(data_dir)?;
        let local_root = std::fs::canonicalize(local_root)?;
        let legacy_root = std::fs::canonicalize(data_dir)?;
        let local = Arc::new(LocalFileSystem::new_with_prefix(&local_root)?);
        let legacy = if local_root != legacy_root {
            Some(Arc::new(LocalFileSystem::new_with_prefix(&legacy_root)?) as Arc<dyn ObjectStore>)
        } else {
            None
        };
        let mut remote = None;
        let mut remote_label = String::new();
        let mut remote_present = false;
        let mut prefix_applied = String::new();
        // Keep S3 configured when switching back to local, so older S3 files remain readable.
        if backend == "s3" || !settings.s3.bucket.is_empty() {
            let config = &settings.s3;
            let bucket = &config.bucket;
            let prefix = key(trimmed_prefix(&config.prefix)).map_err(|e| anyhow::anyhow!(e.1))?;
            let mut builder = AmazonS3Builder::new()
                .with_bucket_name(bucket)
                .with_region(&config.region)
                .with_access_key_id(&config.access_key_id)
                .with_secret_access_key(&config.secret_access_key)
                .with_virtual_hosted_style_request(!config.path_style)
                .with_client_options(
                    ClientOptions::new()
                        .with_allow_http(config.allow_http)
                        .with_timeout(Duration::from_secs(120))
                        .with_connect_timeout(Duration::from_secs(10)),
                )
                .with_retry(RetryConfig {
                    max_retries: 2,
                    retry_timeout: Duration::from_secs(30),
                    ..Default::default()
                });
            if !config.endpoint.is_empty() {
                builder = builder.with_endpoint(config.request_endpoint());
            }
            if environment {
                if let Some(token) = env("ERP_S3_SESSION_TOKEN") {
                    builder = builder.with_token(token);
                }
            }
            let store = builder
                .build()
                .map_err(|_| anyhow::anyhow!("S3配置无效，请检查地址、Region和访问凭据。"))?;
            remote_label = format!("s3://{bucket}/{prefix}");
            prefix_applied = prefix.to_string();
            remote_present = true;
            remote = Some(Arc::new(PrefixStore::new(store, prefix)) as Arc<dyn ObjectStore>);
        }
        Ok(Self {
            primary: if backend == "s3" { "s3" } else { "local" },
            local_root,
            legacy_root,
            local,
            legacy,
            remote,
            remote_label,
            // The prefix is already applied by the store, so the signed ACL
            // request has to carry it itself.
            s3: remote_present.then(|| S3Settings {
                prefix: prefix_applied,
                ..settings.s3.clone()
            }),
        })
    }
    pub fn kinds(&self) -> Vec<&'static str> {
        let mut result = vec!["local"];
        if self.legacy.is_some() {
            result.push("legacy");
        }
        if self.remote.is_some() {
            result.push("s3");
        }
        result
    }
    pub fn store(&self, kind: &str) -> Result<Arc<dyn ObjectStore>> {
        match kind {
            "local" => Ok(self.local.clone()),
            "legacy" => self.legacy.clone().ok_or_else(ApiError::missing),
            "s3" => self
                .remote
                .clone()
                .ok_or_else(|| ApiError::bad("此文件存放在S3，请保留原S3连接配置以读取。")),
            _ => Err(ApiError::bad("文件存储类型无效。")),
        }
    }
    pub fn label(&self, kind: &str, object_key: &str) -> String {
        match kind {
            "s3" => format!("{}/{object_key}", self.remote_label),
            "legacy" => self.legacy_root.join(object_key).to_string_lossy().into(),
            _ => self.local_root.join(object_key).to_string_lossy().into(),
        }
    }
    fn check_local_path(&self, kind: &str, object_key: &str) -> Result<()> {
        key(object_key)?;
        let root = match kind {
            "local" => &self.local_root,
            "legacy" => &self.legacy_root,
            _ => return Ok(()),
        };
        let mut path = root.clone();
        for part in object_key.split('/') {
            path.push(part);
            match std::fs::symlink_metadata(&path) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    return Err(ApiError::bad("文件存储目录内不允许符号链接。"));
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
    pub async fn get(&self, kind: &str, object_key: &str) -> Result<GetResult> {
        self.check_local_path(kind, object_key)?;
        self.store(kind)?
            .get(&key(object_key)?)
            .await
            .map_err(storage_error)
    }
    pub async fn read(&self, kind: &str, object_key: &str, limit: u64) -> Result<Bytes> {
        let result = self.get(kind, object_key).await?;
        if result.meta.size > limit {
            return Err(ApiError::bad("存储文件超出大小限制。"));
        }
        result.bytes().await.map_err(storage_error)
    }
    pub async fn put(&self, kind: &str, object_key: &str, bytes: Bytes) -> Result<()> {
        self.check_local_path(kind, object_key)?;
        self.store(kind)?
            .put(&key(object_key)?, bytes.into())
            .await
            .map_err(storage_error)?;
        self.mark_remote_private(kind, object_key).await
    }
    /// Attachments and backups are private objects whatever the bucket allows.
    async fn mark_remote_private(&self, kind: &str, object_key: &str) -> Result<()> {
        if kind != "s3" {
            return Ok(());
        }
        let Some(config) = &self.s3 else {
            return Ok(());
        };
        let full = format!("{}/{object_key}", config.prefix);
        mark_private(config, &full).await
    }
    pub async fn put_file(&self, kind: &str, object_key: &str, file: &Path) -> Result<()> {
        self.check_local_path(kind, object_key)?;
        let mut input = tokio::fs::File::open(file).await?;
        let mut output =
            BufWriter::with_capacity(self.store(kind)?, key(object_key)?, 8 * 1024 * 1024)
                .with_max_concurrency(2);
        let failed = || {
            ApiError(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "文件上传存储失败，原有文件未删除，请检查连接和权限。".into(),
            )
        };
        if tokio::io::copy(&mut input, &mut output).await.is_err() {
            let _ = output.abort().await;
            return Err(failed());
        }
        // shutdown consumes the upload state and performs its own completion
        // cleanup. Calling abort afterwards panics, including on failed PUTs.
        output.shutdown().await.map_err(|_| failed())?;
        Ok(())
    }
    pub async fn list(&self, kind: &str, prefix: &str) -> Result<Vec<ObjectMeta>> {
        self.check_local_path(kind, prefix)?;
        if kind != "s3" {
            let root = if kind == "legacy" {
                &self.legacy_root
            } else {
                &self.local_root
            };
            let mut pending = vec![root.join(prefix)];
            while let Some(dir) = pending.pop() {
                let entries = match std::fs::read_dir(dir) {
                    Ok(v) => v,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(e) => return Err(e.into()),
                };
                for entry in entries {
                    let entry = entry?;
                    let meta = entry.file_type()?;
                    if meta.is_symlink() {
                        // Refusing the whole listing is deliberate, not just
                        // blast radius: object_store walks with follow_links, so
                        // this pre-walk is the only thing that keeps a link from
                        // being enumerated at all. Skipping it here would let a
                        // symlinked archive reach the delete paths, which then
                        // fail later in check_local_path anyway.
                        return Err(ApiError::bad("备份目录内不允许符号链接。"));
                    }
                    if meta.is_dir() {
                        pending.push(entry.path());
                    }
                }
            }
        }
        self.store(kind)?
            .list(Some(&key(prefix)?))
            .try_collect()
            .await
            .map_err(storage_error)
    }
    pub async fn delete(&self, kind: &str, object_key: &str) -> Result<()> {
        self.check_local_path(kind, object_key)?;
        self.store(kind)?
            .delete(&key(object_key)?)
            .await
            .map_err(storage_error)
    }
    pub async fn clear_attachments(&self) -> Result<()> {
        for kind in self.kinds() {
            for object in self.list(kind, "attachments").await? {
                let key = object.location.to_string();
                if let Some(id) = key.strip_prefix("attachments/") {
                    if uuid::Uuid::parse_str(id).is_ok() {
                        self.delete(kind, &key).await?;
                    }
                }
            }
        }
        Ok(())
    }
    pub async fn attachment(&self, kind: &str, object_key: &str) -> Result<Bytes> {
        if !object_key.starts_with("attachments/") || object_key.split('/').count() != 2 {
            return Err(ApiError::bad("图片存储路径无效。"));
        }
        let result = self.read(kind, object_key, 10 * 1024 * 1024).await;
        if kind == "local"
            && result
                .as_ref()
                .is_err_and(|e| e.0 == axum::http::StatusCode::NOT_FOUND)
            && self.legacy.is_some()
        {
            return self.read("legacy", object_key, 10 * 1024 * 1024).await;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_archive_completion_returns_error_without_aborting_closed_writer() {
        let root = tempfile::tempdir().unwrap();
        let files = FileStorage::from_env(root.path()).unwrap();
        let blocked = root.path().join("backups/blocked.zip");
        std::fs::create_dir_all(&blocked).unwrap();
        std::fs::write(blocked.join("keep.txt"), b"preserve").unwrap();
        let input = root.path().join("source.zip");
        std::fs::write(&input, b"archive").unwrap();
        assert!(
            files
                .put_file("local", "backups/blocked.zip", &input)
                .await
                .is_err()
        );
        assert_eq!(
            std::fs::read(blocked.join("keep.txt")).unwrap(),
            b"preserve"
        );
        files
            .put_file("local", "backups/valid.zip", &input)
            .await
            .unwrap();
        assert_eq!(
            files
                .read("local", "backups/valid.zip", 100)
                .await
                .unwrap()
                .as_ref(),
            b"archive"
        );
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Settings {
    pub backend: String,
    /// Absent or null when the deployment keeps its files locally: a caller
    /// configuring 本地目录 has nothing to say about a bucket, and demanding
    /// eight empty strings from it only invited the mismatch that made first
    /// run answer 存储配置格式无效.
    #[serde(default, deserialize_with = "s3_or_default")]
    pub s3: S3Settings,
}
fn s3_or_default<'de, D>(deserializer: D) -> std::result::Result<S3Settings, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<S3Settings>::deserialize(deserializer)?.unwrap_or_default())
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct S3Settings {
    pub bucket: String,
    pub region: String,
    pub endpoint: String,
    pub prefix: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub path_style: bool,
    pub allow_http: bool,
}
impl Default for S3Settings {
    fn default() -> Self {
        Self {
            bucket: String::new(),
            region: String::new(),
            endpoint: String::new(),
            prefix: "easy-erp".into(),
            access_key_id: String::new(),
            secret_access_key: String::new(),
            path_style: false,
            allow_http: false,
        }
    }
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            backend: "local".into(),
            s3: S3Settings {
                bucket: String::new(),
                region: String::new(),
                endpoint: String::new(),
                prefix: "easy-erp".into(),
                access_key_id: String::new(),
                secret_access_key: String::new(),
                path_style: false,
                allow_http: false,
            },
        }
    }
}
const ENV_KEYS: &[&str] = &[
    "ERP_FILE_STORAGE",
    "ERP_STORAGE_LOCAL_DIR",
    "ERP_S3_BUCKET",
    "ERP_S3_REGION",
    "ERP_S3_ENDPOINT",
    "ERP_S3_PREFIX",
    "ERP_S3_ACCESS_KEY_ID",
    "ERP_S3_SECRET_ACCESS_KEY",
    "ERP_S3_PATH_STYLE",
    "ERP_S3_ALLOW_HTTP",
    "ERP_S3_SESSION_TOKEN",
];
impl Settings {
    fn load(dir: &Path) -> anyhow::Result<(Self, &'static str)> {
        Self::load_with(dir, env)
    }
    fn load_with(
        dir: &Path,
        read: impl Fn(&str) -> Option<String>,
    ) -> anyhow::Result<(Self, &'static str)> {
        if ENV_KEYS.iter().any(|name| read(name).is_some()) {
            let flag = |name, default| match read(name).as_deref() {
                None => Ok(default),
                Some("true" | "1") => Ok(true),
                Some("false" | "0") => Ok(false),
                _ => anyhow::bail!("{name}须为true或false。"),
            };
            return Ok((
                Self {
                    backend: read("ERP_FILE_STORAGE").unwrap_or_else(|| "local".into()),
                    s3: S3Settings {
                        bucket: read("ERP_S3_BUCKET").unwrap_or_default(),
                        region: read("ERP_S3_REGION").unwrap_or_else(|| "us-east-1".into()),
                        endpoint: read("ERP_S3_ENDPOINT").unwrap_or_default(),
                        prefix: read("ERP_S3_PREFIX").unwrap_or_else(|| "easy-erp".into()),
                        access_key_id: read("ERP_S3_ACCESS_KEY_ID").unwrap_or_default(),
                        secret_access_key: read("ERP_S3_SECRET_ACCESS_KEY").unwrap_or_default(),
                        path_style: flag("ERP_S3_PATH_STYLE", true)?,
                        allow_http: flag("ERP_S3_ALLOW_HTTP", false)?,
                    },
                },
                "env",
            ));
        }
        match std::fs::read(dir.join("storage.json")) {
            Ok(bytes) => Ok((
                serde_json::from_slice(&bytes)
                    .map_err(|_| anyhow::anyhow!("storage.json 格式无效，请检查配置文件。"))?,
                "file",
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((Self::default(), "default")),
            Err(_) => anyhow::bail!("无法读取 storage.json，请检查文件权限。"),
        }
    }
    pub(crate) fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            matches!(self.backend.as_str(), "local" | "s3"),
            "backend 须为 local 或 s3。"
        );
        if self.backend == "s3" || !self.s3.bucket.is_empty() {
            let s = &self.s3;
            anyhow::ensure!(
                !s.bucket.trim().is_empty()
                    && !s.region.trim().is_empty()
                    && !s.access_key_id.is_empty()
                    && !s.secret_access_key.is_empty(),
                "请填写 S3 桶名、Region、Access Key 和 Secret Key。"
            );
            // Never the bucket root: attachments and backups live under a
            // directory of their own, so one bucket can hold other things and a
            // mistake cannot scatter objects across its top level. Several
            // levels are fine (easy-erp/一号厂).
            anyhow::ensure!(
                !trimmed_prefix(&s.prefix).is_empty(),
                "请填写存储子目录，不能直接使用桶根目录。例如 easy-erp 或 easy-erp/一号厂。"
            );
            key(trimmed_prefix(&s.prefix))
                .map_err(|_| anyhow::anyhow!("请填写有效的 S3 prefix，不可包含 .. 或空路径段。"))?;
            anyhow::ensure!(
                s.endpoint.is_empty()
                    || s.endpoint.starts_with("https://")
                    || s.endpoint.starts_with("http://"),
                "S3 endpoint 须为 http:// 或 https:// 地址。"
            );
            anyhow::ensure!(
                !s.endpoint.starts_with("http://") || s.allow_http,
                "HTTP endpoint 需要开启 allow_http；MinIO 请同时使用 path_style=true。"
            );
            if s.endpoint.contains("aliyuncs.com") {
                anyhow::ensure!(
                    !s.path_style,
                    "阿里云 OSS 请设置 path_style=false（virtual-hosted），并填写如 https://oss-cn-hangzhou.aliyuncs.com 的 endpoint。"
                );
                anyhow::ensure!(
                    s.region.starts_with("oss-"),
                    "阿里云 OSS Region 请填写如 oss-cn-hangzhou。"
                );
            }
            if !s.endpoint.is_empty() {
                let uri: axum::http::Uri = s
                    .endpoint
                    .parse()
                    .map_err(|_| anyhow::anyhow!("S3 endpoint 地址无效。"))?;
                anyhow::ensure!(
                    uri.host().is_some()
                        && !s.endpoint.contains('@')
                        && uri.query().is_none()
                        && matches!(uri.path(), "" | "/"),
                    "S3 endpoint 只能包含协议、主机和端口，不可包含凭据、路径或查询参数。"
                );
            }
        }
        Ok(())
    }
    fn response(&self, source: &str) -> serde_json::Value {
        serde_json::json!({"source":source,"editable":source != "env","backend":self.backend,
            "s3":{"bucket":self.s3.bucket,"region":self.s3.region,"endpoint":self.s3.endpoint,
            "prefix":self.s3.prefix,"path_style":self.s3.path_style,"allow_http":self.s3.allow_http,
            "secret_set":!self.s3.secret_access_key.is_empty()}})
    }
}
impl S3Settings {
    // object_store expects custom virtual-hosted endpoints to already include the bucket.
    fn request_endpoint(&self) -> String {
        let endpoint = self.endpoint.trim_end_matches('/');
        if self.path_style {
            return endpoint.into();
        }
        if let Some((scheme, host)) = endpoint.split_once("://") {
            if !host.starts_with(&format!("{}.", self.bucket)) {
                return format!("{scheme}://{}.{host}", self.bucket);
            }
        }
        endpoint.into()
    }
}
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    #[cfg(unix)]
    std::fs::File::open(path.parent().unwrap())?.sync_all()?;
    Ok(())
}
/// First-run storage setup. The HTTP endpoint needs an administrator, and at
/// this point there is no account yet, so the launcher configures storage the
/// way it already configures the database: a short-lived child process reading
/// JSON from stdin, so credentials never appear in argv.
pub async fn configure_cli(dir: &Path) -> anyhow::Result<()> {
    use std::io::Read;
    anyhow::ensure!(
        !dir.join("storage.json").exists(),
        "已有文件存储配置，请在「备份」页中修改。"
    );
    anyhow::ensure!(
        !ENV_KEYS.iter().any(|name| env(name).is_some()),
        "当前由环境变量配置存储，请先移除存储环境变量。"
    );
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(bytes.len() <= 16 * 1024, "存储配置过大。");
    let settings: Settings =
        serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("存储配置格式无效。"))?;
    let files = FileStorage::from_settings(dir, &settings, false)?;
    // Same round trip as the HTTP path: a typo must fail here rather than when
    // the first attachment is uploaded.
    save_settings(dir, &settings, files.store(files.primary)?)
        .await
        .map_err(|e| anyhow::anyhow!(e.1))?;
    Ok(())
}
/// Marks an object private, the only way to be sure its bucket's own default
/// does not expose it. object_store signs its own requests and offers no ACL
/// option, and a header added through ClientOptions arrives unsigned — Alibaba
/// OSS rejects that outright with HeadersNotSigned — so this one request is
/// signed here. Written against the S3-compatible API, so it serves OSS, AWS
/// and MinIO alike rather than only one of them.
async fn mark_private(config: &S3Settings, object_key: &str) -> Result<()> {
    use hmac::{Hmac, Mac};
    use sha2::{Digest, Sha256};
    type Signer = Hmac<Sha256>;
    fn sign(key: &[u8], message: &str) -> Vec<u8> {
        let mut mac = Signer::new_from_slice(key).expect("HMAC takes a key of any size");
        mac.update(message.as_bytes());
        mac.finalize().into_bytes().to_vec()
    }

    let endpoint = config.request_endpoint();
    let host = endpoint
        .split_once("://")
        .map(|(_, host)| host)
        .unwrap_or(&endpoint)
        .trim_end_matches('/')
        .to_owned();
    let path = if config.path_style {
        format!("/{}/{object_key}", config.bucket)
    } else {
        format!("/{object_key}")
    };
    let url = format!("{endpoint}{path}?acl");
    let now = chrono::Utc::now();
    let stamp = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    // An empty body, hashed once: PUT ?acl carries the ACL in a header.
    let payload = hex::encode(Sha256::digest(b""));
    let canonical = format!(
        "PUT\n{path}\nacl=\nhost:{host}\nx-amz-acl:private\nx-amz-content-sha256:{payload}\nx-amz-date:{stamp}\n\nhost;x-amz-acl;x-amz-content-sha256;x-amz-date\n{payload}"
    );
    let scope = format!("{date}/{}/s3/aws4_request", config.region);
    let to_sign = format!(
        "AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical.as_bytes()))
    );
    let key = sign(
        &sign(
            &sign(
                &sign(
                    format!("AWS4{}", config.secret_access_key).as_bytes(),
                    &date,
                ),
                &config.region,
            ),
            "s3",
        ),
        "aws4_request",
    );
    let signature = hex::encode(sign(&key, &to_sign));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders=host;x-amz-acl;x-amz-content-sha256;x-amz-date, Signature={signature}",
        config.access_key_id
    );
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ApiError::bad("无法创建存储客户端。"))?
        .put(&url)
        .header("x-amz-acl", "private")
        .header("x-amz-content-sha256", &payload)
        .header("x-amz-date", &stamp)
        .header("authorization", authorization)
        .send()
        .await
        .map_err(|_| ApiError::bad("设置对象私有权限失败，请检查网络与存储权限。"))?;
    if !response.status().is_success() {
        return Err(ApiError::bad(
            "设置对象私有权限失败，请确认访问凭据具有 PutObjectAcl 权限。",
        ));
    }
    Ok(())
}
/// The same bucket and prefix with signing switched off. None for local
/// storage, and None when the credential-free client cannot even be built —
/// a probe we cannot perform must not be reported as a failure.
fn anonymous_store(settings: &Settings) -> Option<Arc<dyn ObjectStore>> {
    if settings.backend != "s3" {
        return None;
    }
    let config = &settings.s3;
    let prefix = key(trimmed_prefix(&config.prefix)).ok()?;
    let mut builder = AmazonS3Builder::new()
        .with_bucket_name(&config.bucket)
        .with_region(&config.region)
        .with_skip_signature(true)
        .with_virtual_hosted_style_request(!config.path_style)
        .with_client_options(
            ClientOptions::new()
                .with_allow_http(config.allow_http)
                .with_timeout(Duration::from_secs(20))
                .with_connect_timeout(Duration::from_secs(10)),
        )
        .with_retry(RetryConfig {
            max_retries: 0,
            retry_timeout: Duration::from_secs(10),
            ..Default::default()
        });
    if !config.endpoint.is_empty() {
        builder = builder.with_endpoint(config.request_endpoint());
    }
    let store = builder.build().ok()?;
    Some(Arc::new(PrefixStore::new(store, prefix)) as Arc<dyn ObjectStore>)
}
/// `anonymous` reads the same bucket without credentials. A private object ACL
/// cannot be set through object_store — OSS rejects an unsigned `x-amz-acl`
/// header outright — so whether the data is actually private is decided by the
/// bucket, and the only honest way to report that is to try reading it the way
/// a stranger would.
async fn probe(store: Arc<dyn ObjectStore>, anonymous: Option<Arc<dyn ObjectStore>>) -> Result<()> {
    let path = ObjectPath::from(format!(".probe-{}", uuid::Uuid::new_v4()));
    let payload = Bytes::from(uuid::Uuid::new_v4().to_string());
    store
        .put(&path, payload.clone().into())
        .await
        .map_err(|_| {
            ApiError::bad("存储写入探测失败，请检查 endpoint、Region、访问凭据和写入权限。")
        })?;
    let read = async {
        let value = store.get(&path).await?.bytes().await?;
        Ok::<_, object_store::Error>(value)
    }
    .await;
    // While the object still exists: a stranger must not be able to read it.
    let public = match &anonymous {
        Some(anonymous) => anonymous.get(&path).await.is_ok(),
        None => false,
    };
    // Always attempt cleanup, including after a failed read.
    let deleted = store.delete(&path).await;
    if deleted.is_err() {
        return Err(ApiError::bad(
            "存储删除探测失败，请授予删除权限，并清理桶内 .probe- 文件后重试。",
        ));
    }
    if public {
        return Err(ApiError::bad(
            "这个存储桶可以被匿名读取，附件里的客户签字照片会对任何人公开。请先把桶设为私有再保存。",
        ));
    }
    match read {
        Ok(value) if value == payload => Ok(()),
        _ => Err(ApiError::bad(
            "存储读回探测失败或内容不一致，请检查读取权限、网络和 endpoint。",
        )),
    }
}
async fn save_settings(dir: &Path, settings: &Settings, store: Arc<dyn ObjectStore>) -> Result<()> {
    probe(store, anonymous_store(settings)).await?;
    write_private(
        &dir.join("storage.json"),
        &serde_json::to_vec(settings).map_err(|_| ApiError::bad("存储配置无法序列化。"))?,
    )
    .map_err(|_| ApiError::bad("无法保存 storage.json，请检查数据目录写入权限。"))
}
pub async fn get_settings(
    axum::extract::State(s): axum::extract::State<crate::state::AppState>,
    headers: axum::http::HeaderMap,
) -> Result<axum::Json<serde_json::Value>> {
    let _guard = s.maintenance.read().await;
    let actor = crate::auth::current(&s, &headers).await?;
    actor.admin()?;
    let (settings, source) =
        Settings::load(&s.data_dir).map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(axum::Json(settings.response(source)))
}
/// A form that leaves the keys blank means "keep what is stored": the response
/// never returned them, so blank cannot mean "no key" — validate() would refuse
/// that anyway. This also keeps a switch back to 本地目录 working while the
/// bucket is still filled in, which is what keeps earlier attachments readable
/// from the old backend.
fn merge_stored_keys(dir: &Path, mut settings: Settings) -> Settings {
    if settings.s3.access_key_id.is_empty() || settings.s3.secret_access_key.is_empty() {
        if let Ok((stored, "file")) = Settings::load(dir) {
            if settings.s3.access_key_id.is_empty() {
                settings.s3.access_key_id = stored.s3.access_key_id;
            }
            if settings.s3.secret_access_key.is_empty() {
                settings.s3.secret_access_key = stored.s3.secret_access_key;
            }
        }
    }
    settings
}
pub async fn put_settings(
    axum::extract::State(s): axum::extract::State<crate::state::AppState>,
    headers: axum::http::HeaderMap,
    axum::Json(settings): axum::Json<Settings>,
) -> Result<axum::Json<serde_json::Value>> {
    let _guard = s.maintenance.write().await;
    let actor = crate::auth::current(&s, &headers).await?;
    actor.admin()?;
    if ENV_KEYS.iter().any(|name| env(name).is_some()) {
        return Err(ApiError::bad(
            "当前由环境变量配置，请先移除存储环境变量并重启服务后再修改。",
        ));
    }
    // The response never carries the keys back, so a form that leaves them
    // blank means "keep what is stored" — it cannot mean "no key", which would
    // be refused by validate() anyway. Merging here also keeps a switch back to
    // 本地目录 working while the bucket is still filled in: the stored S3
    // credentials remain available, which is what keeps earlier attachments
    // readable from the old backend.
    let settings = merge_stored_keys(&s.data_dir, settings);
    let files = FileStorage::from_settings(&s.data_dir, &settings, false)
        .map_err(|e| ApiError::bad(e.to_string()))?;
    save_settings(&s.data_dir, &settings, files.store(files.primary)?).await?;
    *s.files.write().unwrap() = Arc::new(files);
    Ok(axum::Json(settings.response("file")))
}

#[cfg(test)]
mod real_oss {
    use super::*;
    /// Only runs with real credentials in the environment; skipped otherwise.
    #[tokio::test]
    async fn an_uploaded_object_is_private_even_in_a_public_bucket() {
        let Some(bucket) = env("OSS_BUCKET") else {
            // Say so. A test that returns quietly without credentials reports
            // ok forever, and this is the only check that the ACL request is
            // actually made — turning it into a no-op would go unnoticed.
            eprintln!(
                "跳过对象私有化验证：未设置 OSS_BUCKET 等凭据，本次未验证 PUT ?acl 是否生效。"
            );
            return;
        };
        let settings = Settings {
            backend: "s3".into(),
            s3: S3Settings {
                bucket,
                region: env("OSS_REGION").unwrap(),
                endpoint: format!("https://{}", env("OSS_ENDPOINT").unwrap()),
                prefix: env("OSS_PREFIX").unwrap(),
                access_key_id: env("OSS_ACCESS_KEY_ID").unwrap(),
                secret_access_key: env("OSS_SECRET_ACCESS_KEY").unwrap(),
                path_style: false,
                allow_http: false,
            },
        };
        let dir = tempfile::tempdir().unwrap();
        let files = FileStorage::from_settings(dir.path(), &settings, false).unwrap();
        let name = format!("acl-check-{}", uuid::Uuid::new_v4());
        files
            .put("s3", &name, Bytes::from_static(b"private please"))
            .await
            .unwrap();
        let public = anonymous_store(&settings).unwrap();
        let readable = public.get(&key(&name).unwrap()).await.is_ok();
        files.delete("s3", &name).await.unwrap();
        assert!(!readable, "object was readable without credentials");
    }
}
#[cfg(test)]
mod settings_tests {
    use super::*;
    fn s3(endpoint: &str, path_style: bool) -> Settings {
        Settings {
            backend: "s3".into(),
            s3: S3Settings {
                bucket: "test-bucket".into(),
                region: "oss-cn-hangzhou".into(),
                endpoint: endpoint.into(),
                prefix: "easy-erp".into(),
                access_key_id: "test-access".into(),
                secret_access_key: "test-secret".into(),
                path_style,
                allow_http: endpoint.starts_with("http://"),
            },
        }
    }
    #[test]
    fn blank_keys_keep_the_stored_pair_and_a_filled_bucket_never_blocks_local() {
        let dir = tempfile::tempdir().unwrap();
        write_private(
            &dir.path().join("storage.json"),
            &serde_json::to_vec(&s3("https://oss-cn-hangzhou.aliyuncs.com", false)).unwrap(),
        )
        .unwrap();
        // What the form submits when the operator edits the prefix and leaves
        // the keys alone: the response never returned them, so blank can only
        // mean "unchanged".
        let mut submitted = s3("https://oss-cn-hangzhou.aliyuncs.com", false);
        submitted.s3.prefix = "easy-erp/一号厂".into();
        submitted.s3.access_key_id = String::new();
        submitted.s3.secret_access_key = String::new();
        assert!(submitted.validate().is_err());
        let merged = merge_stored_keys(dir.path(), submitted);
        merged.validate().unwrap();
        assert_eq!(merged.s3.secret_access_key, "test-secret");
        assert_eq!(merged.s3.prefix, "easy-erp/一号厂");
        // Switching back to 本地目录 with the bucket still filled in keeps the
        // stored credentials, which is what keeps earlier attachments readable.
        let mut back = merged.clone();
        back.backend = "local".into();
        back.s3.access_key_id = String::new();
        back.s3.secret_access_key = String::new();
        merge_stored_keys(dir.path(), back).validate().unwrap();
    }
    #[test]
    fn a_local_backend_may_omit_the_bucket_section_entirely() {
        // What the launcher sends after 本地目录 is chosen. All three spellings
        // mean the same thing, and demanding the long one is what made first
        // run fail with 存储配置格式无效.
        for raw in [
            r#"{"backend":"local"}"#,
            r#"{"backend":"local","s3":null}"#,
            r#"{"backend":"local","s3":{"bucket":"","region":"","endpoint":"","prefix":"easy-erp","access_key_id":"","secret_access_key":"","path_style":false,"allow_http":false}}"#,
        ] {
            let parsed: Settings = serde_json::from_str(raw).expect(raw);
            assert_eq!(parsed.backend, "local");
            assert_eq!(parsed.s3.prefix, "easy-erp");
            parsed.validate().unwrap();
        }
        // A bucket backend still has to say everything about the bucket.
        let missing: Settings = serde_json::from_str(r#"{"backend":"s3"}"#).unwrap();
        assert!(missing.validate().is_err());
    }

    #[test]
    fn a_bucket_root_is_refused_but_several_levels_are_fine() {
        let mut root = s3("https://oss-cn-hangzhou.aliyuncs.com", false);
        root.s3.prefix = "  /  ".into();
        let message = root.validate().unwrap_err().to_string();
        assert!(message.contains("子目录"), "{message}");
        let mut nested = root.clone();
        nested.s3.prefix = "easy-erp/一号厂/2026".into();
        nested.validate().unwrap();
    }
    #[test]
    fn environment_over_file_over_default_and_response_excludes_credentials() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            Settings::load_with(dir.path(), |_| None).unwrap().1,
            "default"
        );
        let settings = s3("https://oss-cn-hangzhou.aliyuncs.com", false);
        write_private(
            &dir.path().join("storage.json"),
            &serde_json::to_vec(&settings).unwrap(),
        )
        .unwrap();
        let (loaded, source) = Settings::load_with(dir.path(), |_| None).unwrap();
        assert_eq!(source, "file");
        assert_eq!(loaded.s3.bucket, "test-bucket");
        let response = loaded.response(source).to_string();
        for forbidden in [
            "secret_access_key",
            "access_key_id",
            "test-secret",
            "test-access",
        ] {
            assert!(!response.contains(forbidden));
        }
        assert_eq!(loaded.response(source)["s3"]["secret_set"], true);
        let (loaded, source) = Settings::load_with(dir.path(), |name| {
            (name == "ERP_FILE_STORAGE").then(|| "local".into())
        })
        .unwrap();
        assert_eq!(source, "env");
        assert_eq!(loaded.backend, "local");
        assert_eq!(loaded.response(source)["editable"], false);
        // Invalid stale files must not override environment configuration either.
        std::fs::write(dir.path().join("storage.json"), b"invalid").unwrap();
        assert!(
            Settings::load_with(dir.path(), |name| (name == "ERP_FILE_STORAGE")
                .then(|| "local".into()))
            .is_ok()
        );
        assert!(Settings::load_with(dir.path(), |_| None).is_err());
    }
    #[test]
    fn oss_minio_and_aws_build_without_network() {
        let dir = tempfile::tempdir().unwrap();
        let oss = s3("https://oss-cn-hangzhou.aliyuncs.com", false);
        assert_eq!(
            oss.s3.request_endpoint(),
            "https://test-bucket.oss-cn-hangzhou.aliyuncs.com"
        );
        assert!(FileStorage::from_settings(dir.path(), &oss, false).is_ok());
        let minio = s3("http://127.0.0.1:9000", true);
        assert_eq!(minio.s3.request_endpoint(), "http://127.0.0.1:9000");
        assert!(FileStorage::from_settings(dir.path(), &minio, false).is_ok());
        let mut aws = s3("", false);
        aws.s3.region = "us-east-1".into();
        assert!(FileStorage::from_settings(dir.path(), &aws, false).is_ok());
        let mut invalid = oss.clone();
        invalid.s3.path_style = true;
        assert!(
            invalid
                .validate()
                .unwrap_err()
                .to_string()
                .contains("path_style=false")
        );
        let mut invalid = minio;
        invalid.s3.allow_http = false;
        assert!(
            invalid
                .validate()
                .unwrap_err()
                .to_string()
                .contains("allow_http")
        );
    }
    #[tokio::test]
    async fn real_s3_roundtrip_and_each_failure_preserves_config() {
        use axum::{
            Router,
            extract::{Path, State},
            http::{Method, StatusCode},
            response::IntoResponse,
            routing::any,
        };
        use std::collections::HashMap;
        #[derive(Clone)]
        struct Fake {
            fail: &'static str,
            objects: Arc<tokio::sync::Mutex<HashMap<String, Bytes>>>,
        }
        async fn endpoint(
            State(fake): State<Fake>,
            Path(path): Path<String>,
            method: Method,
            headers: axum::http::HeaderMap,
            body: Bytes,
        ) -> axum::response::Response {
            assert!(path.starts_with("test-bucket/easy-erp/.probe-"));
            // Like the real thing: an unsigned request is refused. The probe
            // reads the object once without credentials to find out whether
            // strangers can, so a fixture that answered those would report
            // every bucket as public.
            if !headers.contains_key(axum::http::header::AUTHORIZATION) {
                return StatusCode::FORBIDDEN.into_response();
            }
            if method.as_str() == fake.fail {
                return StatusCode::FORBIDDEN.into_response();
            }
            let mut objects = fake.objects.lock().await;
            match method {
                Method::PUT => {
                    objects.insert(path, body);
                    ([("etag", "\"test\"")], "").into_response()
                }
                Method::GET => match objects.get(&path) {
                    Some(bytes) => (
                        [
                            ("etag", "\"test\""),
                            ("last-modified", "Wed, 21 Oct 2015 07:28:00 GMT"),
                        ],
                        bytes.clone(),
                    )
                        .into_response(),
                    None => StatusCode::NOT_FOUND.into_response(),
                },
                Method::DELETE => {
                    objects.remove(&path);
                    StatusCode::NO_CONTENT.into_response()
                }
                _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
            }
        }
        for fail in ["", "PUT", "GET", "DELETE"] {
            let fake = Fake {
                fail,
                objects: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            };
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let app = Router::new()
                .route("/{*path}", any(endpoint))
                .with_state(fake.clone());
            let server = tokio::spawn(async move {
                axum::serve(listener, app).await.unwrap();
            });
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("storage.json");
            let old = serde_json::to_vec(&Settings::default()).unwrap();
            write_private(&path, &old).unwrap();
            let settings = s3(&format!("http://{address}"), true);
            let files = FileStorage::from_settings(dir.path(), &settings, false).unwrap();
            let result = save_settings(dir.path(), &settings, files.store("s3").unwrap()).await;
            if fail.is_empty() {
                result.unwrap();
                assert_eq!(
                    Settings::load_with(dir.path(), |_| None).unwrap().0.backend,
                    "s3"
                );
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    assert_eq!(
                        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                        0o600
                    );
                }
            } else {
                assert!(result.is_err(), "{fail}");
                assert_eq!(std::fs::read(&path).unwrap(), old);
            }
            if fail != "DELETE" {
                assert!(fake.objects.lock().await.is_empty());
            }
            server.abort();
        }
    }
}
