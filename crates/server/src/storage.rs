//! Deployment-configured file storage. Credentials never enter business data or backups.
use crate::error::{ApiError, Result};
use bytes::Bytes;
use futures::TryStreamExt;
use object_store::{
    ClientOptions, GetResult, ObjectMeta, ObjectStore, RetryConfig, aws::AmazonS3Builder,
    buffered::BufWriter, local::LocalFileSystem, path::Path as ObjectPath, prefix::PrefixStore,
};
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
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|s| !s.is_empty())
}
fn required(name: &str) -> anyhow::Result<String> {
    env(name).ok_or_else(|| anyhow::anyhow!("请配置{name}。"))
}
fn flag(name: &str, default: bool) -> anyhow::Result<bool> {
    match env(name).as_deref() {
        None => Ok(default),
        Some("true" | "1") => Ok(true),
        Some("false" | "0") => Ok(false),
        _ => anyhow::bail!("{name}须为true或false。"),
    }
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

impl FileStorage {
    pub fn from_env(data_dir: &Path) -> anyhow::Result<Self> {
        let backend = env("ERP_FILE_STORAGE").unwrap_or_else(|| "local".into());
        anyhow::ensure!(
            matches!(backend.as_str(), "local" | "s3"),
            "ERP_FILE_STORAGE须为local或s3。"
        );
        let local_root = env("ERP_STORAGE_LOCAL_DIR")
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
        // Keep S3 configured when switching back to local, so older S3 files remain readable.
        if backend == "s3" || env("ERP_S3_BUCKET").is_some() {
            let bucket = required("ERP_S3_BUCKET")?;
            let prefix = env("ERP_S3_PREFIX").unwrap_or_else(|| "easy-erp".into());
            let prefix = key(prefix.trim_matches('/')).map_err(|e| anyhow::anyhow!(e.1))?;
            let mut builder = AmazonS3Builder::new()
                .with_bucket_name(&bucket)
                .with_region(env("ERP_S3_REGION").unwrap_or_else(|| "us-east-1".into()))
                .with_access_key_id(required("ERP_S3_ACCESS_KEY_ID")?)
                .with_secret_access_key(required("ERP_S3_SECRET_ACCESS_KEY")?)
                .with_virtual_hosted_style_request(!flag("ERP_S3_PATH_STYLE", true)?)
                .with_client_options(
                    ClientOptions::new()
                        .with_allow_http(flag("ERP_S3_ALLOW_HTTP", false)?)
                        .with_timeout(Duration::from_secs(120))
                        .with_connect_timeout(Duration::from_secs(10)),
                )
                .with_retry(RetryConfig {
                    max_retries: 2,
                    retry_timeout: Duration::from_secs(30),
                    ..Default::default()
                });
            if let Some(endpoint) = env("ERP_S3_ENDPOINT") {
                anyhow::ensure!(
                    endpoint.starts_with("https://") || endpoint.starts_with("http://"),
                    "ERP_S3_ENDPOINT须为HTTP或HTTPS地址。"
                );
                builder = builder.with_endpoint(endpoint);
            }
            if let Some(token) = env("ERP_S3_SESSION_TOKEN") {
                builder = builder.with_token(token);
            }
            let store = builder
                .build()
                .map_err(|_| anyhow::anyhow!("S3配置无效，请检查地址、Region和访问凭据。"))?;
            remote_label = format!("s3://{bucket}/{prefix}");
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
        Ok(())
    }
    pub async fn put_file(&self, kind: &str, object_key: &str, file: &Path) -> Result<()> {
        self.check_local_path(kind, object_key)?;
        let mut input = tokio::fs::File::open(file).await?;
        let mut output =
            BufWriter::with_capacity(self.store(kind)?, key(object_key)?, 8 * 1024 * 1024)
                .with_max_concurrency(2);
        let result = async {
            tokio::io::copy(&mut input, &mut output).await?;
            output.shutdown().await?;
            Ok::<_, std::io::Error>(())
        }
        .await;
        if result.is_err() {
            let _ = output.abort().await;
            return Err(ApiError::bad(
                "文件上传存储失败，原有文件未删除，请检查连接和权限。",
            ));
        }
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
