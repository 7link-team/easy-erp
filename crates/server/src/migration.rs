use sea_orm_migration::prelude::*;

pub struct Migrator;
#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(Initial), Box::new(SessionIdle)]
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
