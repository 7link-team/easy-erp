use crate::error::Result;
use sea_orm::{ConnectionTrait, DbBackend, ExecResult, QueryResult, Statement, Value};
use serde_json::json;

pub fn statement(db: &impl ConnectionTrait, sql: &str, values: Vec<Value>) -> Statement {
    let backend = db.get_database_backend();
    let sql = if backend == DbBackend::MySql {
        crate::mysql::query(sql)
    } else {
        sql.to_owned()
    };
    Statement::from_sql_and_values(backend, sql, values)
}
pub async fn execute(
    db: &impl ConnectionTrait,
    sql: &str,
    values: Vec<Value>,
) -> Result<ExecResult> {
    Ok(db.execute_raw(statement(db, sql, values)).await?)
}
pub async fn one(
    db: &impl ConnectionTrait,
    sql: &str,
    values: Vec<Value>,
) -> Result<Option<QueryResult>> {
    Ok(db.query_one_raw(statement(db, sql, values)).await?)
}
pub async fn all(
    db: &impl ConnectionTrait,
    sql: &str,
    values: Vec<Value>,
) -> Result<Vec<QueryResult>> {
    Ok(db.query_all_raw(statement(db, sql, values)).await?)
}
pub fn text(row: &QueryResult, key: &str) -> String {
    row.try_get("", key).expect("validated text schema")
}
pub fn int(row: &QueryResult, key: &str) -> i64 {
    row.try_get("", key).unwrap_or_else(|_| {
        // MySQL SUM(BIGINT) returns DECIMAL and COUNT returns unsigned BIGINT.
        if let Ok(value) = row.try_get::<u64>("", key) {
            return i64::try_from(value).expect("bounded business integer");
        }
        row.try_get::<sea_orm::prelude::Decimal>("", key)
            .expect("validated integer aggregate")
            .to_string()
            .parse()
            .expect("integral business aggregate")
    })
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub async fn audit(
    db: &impl ConnectionTrait,
    actor: &crate::auth::User,
    action: &str,
    object: &str,
    details: serde_json::Value,
) -> Result<()> {
    execute(db, "INSERT INTO audit (id,actor_id,actor_name,action,object_id,details,created_at) VALUES (?,?,?,?,?,?,?)",
        vec![id().into(), actor.id.clone().into(), actor.name.clone().into(), action.into(), object.into(), details.to_string().into(), now().into()]).await?;
    Ok(())
}

pub fn audit_json(row: QueryResult) -> serde_json::Value {
    json!({"id":text(&row,"id"),"actor_name":text(&row,"actor_name"),"action":text(&row,"action"),"object_id":text(&row,"object_id"),"details":serde_json::from_str::<serde_json::Value>(&text(&row,"details")).unwrap_or_default(),"created_at":int(&row,"created_at")})
}
