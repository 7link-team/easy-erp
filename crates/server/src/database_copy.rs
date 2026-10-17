//! Consistent MySQL snapshots use the same validated SQLite archive format.
use crate::{db::*, error::Result};
use sea_orm::{
    AccessMode, ConnectionTrait, DatabaseConnection, IsolationLevel, TransactionTrait, Value,
};
use std::path::Path;

pub const TABLES: &[&str] = &[
    "sales_attachments",
    "sales_returns",
    "sales_inventory",
    "sales_cash",
    "sales_revisions",
    "sales",
    "sales_catalog",
    "material_options",
    "sessions",
    "document_lines",
    "stocktake_lines",
    "requests",
    "audit",
    "documents",
    "stocktakes",
    "items",
    "users",
    "roles",
    "settings",
];

async fn copy_rows(
    source: &impl ConnectionTrait,
    target: &impl ConnectionTrait,
    schema: &DatabaseConnection,
    restore: bool,
) -> Result<()> {
    for table in TABLES {
        execute(target, &format!("DELETE FROM {table}"), vec![]).await?;
    }
    for table in TABLES
        .iter()
        .rev()
        .filter(|&&table| !restore || table != "sessions")
    {
        let columns = all(schema, &format!("PRAGMA table_info({table})"), vec![]).await?;
        let names = columns
            .iter()
            .map(|row| text(row, "name"))
            .collect::<Vec<_>>();
        let fields = names
            .iter()
            .map(|name| format!("`{name}`"))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "INSERT INTO {table} ({fields}) VALUES ({})",
            vec!["?"; names.len()].join(",")
        );
        let primary = &names[0];
        let mut last = String::new();
        loop {
            let rows = all(
                source,
                &format!(
                    "SELECT {fields} FROM {table} WHERE `{primary}`>? ORDER BY `{primary}` LIMIT 20"
                ),
                vec![last.clone().into()],
            )
            .await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                last = text(&row, primary);
                let values = columns
                    .iter()
                    .map(|column| {
                        let name = text(column, "name");
                        let kind = text(column, "type").to_uppercase();
                        if kind.contains("INT") {
                            Value::from(int(&row, &name))
                        } else if kind.contains("BLOB") {
                            Value::from(
                                row.try_get::<Vec<u8>>("", &name)
                                    .expect("validated image schema"),
                            )
                        } else {
                            Value::from(text(&row, &name))
                        }
                    })
                    .collect();
                execute(target, &sql, values).await?;
            }
        }
    }
    Ok(())
}

pub async fn snapshot(source: &DatabaseConnection, path: &Path) -> Result<()> {
    use sea_orm_migration::MigratorTrait;
    let target = crate::database::sqlite(path, false).await?;
    crate::migration::Migrator::up(&target, None).await?;
    let read = source
        .begin_with_config(
            Some(IsolationLevel::RepeatableRead),
            Some(AccessMode::ReadOnly),
        )
        .await?;
    let write = target.begin().await?;
    copy_rows(&read, &write, &target, false).await?;
    write.commit().await?;
    read.commit().await?;
    // Checkpoint closes all WAL readers before the single-file archive is built.
    execute(&target, "PRAGMA wal_checkpoint(TRUNCATE)", vec![]).await?;
    target.close().await?;
    Ok(())
}

pub async fn restore(
    source_path: &Path,
    target: &DatabaseConnection,
    actor: &crate::auth::User,
    details: serde_json::Value,
) -> Result<()> {
    let source = crate::database::sqlite(source_path, true).await?;
    let write = target.begin().await?;
    copy_rows(&source, &write, &source, true).await?;
    audit(&write, actor, "恢复全部数据", "", details).await?;
    write.commit().await?;
    source.close().await?;
    Ok(())
}
