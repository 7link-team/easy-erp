//! Material options are suggestions, not mutable business references.
use crate::{
    auth::{clean, current},
    db::*,
    error::{ApiError, Result},
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde::Deserialize;
use serde_json::{Value, json};

pub fn key(name: &str) -> String {
    name.trim().to_lowercase()
}
fn validate(field: &str, name: &str) -> Result<String> {
    if !["spec", "kind", "unit"].contains(&field) {
        return Err(ApiError::bad("选项类别无效。"));
    }
    clean(
        name,
        "选项名称",
        if field == "unit" { 16 } else { 100 },
        false,
    )
}
pub async fn ensure(db: &impl ConnectionTrait, field: &str, name: &str) -> Result<String> {
    let name = validate(field, name)?;
    if name.is_empty() {
        return Ok(name);
    }
    execute(
        db,
        "INSERT INTO material_options VALUES (?,?,?,?,1) ON CONFLICT(field,key) DO NOTHING",
        vec![
            id().into(),
            field.into(),
            name.clone().into(),
            key(&name).into(),
        ],
    )
    .await?;
    let row = one(
        db,
        "SELECT name FROM material_options WHERE field=? AND key=?",
        vec![field.into(), key(&name).into()],
    )
    .await?
    .unwrap();
    Ok(text(&row, "name"))
}
pub async fn list(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    current(&s, &headers).await?;
    let rows = all(
        &s.db,
        "SELECT * FROM material_options ORDER BY field,name",
        vec![],
    )
    .await?;
    let kinds = all(
        &s.db,
        "SELECT DISTINCT kind FROM items WHERE active=1 AND kind<>'' ORDER BY kind",
        vec![],
    )
    .await?
    .iter()
    .map(|r| text(r, "kind"))
    .collect::<Vec<_>>();
    Ok(Json(
        json!({"kinds":kinds,"items":rows.iter().map(|r|json!({"id":text(r,"id"),"field":text(r,"field"),"name":text(r,"name"),"version":int(r,"version")})).collect::<Vec<_>>()}),
    ))
}
#[derive(Deserialize)]
pub struct Input {
    #[serde(default)]
    id: String,
    field: String,
    name: String,
    #[serde(default)]
    version: i64,
}
pub async fn save(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Input>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    let name = validate(&input.field, &input.name)?;
    if name.is_empty() {
        return Err(ApiError::bad("请填写选项名称。"));
    }
    let txn = s.db.begin().await?;
    let eid = if input.id.is_empty() {
        id()
    } else {
        input.id.clone()
    };
    let old = one(
        &txn,
        "SELECT * FROM material_options WHERE id=?",
        vec![eid.clone().into()],
    )
    .await?;
    if !input.id.is_empty() && old.is_none() {
        return Err(ApiError::missing());
    }
    if let Some(ref r) = old {
        if int(r, "version") != input.version || text(r, "field") != input.field {
            return Err(ApiError::conflict("选项已修改，请刷新后重试。"));
        }
    }
    if let Some(r) = one(
        &txn,
        "SELECT id FROM material_options WHERE field=? AND key=? AND id<>?",
        vec![
            input.field.clone().into(),
            key(&name).into(),
            eid.clone().into(),
        ],
    )
    .await?
    {
        if !input.id.is_empty() {
            return Err(ApiError::conflict("名称已存在，请使用已有选项。"));
        }
        return Ok(Json(json!({"id":text(&r,"id")})));
    }
    execute(&txn,"INSERT INTO material_options VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,key=excluded.key,version=material_options.version+1",vec![eid.clone().into(),input.field.clone().into(),name.clone().into(),key(&name).into()]).await?;
    audit(&txn,&actor,"修改物料候选选项",&eid,json!({"field":input.field,"before":old.as_ref().map(|r|text(r,"name")),"name":name,"scope":"候选列表"})).await?;
    txn.commit().await?;
    Ok(Json(json!({"id":eid})))
}
#[derive(Deserialize)]
pub struct Version {
    version: i64,
}
pub async fn remove(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(eid): Path<String>,
    Query(input): Query<Version>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    let txn = s.db.begin().await?;
    let row = one(
        &txn,
        "SELECT * FROM material_options WHERE id=?",
        vec![eid.clone().into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    if int(&row, "version") != input.version {
        return Err(ApiError::conflict("选项已修改，请刷新后重试。"));
    }
    execute(
        &txn,
        "DELETE FROM material_options WHERE id=?",
        vec![eid.clone().into()],
    )
    .await?;
    audit(
        &txn,
        &actor,
        "删除物料候选选项",
        &eid,
        json!({"field":text(&row,"field"),"name":text(&row,"name"),"scope":"候选列表"}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
