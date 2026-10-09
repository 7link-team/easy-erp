use sea_orm_migration::prelude::*;

pub struct Migrator;
#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(Initial),
            Box::new(SessionIdle),
            Box::new(Sales),
            Box::new(MaterialOptions),
        ]
    }
}

struct Sales;
impl MigrationName for Sales {
    fn name(&self) -> &str {
        "sales_v1"
    }
}
#[async_trait::async_trait]
impl MigrationTrait for Sales {
    async fn up(&self, m: &SchemaManager) -> std::result::Result<(), DbErr> {
        for sql in [
            "CREATE TABLE sales_catalog (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL)",
            "CREATE UNIQUE INDEX sales_catalog_name ON sales_catalog(kind,name,CASE WHEN kind='salesperson' THEN json_extract(data,'$.department_id') ELSE '' END)",
            "CREATE TABLE sales (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, customer_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL)",
            "CREATE INDEX sales_actor_created ON sales(actor_id,created_at)",
            "CREATE INDEX sales_customer ON sales(customer_id)",
            "CREATE TABLE sales_revisions (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, version INTEGER NOT NULL, actor_name TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL)",
            "CREATE INDEX sales_revision_parent ON sales_revisions(sale_id,version)",
            "CREATE TABLE sales_cash (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, account_id TEXT NOT NULL, account_name TEXT NOT NULL, amount INTEGER NOT NULL, actor_name TEXT NOT NULL, business_date TEXT NOT NULL, note TEXT NOT NULL, reversal_of TEXT NOT NULL, created_at INTEGER NOT NULL)",
            "CREATE INDEX sales_cash_parent ON sales_cash(sale_id)",
            "CREATE TABLE sales_inventory (document_id TEXT PRIMARY KEY, sale_id TEXT NOT NULL)",
            "CREATE TABLE sales_returns (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL)",
            "CREATE TABLE sales_attachments (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, mime TEXT NOT NULL, active INTEGER NOT NULL, actor_name TEXT NOT NULL, created_at INTEGER NOT NULL, data BLOB NOT NULL)",
            "CREATE INDEX sales_attachments_parent ON sales_attachments(sale_id,active)",
            "UPDATE items SET precision=3,version=version+1 WHERE precision<>3",
            "INSERT INTO sales_catalog VALUES ('sale','type','销售单',1,1,'{\"billable\":true,\"sort\":0}')",
            "INSERT INTO sales_catalog VALUES ('sample','type','样品单',1,1,'{\"billable\":false,\"sort\":1}')",
            "INSERT INTO sales_catalog VALUES ('transfer','type','调货单',1,1,'{\"billable\":false,\"sort\":2}')",
            "INSERT INTO sales_catalog VALUES ('cash','account','现金',1,1,'{}')",
        ] {
            m.get_connection().execute_unprepared(sql).await?;
        }
        Ok(())
    }
    async fn down(&self, _: &SchemaManager) -> std::result::Result<(), DbErr> {
        Err(DbErr::Custom("不自动回退销售及资金数据".into()))
    }
}

#[derive(DeriveMigrationName)]
struct Initial;

struct SessionIdle;
impl MigrationName for SessionIdle {
    fn name(&self) -> &str {
        "session_idle_v1"
    }
}
#[async_trait::async_trait]
impl MigrationTrait for SessionIdle {
    async fn up(&self, m: &SchemaManager) -> std::result::Result<(), DbErr> {
        m.alter_table(
            Table::alter()
                .table(Alias::new("sessions"))
                .add_column(
                    ColumnDef::new(Alias::new("idle_seconds"))
                        .big_integer()
                        .not_null()
                        .default(28800),
                )
                .to_owned(),
        )
        .await?;
        m.get_connection()
            .execute_unprepared(
                "UPDATE sessions SET idle_seconds=2592000 WHERE expires_at-created_at>28801000",
            )
            .await?;
        Ok(())
    }
    async fn down(&self, _: &SchemaManager) -> std::result::Result<(), DbErr> {
        Err(DbErr::Custom("不自动回退登录会话结构".into()))
    }
}

// String IDs and scaled integer quantities deliberately avoid backend-specific types.
fn column(name: &str, kind: u8, primary: bool) -> ColumnDef {
    let mut c = ColumnDef::new(Alias::new(name));
    match kind {
        0 => {
            c.string_len(128);
        }
        1 => {
            c.text();
        }
        _ => {
            c.big_integer();
        }
    }
    c.not_null();
    if primary {
        c.primary_key();
    }
    c
}

#[async_trait::async_trait]
impl MigrationTrait for Initial {
    async fn up(&self, m: &SchemaManager) -> std::result::Result<(), DbErr> {
        let schemas: &[(&str, &[(&str, u8)])] = &[
            (
                "users",
                &[
                    ("id", 0),
                    ("username", 0),
                    ("name", 0),
                    ("password_hash", 1),
                    ("role", 0),
                    ("can_in", 2),
                    ("can_out", 2),
                    ("can_count", 2),
                    ("active", 2),
                    ("created_at", 2),
                ],
            ),
            (
                "sessions",
                &[
                    ("id", 0),
                    ("user_id", 0),
                    ("expires_at", 2),
                    ("created_at", 2),
                ],
            ),
            (
                "items",
                &[
                    ("id", 0),
                    ("code", 0),
                    ("name", 1),
                    ("spec", 1),
                    ("kind", 0),
                    ("unit", 0),
                    ("precision", 2),
                    ("barcode", 0),
                    ("minimum", 2),
                    ("balance", 2),
                    ("active", 2),
                    ("version", 2),
                    ("created_at", 2),
                ],
            ),
            (
                "documents",
                &[
                    ("id", 0),
                    ("number", 0),
                    ("kind", 0),
                    ("actor_id", 0),
                    ("actor_name", 1),
                    ("person", 1),
                    ("note", 1),
                    ("status", 0),
                    ("reference_id", 0),
                    ("created_at", 2),
                ],
            ),
            (
                "document_lines",
                &[
                    ("id", 0),
                    ("document_id", 0),
                    ("item_id", 0),
                    ("item_name", 1),
                    ("item_code", 0),
                    ("unit", 0),
                    ("precision", 2),
                    ("quantity", 2),
                    ("delta", 2),
                    ("balance_after", 2),
                ],
            ),
            (
                "audit",
                &[
                    ("id", 0),
                    ("actor_id", 0),
                    ("actor_name", 1),
                    ("action", 0),
                    ("object_id", 0),
                    ("details", 1),
                    ("created_at", 2),
                ],
            ),
            (
                "requests",
                &[
                    ("id", 0),
                    ("actor_id", 0),
                    ("fingerprint", 0),
                    ("response", 1),
                    ("created_at", 2),
                ],
            ),
            (
                "stocktakes",
                &[
                    ("id", 0),
                    ("actor_id", 0),
                    ("status", 0),
                    ("note", 1),
                    ("created_at", 2),
                ],
            ),
            (
                "stocktake_lines",
                &[
                    ("id", 0),
                    ("stocktake_id", 0),
                    ("item_id", 0),
                    ("expected", 2),
                    ("actual", 2),
                ],
            ),
            ("settings", &[("id", 0), ("value", 1)]),
        ];
        for (table, cols) in schemas {
            let mut query = Table::create();
            query.table(Alias::new(*table)).if_not_exists();
            for (i, (name, kind)) in cols.iter().enumerate() {
                query.col(column(name, *kind, i == 0));
            }
            m.create_table(query.to_owned()).await?;
        }
        for (name, table, fields, unique) in [
            ("users_username", "users", vec!["username"], true),
            ("items_code", "items", vec!["code"], true),
            ("documents_number", "documents", vec!["number"], true),
            (
                "documents_created",
                "documents",
                vec!["created_at", "id"],
                false,
            ),
            (
                "lines_document",
                "document_lines",
                vec!["document_id"],
                false,
            ),
            ("lines_item", "document_lines", vec!["item_id"], false),
            ("audit_created", "audit", vec!["created_at", "id"], false),
            ("sessions_user", "sessions", vec!["user_id"], false),
            ("counts_item", "stocktake_lines", vec!["item_id"], false),
        ] {
            let mut q = Index::create();
            q.name(name).table(Alias::new(table));
            for field in fields {
                q.col(Alias::new(field));
            }
            if unique {
                q.unique();
            }
            m.create_index(q.to_owned()).await?;
        }
        Ok(())
    }
    async fn down(&self, _: &SchemaManager) -> std::result::Result<(), DbErr> {
        Err(DbErr::Custom(
            "禁止自动删除库存业务表；请使用已验证的备份恢复。".into(),
        ))
    }
}

struct MaterialOptions;
impl MigrationName for MaterialOptions {
    fn name(&self) -> &str {
        "material_options_v1"
    }
}
#[async_trait::async_trait]
impl MigrationTrait for MaterialOptions {
    async fn up(&self, m: &SchemaManager) -> std::result::Result<(), DbErr> {
        let db = m.get_connection();
        db.execute_unprepared("CREATE TABLE material_options (id TEXT PRIMARY KEY, field TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, version INTEGER NOT NULL, UNIQUE(field,key))").await?;
        // Seed existing values using the same Unicode normalization as future writes.
        for field in ["spec", "kind", "unit"] {
            let rows = crate::db::all(
                db,
                &format!("SELECT DISTINCT {field} AS name FROM items"),
                vec![],
            )
            .await
            .map_err(|e| DbErr::Custom(e.to_string()))?;
            let defaults: &[&str] = match field {
                "kind" => &crate::domain::ITEM_KINDS,
                "unit" => &["个", "件", "公斤", "米", "箱"],
                _ => &[],
            };
            let names = rows
                .iter()
                .map(|r| crate::db::text(r, "name"))
                .chain(defaults.iter().map(|v| String::from(*v)));
            for name in names {
                crate::options::ensure(db, field, &name)
                    .await
                    .map_err(|e| DbErr::Custom(e.to_string()))?;
            }
        }
        Ok(())
    }
    async fn down(&self, _: &SchemaManager) -> std::result::Result<(), DbErr> {
        Err(DbErr::Custom("不自动回退基础资料".into()))
    }
}
