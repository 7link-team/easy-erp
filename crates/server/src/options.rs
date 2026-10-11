//! Material options are suggestions, not mutable business references.
use crate::{
    auth::{User, clean, current},
    db::*,
    error::{ApiError, Result},
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use sea_orm::{ConnectionTrait, QueryResult, TransactionTrait};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

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
pub(crate) async fn seed(
    db: &impl ConnectionTrait,
    field: &str,
    name: &str,
) -> Result<(String, bool)> {
    let name = validate(field, name)?;
    if name.is_empty() {
        return Ok((name, false));
    }
    let inserted = execute(
        db,
        "INSERT INTO material_options (id,field,name,key,version) VALUES (?,?,?,?,1) ON CONFLICT(field,key) DO NOTHING",
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
    Ok((text(&row, "name"), inserted.rows_affected() > 0))
}
pub async fn ensure(db: &impl ConnectionTrait, field: &str, name: &str) -> Result<String> {
    let (name, inserted) = seed(db, field, name).await?;
    if name.is_empty() {
        return Ok(name);
    }
    let row = one(
        db,
        "SELECT id,active FROM material_options WHERE field=? AND key=?",
        vec![field.into(), key(&name).into()],
    )
    .await?
    .unwrap();
    if int(&row, "active") != 1 {
        return Err(ApiError::bad(format!(
            "候选“{name}”已停用，请选择其他值或在基础资料中启用。"
        )));
    }
    execute(db, "UPDATE material_options SET last_used_at=?,source=CASE WHEN ? THEN 'auto' ELSE source END WHERE id=?", vec![now().into(),inserted.into(),text(&row,"id").into()]).await?;
    Ok(name)
}
fn option_json(row: &QueryResult) -> Value {
    let time = int(row, "last_used_at");
    json!({"id":text(row,"id"),"field":text(row,"field"),"name":text(row,"name"),"version":int(row,"version"),"active":int(row,"active")==1,"sort":int(row,"sort"),"note":text(row,"note"),"source":text(row,"source"),"last_used_at":if time>0 {Some(time)} else {None}})
}
pub async fn list(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    if !actor.can("options.read") && !actor.can("items.read") {
        return Err(ApiError::forbidden());
    }
    let rows = all(
        &s.db,
        "SELECT * FROM material_options ORDER BY field,sort,name,id",
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
    let mut usage = HashMap::<(String, String), i64>::new();
    if actor.can("items.read") && actor.can("options.read") {
        for row in all(&s.db, "SELECT spec,kind,unit FROM items", vec![]).await? {
            for field in ["spec", "kind", "unit"] {
                *usage
                    .entry((field.into(), key(&text(&row, field))))
                    .or_default() += 1;
            }
        }
    }
    let items = rows
        .iter()
        .map(|r| {
            if !actor.can("options.read") {
                return json!({"id":text(r,"id"),"field":text(r,"field"),"name":text(r,"name"),"version":int(r,"version"),"active":int(r,"active")==1});
            }
            let mut value = option_json(r);
            value["usage_count"] = if actor.can("items.read") {
                json!(
                    usage
                        .get(&(text(r, "field"), text(r, "key")))
                        .copied()
                        .unwrap_or(0)
                )
            } else {
                Value::Null
            };
            value
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"kinds":kinds,"items":items})))
}

#[derive(Deserialize)]
pub struct Input {
    #[serde(default)]
    pub id: String,
    pub field: String,
    pub name: String,
    #[serde(default)]
    pub version: i64,
    pub active: Option<bool>,
    pub sort: Option<i64>,
    pub note: Option<String>,
}
pub async fn save(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Input>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    let txn = s.db.begin().await?;
    let result = save_record(&txn, &actor, input, "manual").await?;
    txn.commit().await?;
    Ok(Json(result))
}
pub(crate) async fn save_record(
    txn: &impl ConnectionTrait,
    actor: &User,
    input: Input,
    source: &str,
) -> Result<Value> {
    actor.require(if input.id.is_empty() {
        "options.create"
    } else {
        "options.update"
    })?;
    if input.active == Some(false) {
        actor.require("options.update")?;
    }
    let name = validate(&input.field, &input.name)?;
    if name.is_empty() {
        return Err(ApiError::bad("请填写选项名称。"));
    }
    let eid = if input.id.is_empty() {
        id()
    } else {
        input.id.clone()
    };
    let old = one(
        txn,
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
        txn,
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
        return Ok(json!({"id":text(&r,"id")}));
    }
    let active = input
        .active
        .unwrap_or_else(|| old.as_ref().is_none_or(|r| int(r, "active") == 1));
    let sort = input
        .sort
        .unwrap_or_else(|| old.as_ref().map_or(0, |r| int(r, "sort")));
    if !(0..=9999).contains(&sort) {
        return Err(ApiError::bad("排列顺序请填写 0–9999 的整数。"));
    }
    let note = clean(
        &input
            .note
            .unwrap_or_else(|| old.as_ref().map_or(String::new(), |r| text(r, "note"))),
        "说明",
        200,
        false,
    )?;
    execute(txn,"INSERT INTO material_options (id,field,name,key,version,active,sort,note,source) VALUES (?,?,?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,key=excluded.key,active=excluded.active,sort=excluded.sort,note=excluded.note,version=material_options.version+1",vec![eid.clone().into(),input.field.clone().into(),name.clone().into(),key(&name).into(),active.into(),sort.into(),note.clone().into(),source.into()]).await?;
    audit(txn,actor,"修改物料候选选项",&eid,json!({"field":input.field,"before":old.as_ref().map(option_json),"name":name,"active":active,"sort":sort,"note":note,"scope":"候选列表"})).await?;
    Ok(json!({"id":eid}))
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
    actor.require("options.delete")?;
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

#[derive(Deserialize)]
pub struct OrderEntry {
    id: String,
    version: i64,
}
#[derive(Deserialize)]
pub struct OrderInput {
    kind: String,
    entries: Vec<OrderEntry>,
}
/// Both dictionaries share the same version-checked, atomic ordering operation.
pub async fn reorder(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<OrderInput>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    let (table, column, permission) = match input.kind.as_str() {
        "spec" | "kind" | "unit" => ("material_options", "field", "options.update"),
        "account" => ("sales_catalog", "kind", "accounts.update"),
        "type" | "department" | "salesperson" => ("sales_catalog", "kind", "catalog.update"),
        _ => return Err(ApiError::bad("此类别不支持排序。")),
    };
    actor.require(permission)?;
    if input.entries.is_empty() || input.entries.len() > 10_000 {
        return Err(ApiError::bad("每类排序支持 1–10000 条资料。"));
    }
    let txn = s.db.begin().await?;
    let current = all(
        &txn,
        &format!("SELECT id,version FROM {table} WHERE {column}=?"),
        vec![input.kind.clone().into()],
    )
    .await?
    .into_iter()
    .map(|r| (text(&r, "id"), int(&r, "version")))
    .collect::<HashMap<_, _>>();
    let mut seen = HashSet::new();
    if current.len() != input.entries.len()
        || input
            .entries
            .iter()
            .any(|e| !seen.insert(&e.id) || current.get(&e.id) != Some(&e.version))
    {
        return Err(ApiError::conflict(
            "清单已变更，尚未修改顺序，请刷新后重试。",
        ));
    }
    for (index, entry) in input.entries.iter().enumerate() {
        let sql = if table == "material_options" {
            "UPDATE material_options SET sort=?,version=version+1 WHERE id=?"
        } else {
            "UPDATE sales_catalog SET data=json_set(data,'$.sort',?),version=version+1 WHERE id=?"
        };
        execute(
            &txn,
            sql,
            vec![(index as i64).into(), entry.id.clone().into()],
        )
        .await?;
    }
    audit(
        &txn,
        &actor,
        "调整资料顺序",
        &input.kind,
        json!({"ids":input.entries.iter().map(|e|&e.id).collect::<Vec<_>>()}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
