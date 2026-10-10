use crate::{
    auth::{User, clean, current, digest},
    db::*,
    domain::{self, MovementKind},
    error::{ApiError, Result},
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use std::collections::HashSet;

#[derive(Debug, Serialize)]
pub struct Item {
    pub id: String,
    pub code: String,
    pub name: String,
    pub spec: String,
    pub kind: String,
    pub unit: String,
    pub precision: i64,
    pub barcode: String,
    pub minimum: i64,
    pub balance: i64,
    pub active: bool,
    pub version: i64,
    pub counting: bool,
    pub can_delete: bool,
}
pub fn item(row: &sea_orm::QueryResult) -> Item {
    Item {
        id: text(row, "id"),
        code: text(row, "code"),
        name: text(row, "name"),
        spec: text(row, "spec"),
        kind: text(row, "kind"),
        unit: text(row, "unit"),
        precision: int(row, "precision"),
        barcode: text(row, "barcode"),
        minimum: int(row, "minimum"),
        balance: int(row, "balance"),
        active: int(row, "active") == 1,
        version: int(row, "version"),
        counting: row.try_get::<i64>("", "counting").unwrap_or(0) > 0,
        can_delete: int(row, "balance") == 0
            && row.try_get::<i64>("", "has_history").unwrap_or(1) == 0,
    }
}
#[derive(Clone, Deserialize, Default)]
pub struct Filter {
    pub q: Option<String>,
    pub page: Option<u64>,
    pub kind: Option<String>,
    pub low: Option<bool>,
    pub ids: Option<String>,
    pub item_id: Option<String>,
    pub status: Option<String>,
    pub sort: Option<String>,
}
pub async fn items(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<JsonValue>> {
    current(&s, &headers).await?.require("items.read")?;
    let page = filter.page.unwrap_or(1).clamp(1, 1_000_000);
    let (base, base_values) = item_search(&filter)?;
    let counts = one(&s.db, &format!("SELECT COUNT(CASE WHEN active=1 THEN 1 END) AS active,COUNT(CASE WHEN active=1 AND minimum>=0 AND balance<=minimum THEN 1 END) AS low,COUNT(CASE WHEN active=1 AND balance=0 THEN 1 END) AS zero,COUNT(CASE WHEN active=0 THEN 1 END) AS archived FROM items WHERE {base}"), base_values).await?.unwrap();
    let (where_clause, values, order) = item_filter(&filter)?;
    let count = one(
        &s.db,
        &format!("SELECT COUNT(*) AS total FROM items WHERE {where_clause}"),
        values.clone(),
    )
    .await?
    .unwrap();
    let mut paged = values;
    paged.push(((page - 1) * 50).into());
    let rows=all(&s.db,&format!("SELECT items.*, (EXISTS(SELECT 1 FROM document_lines dl WHERE dl.item_id=items.id) OR EXISTS(SELECT 1 FROM stocktake_lines sl WHERE sl.item_id=items.id)) AS has_history, (SELECT COUNT(*) FROM stocktake_lines sl JOIN stocktakes st ON sl.stocktake_id=st.id WHERE sl.item_id=items.id AND st.status='open') AS counting FROM items WHERE {where_clause} ORDER BY {order} LIMIT 50 OFFSET ?"),paged).await?;
    Ok(Json(
        json!({"items":rows.iter().map(item).collect::<Vec<_>>(),"total":int(&count,"total"),"page":page,"counts":{"active":int(&counts,"active"),"low":int(&counts,"low"),"zero":int(&counts,"zero"),"archived":int(&counts,"archived")}}),
    ))
}
fn item_search(filter: &Filter) -> Result<(String, Vec<sea_orm::Value>)> {
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索内容", 100, false)?;
    let kind = filter.kind.clone().unwrap_or_default();
    let search = format!(
        "%{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut where_clause = "(name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR spec LIKE ? ESCAPE '\\' OR barcode=?) AND (?='' OR kind=?)".to_string();
    let mut values: Vec<sea_orm::Value> = vec![
        search.clone().into(),
        search.clone().into(),
        search.into(),
        q.into(),
        kind.clone().into(),
        kind.into(),
    ];
    if let Some(ids) = &filter.ids {
        let ids: Vec<&str> = ids.split(',').collect();
        if ids.is_empty() || ids.len() > 50 || ids.iter().any(|id| id.is_empty() || id.len() > 100)
        {
            return Err(ApiError::bad("每次最多查询 50 个有效物料编号。"));
        }
        where_clause.push_str(&format!(" AND id IN ({})", vec!["?"; ids.len()].join(",")));
        values.extend(ids.into_iter().map(|id| id.to_string().into()));
    }
    Ok((where_clause, values))
}
pub(crate) fn item_filter(filter: &Filter) -> Result<(String, Vec<sea_orm::Value>, &'static str)> {
    let (mut clause, values) = item_search(filter)?;
    let status = filter
        .status
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(if filter.low.unwrap_or(false) {
            "low"
        } else {
            "active"
        });
    clause.push_str(match status {
        "active" => " AND active=1",
        "low" => " AND active=1 AND minimum>=0 AND balance<=minimum",
        "zero" => " AND active=1 AND balance=0",
        "archived" => " AND active=0",
        _ => return Err(ApiError::bad("物料状态筛选无效。")),
    });
    let order = match filter.sort.as_deref().unwrap_or("") {
        "" | "newest" => "created_at DESC,id",
        "stock_asc" => "balance ASC,code,id",
        "stock_desc" => "balance DESC,code,id",
        "name" => "name,code,id",
        _ => return Err(ApiError::bad("物料排序方式无效。")),
    };
    Ok((clause, values, order))
}
#[derive(Deserialize)]
pub struct ItemInput {
    pub code: Option<String>,
    pub name: String,
    #[serde(default)]
    pub spec: String,
    pub kind: String,
    pub unit: String,
    #[serde(default = "default_precision")]
    pub precision: i64,
    #[serde(default)]
    pub barcode: String,
    pub minimum: Option<String>,
    pub version: Option<i64>,
}
fn default_precision() -> i64 {
    3
}
fn validate_item(input: &ItemInput) -> Result<()> {
    clean(&input.name, "物料名称", 100, true)?;
    clean(&input.spec, "规格", 100, false)?;
    clean(&input.unit, "单位", 16, true)?;
    clean(&input.barcode, "条码", 128, false)?;
    clean(&input.kind, "物料类型", 100, false)?;
    if !(0..=3).contains(&input.precision) {
        return Err(ApiError::bad("请选择有效类型及 0–3 位小数位数。"));
    }
    Ok(())
}
pub async fn create_item(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ItemInput>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    actor.require("items.create")?;
    validate_item(&input)?;
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    let iid = create_item_record(&txn, &actor, input).await?;
    txn.commit().await?;
    Ok(Json(json!({"id":iid})))
}

pub(crate) async fn create_item_record(
    txn: &impl ConnectionTrait,
    actor: &User,
    input: ItemInput,
) -> Result<String> {
    validate_item(&input)?;
    let spec = crate::options::ensure(txn, "spec", &input.spec).await?;
    let kind = crate::options::ensure(txn, "kind", &input.kind).await?;
    let unit = crate::options::ensure(txn, "unit", &input.unit).await?;
    let iid = id();
    let code = input
        .code
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.trim().to_uppercase())
        .unwrap_or_else(|| format!("WL-{}", iid[..8].to_uppercase()));
    clean(&code, "物料编码", 64, true)?;
    ensure_unique(txn, &code, &input.barcode, "").await?;
    let minimum = match input.minimum.as_deref().filter(|v| !v.trim().is_empty()) {
        Some(v) => domain::quantity(v, input.precision, true)?,
        None => -1,
    };
    execute(
        txn,
        "INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        vec![
            iid.clone().into(),
            code.into(),
            input.name.trim().into(),
            spec.into(),
            kind.into(),
            unit.into(),
            input.precision.into(),
            input.barcode.trim().into(),
            minimum.into(),
            0i64.into(),
            1i64.into(),
            1i64.into(),
            now().into(),
        ],
    )
    .await?;
    audit(txn, actor, "新增物料", &iid, json!({"name":input.name})).await?;
    Ok(iid)
}
async fn ensure_unique(
    db: &impl ConnectionTrait,
    code: &str,
    barcode: &str,
    except: &str,
) -> Result<()> {
    if one(
        db,
        "SELECT id FROM items WHERE id<>? AND (code=? OR (?<>'' AND barcode=?))",
        vec![
            except.into(),
            code.into(),
            barcode.trim().into(),
            barcode.trim().into(),
        ],
    )
    .await?
    .is_some()
    {
        return Err(ApiError::conflict(
            "物料编码或条码已存在，请检查是否重复添加。",
        ));
    }
    Ok(())
}
pub async fn update_item(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(iid): Path<String>,
    Json(input): Json<ItemInput>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    actor.require("items.update")?;
    validate_item(&input)?;
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    let old = one(
        &txn,
        "SELECT * FROM items WHERE id=?",
        vec![iid.clone().into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    if input.version != Some(int(&old, "version")) {
        return Err(ApiError::conflict("物料资料已被修改，请刷新后重试。"));
    }
    if (input.precision != int(&old, "precision") || input.unit.trim() != text(&old, "unit"))
        && one(
            &txn,
            "SELECT id FROM document_lines WHERE item_id=? LIMIT 1",
            vec![iid.clone().into()],
        )
        .await?
        .is_some()
    {
        return Err(ApiError::bad("已有库存记录，不能直接更改单位或小数位数。"));
    }
    let code = input.code.as_deref().unwrap_or("").trim().to_uppercase();
    clean(&code, "编码", 64, true)?;
    ensure_unique(&txn, &code, &input.barcode, &iid).await?;
    let minimum = match input.minimum.as_deref().filter(|v| !v.is_empty()) {
        Some(v) => domain::quantity(v, input.precision, true)?,
        None => -1,
    };
    let mut values = Vec::new();
    for (field, value) in [
        ("spec", &input.spec),
        ("kind", &input.kind),
        ("unit", &input.unit),
    ] {
        values.push(if value.trim() == text(&old, field) {
            value.trim().to_string()
        } else {
            crate::options::ensure(&txn, field, value).await?
        });
    }
    execute(&txn,"UPDATE items SET code=?,name=?,spec=?,kind=?,unit=?,precision=?,barcode=?,minimum=?,version=version+1 WHERE id=?",vec![code.into(),input.name.trim().into(),values[0].clone().into(),values[1].clone().into(),values[2].clone().into(),input.precision.into(),input.barcode.trim().into(),minimum.into(),iid.clone().into()]).await?;
    audit(
        &txn,
        &actor,
        "修改物料",
        &iid,
        json!({"before":item(&old),"name":input.name}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
pub async fn delete_item(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(iid): Path<String>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    actor.require("items.delete")?;
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    let old = one(
        &txn,
        "SELECT * FROM items WHERE id=?",
        vec![iid.clone().into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    if int(&old, "balance") != 0 {
        return Err(ApiError::conflict(
            "这件物料仍有库存，不能删除。请先核实并处理库存。",
        ));
    }
    if one(&txn, "SELECT id FROM document_lines WHERE item_id=? UNION ALL SELECT id FROM stocktake_lines WHERE item_id=? LIMIT 1", vec![iid.clone().into(), iid.clone().into()]).await?.is_some() {
        return Err(ApiError::conflict("这件物料已有收发或清点记录，不能删除。库存为 0 时可以停用，历史记录会保留。"));
    }
    audit(&txn, &actor, "删除物料", &iid, json!({"before":item(&old)})).await?;
    execute(&txn, "DELETE FROM items WHERE id=?", vec![iid.into()]).await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}

pub async fn archive_item(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(iid): Path<String>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    actor.require("items.delete")?;
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    ensure_not_counting(&txn, &iid).await?;
    let result = execute(
        &txn,
        "UPDATE items SET active=0,version=version+1 WHERE id=? AND balance=0 AND active=1",
        vec![iid.clone().into()],
    )
    .await?;
    if result.rows_affected() != 1 {
        return Err(ApiError::conflict("只能停用库存为 0 的在用物料。"));
    }
    audit(&txn, &actor, "停用物料", &iid, json!({})).await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct ItemVersion {
    pub version: i64,
}
pub async fn restore_item(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(iid): Path<String>,
    Json(input): Json<ItemVersion>,
) -> Result<Json<JsonValue>> {
    let _lock = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    actor.require("items.update")?;
    let txn = s.db.begin().await?;
    let result = execute(
        &txn,
        "UPDATE items SET active=1,version=version+1 WHERE id=? AND active=0 AND version=?",
        vec![iid.clone().into(), input.version.into()],
    )
    .await?;
    if result.rows_affected() != 1 {
        return Err(ApiError::conflict("物料状态已变化，请刷新后重试。"));
    }
    audit(
        &txn,
        &actor,
        "启用物料",
        &iid,
        json!({"previous_version":input.version}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
pub async fn ensure_not_counting(db: &impl ConnectionTrait, iid: &str) -> Result<()> {
    if one(db,"SELECT sl.id FROM stocktake_lines sl JOIN stocktakes s ON sl.stocktake_id=s.id WHERE sl.item_id=? AND s.status='open' LIMIT 1",vec![iid.into()]).await?.is_some(){return Err(ApiError::conflict("这件物料正在清点，暂时不能收发，请联系管理员完成或取消清点。"));}
    Ok(())
}
#[derive(Deserialize, Serialize)]
pub struct Movement {
    pub request_id: String,
    pub kind: String,
    #[serde(default)]
    pub person: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub reference_id: String,
    pub lines: Vec<MovementLine>,
}
#[derive(Deserialize, Serialize)]
pub struct MovementLine {
    pub item_id: String,
    pub quantity: String,
}
pub async fn movement(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Movement>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    Ok(Json(post_movement(&s, actor, input).await?))
}

pub(crate) async fn post_movement(s: &AppState, actor: User, input: Movement) -> Result<JsonValue> {
    let kind = MovementKind::parse(&input.kind)?;
    actor.require(if kind.admin_only() {
        "movement.special"
    } else if kind.incoming() {
        "movement.in"
    } else {
        "movement.out"
    })?;
    if matches!(kind, MovementKind::ReturnIn | MovementKind::ReturnOut)
        && input.reference_id.is_empty()
    {
        clean(&input.note, "无原单退回原因", 500, true)?;
    }
    clean(&input.note, "备注", 500, kind == MovementKind::Scrap)?;
    clean(&input.person, "领用人或来源去向", 100, false)?;
    if uuid::Uuid::parse_str(&input.request_id).is_err() {
        return Err(ApiError::bad("请求编号无效，请重新打开表单。"));
    }
    if input.lines.is_empty() || input.lines.len() > 100 {
        return Err(ApiError::bad("每次请选择 1–100 件物料。"));
    }
    let hash = digest(&serde_json::to_string(&input).unwrap());
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    if let Some(old) = one(
        &txn,
        "SELECT * FROM requests WHERE id=?",
        vec![input.request_id.clone().into()],
    )
    .await?
    {
        if text(&old, "actor_id") != actor.id || text(&old, "fingerprint") != hash {
            return Err(ApiError::conflict(
                "该请求编号已用于其他内容，请重新打开表单。",
            ));
        }
        return Ok(serde_json::from_str(&text(&old, "response")).unwrap());
    }
    let did = id();
    let number = format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%d%H%M%S"),
        &did[..8]
    );
    execute(
        &txn,
        "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)",
        vec![
            did.clone().into(),
            number.clone().into(),
            input.kind.clone().into(),
            actor.id.clone().into(),
            actor.name.clone().into(),
            input.person.trim().into(),
            input.note.trim().into(),
            "posted".into(),
            input.reference_id.clone().into(),
            now().into(),
        ],
    )
    .await?;
    let mut seen = HashSet::new();
    let mut results = vec![];
    for line in &input.lines {
        if !seen.insert(&line.item_id) {
            return Err(ApiError::bad("同一物料请合并数量后提交。"));
        }
        ensure_not_counting(&txn, &line.item_id).await?;
        let row = one(
            &txn,
            "SELECT * FROM items WHERE id=? AND active=1",
            vec![line.item_id.clone().into()],
        )
        .await?
        .ok_or_else(ApiError::missing)?;
        let material = item(&row);
        let qty = domain::quantity(
            &line.quantity,
            material.precision,
            kind == MovementKind::Opening,
        )?;
        if kind == MovementKind::Opening
            && one(
                &txn,
                "SELECT id FROM document_lines WHERE item_id=? LIMIT 1",
                vec![line.item_id.clone().into()],
            )
            .await?
            .is_some()
        {
            return Err(ApiError::conflict(
                "已有出入库记录的物料不能再次登记初始库存，请使用清点库存。",
            ));
        }
        if !input.reference_id.is_empty() {
            check_return(&txn, &input.reference_id, &line.item_id, qty, kind).await?;
        }
        let delta = if kind.incoming() { qty } else { -qty };
        let balance = material
            .balance
            .checked_add(delta)
            .filter(|b| *b >= 0 && *b <= domain::MAX_QUANTITY)
            .ok_or_else(|| {
                ApiError::conflict(format!(
                    "{} 当前库存 {} {}，无法完成本次数量，请修改。",
                    material.name,
                    domain::display(material.balance, material.precision),
                    material.unit
                ))
            })?;
        let affected = execute(
            &txn,
            "UPDATE items SET balance=balance+?,version=version+1 WHERE id=? AND balance=?",
            vec![
                delta.into(),
                line.item_id.clone().into(),
                material.balance.into(),
            ],
        )
        .await?
        .rows_affected();
        if affected != 1 {
            return Err(ApiError::conflict("库存已发生变化，请刷新后重新确认。"));
        }
        insert_line(&txn, &did, &material, qty, delta, balance).await?;
        results.push(json!({"item_id":material.id,"name":material.name,"unit":material.unit,"precision":material.precision,"quantity":qty,"balance_after":balance}));
    }
    let result = json!({"id":did,"number":number,"kind":input.kind,"lines":results});
    audit(&txn, &actor, kind.label(), &did, result.clone()).await?;
    execute(
        &txn,
        "INSERT INTO requests VALUES (?,?,?,?,?)",
        vec![
            input.request_id.into(),
            actor.id.into(),
            hash.into(),
            result.to_string().into(),
            now().into(),
        ],
    )
    .await?;
    txn.commit().await?;
    Ok(result)
}
pub async fn insert_line(
    db: &impl ConnectionTrait,
    did: &str,
    m: &Item,
    quantity: i64,
    delta: i64,
    balance: i64,
) -> Result<()> {
    execute(
        db,
        "INSERT INTO document_lines VALUES (?,?,?,?,?,?,?,?,?,?)",
        vec![
            id().into(),
            did.into(),
            m.id.clone().into(),
            m.name.clone().into(),
            m.code.clone().into(),
            m.unit.clone().into(),
            m.precision.into(),
            quantity.into(),
            delta.into(),
            balance.into(),
        ],
    )
    .await?;
    Ok(())
}
async fn check_return(
    db: &impl ConnectionTrait,
    reference: &str,
    iid: &str,
    quantity: i64,
    kind: MovementKind,
) -> Result<()> {
    if one(
        db,
        "SELECT document_id FROM sales_inventory WHERE document_id=?",
        vec![reference.into()],
    )
    .await?
    .is_some()
    {
        return Err(ApiError::conflict("销售关联库存请从销售单办理退货。"));
    }
    if !matches!(kind, MovementKind::ReturnIn | MovementKind::ReturnOut) {
        return Err(ApiError::bad("只有退回记录可以关联原单。"));
    }
    let original=one(db,"SELECT dl.delta,dl.quantity FROM documents d JOIN document_lines dl ON dl.document_id=d.id WHERE d.id=? AND dl.item_id=? AND d.status='posted'",vec![reference.into(),iid.into()]).await?.ok_or_else(||ApiError::bad("原单不存在、已作废或没有这件物料。"))?;
    if (int(&original, "delta") < 0) != kind.incoming() {
        return Err(ApiError::bad("退回方向与原单不符。"));
    }
    let returned=one(db,"SELECT COALESCE(SUM(dl.quantity),0) AS total FROM documents d JOIN document_lines dl ON d.id=dl.document_id WHERE d.reference_id=? AND dl.item_id=? AND d.status='posted'",vec![reference.into(),iid.into()]).await?.unwrap();
    if quantity + int(&returned, "total") > int(&original, "quantity") {
        return Err(ApiError::bad("累计退回数量不能超过原单数量。"));
    }
    Ok(())
}
pub(crate) fn document_filter(
    filter: &Filter,
    actor: &User,
) -> Result<(String, Vec<sea_orm::Value>)> {
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索内容", 100, false)?;
    let mut clause = "(?=1 OR d.actor_id=?) AND (?='' OR instr(d.number,?)>0 OR instr(d.actor_name,?)>0 OR instr(d.person,?)>0 OR instr(d.note,?)>0 OR EXISTS(SELECT 1 FROM document_lines l WHERE l.document_id=d.id AND (instr(l.item_name,?)>0 OR instr(l.item_code,?)>0)))".to_string();
    let mut values = vec![actor.can("records.all").into(), actor.id.clone().into()];
    values.extend((0..7).map(|_| q.clone().into()));
    if let Some(item_id) = filter.item_id.as_deref().filter(|id| !id.is_empty()) {
        let item_id = clean(item_id, "物料", 100, true)?;
        clause.push_str(" AND EXISTS(SELECT 1 FROM document_lines material WHERE material.document_id=d.id AND material.item_id=?)");
        values.push(item_id.into());
    }
    clause.push_str(match filter.kind.as_deref().unwrap_or("") {
        "" => "",
        "in" => " AND d.kind IN ('receipt','finished','return_in','opening')",
        "out" => " AND d.kind IN ('issue','shipment','return_out','scrap')",
        "void" => " AND (d.kind='void' OR d.status='voided')",
        "adjustment" => " AND d.kind='adjustment'",
        "sales" => " AND d.kind='sales'",
        _ => return Err(ApiError::bad("记录类型筛选无效。")),
    });
    Ok((clause, values))
}
pub(crate) fn audit_filter(filter: &Filter, actor: &User) -> Result<(String, Vec<sea_orm::Value>)> {
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索内容", 100, false)?;
    let action = clean(filter.kind.as_deref().unwrap_or(""), "操作类型", 100, false)?;
    Ok(("(?=1 OR actor_id=?) AND (?='' OR instr(actor_name,?)>0 OR instr(action,?)>0 OR instr(details,?)>0 OR instr(object_id,?)>0) AND (?='' OR action=?)".into(), vec![actor.can("records.all").into(), actor.id.clone().into(),q.clone().into(),q.clone().into(),q.clone().into(),q.clone().into(),q.into(),action.clone().into(),action.into()]))
}
pub async fn documents(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    actor.require("records.read")?;
    let offset = (filter.page.unwrap_or(1).clamp(1, 1_000_000) - 1) * 50;
    let (clause, values) = document_filter(&filter, &actor)?;
    let count = one(
        &s.db,
        &format!("SELECT COUNT(*) AS total FROM documents d WHERE {clause}"),
        values.clone(),
    )
    .await?
    .unwrap();
    let mut paged = values;
    paged.push(offset.into());
    let rows=all(&s.db,&format!("SELECT d.* FROM documents d WHERE {clause} ORDER BY d.created_at DESC,d.id LIMIT 50 OFFSET ?"),paged).await?;
    let mut docs = vec![];
    for row in rows {
        docs.push(document(&s.db, row).await?);
    }
    let selected_item = if actor.can("items.read") {
        if let Some(id) = filter.item_id.as_deref().filter(|id| !id.is_empty()) {
            one(&s.db, "SELECT name,code,spec FROM items WHERE id=?", vec![id.trim().into()])
                .await?
                .map(|row| json!({"name":text(&row,"name"),"code":text(&row,"code"),"spec":text(&row,"spec")}))
        } else {
            None
        }
    } else {
        None
    };
    Ok(Json(
        json!({"items":docs,"total":int(&count,"total"),"selected_item":selected_item}),
    ))
}
pub async fn document(db: &impl ConnectionTrait, row: sea_orm::QueryResult) -> Result<JsonValue> {
    let did = text(&row, "id");
    let lines=all(db,"SELECT * FROM document_lines WHERE document_id=? ORDER BY id",vec![did.clone().into()]).await?.iter().map(|r|json!({"item_id":text(r,"item_id"),"name":text(r,"item_name"),"unit":text(r,"unit"),"precision":int(r,"precision"),"quantity":int(r,"quantity"),"delta":int(r,"delta"),"balance_after":int(r,"balance_after")})).collect::<Vec<_>>();
    Ok(
        json!({"id":did,"number":text(&row,"number"),"kind":text(&row,"kind"),"actor_name":text(&row,"actor_name"),"person":text(&row,"person"),"note":text(&row,"note"),"status":text(&row,"status"),"reference_id":text(&row,"reference_id"),"created_at":int(&row,"created_at"),"lines":lines}),
    )
}
#[derive(Deserialize)]
pub struct Reason {
    pub reason: String,
}
pub async fn void_document(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(did): Path<String>,
    Json(input): Json<Reason>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    actor.require("records.void")?;
    let reason = clean(&input.reason, "作废原因", 500, true)?;
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    let old = one(
        &txn,
        "SELECT * FROM documents WHERE id=?",
        vec![did.clone().into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    if !actor.can("records.all") && text(&old, "actor_id") != actor.id {
        return Err(ApiError::forbidden());
    }
    if one(
        &txn,
        "SELECT document_id FROM sales_inventory WHERE document_id=?",
        vec![did.clone().into()],
    )
    .await?
    .is_some()
    {
        return Err(ApiError::conflict(
            "销售关联库存请从销售单修订或作废，确保库存与收款一致。",
        ));
    }
    if text(&old, "status") != "posted"
        || ["void", "adjustment"].contains(&text(&old, "kind").as_str())
    {
        return Err(ApiError::conflict(
            "该记录不能作废；清点差异请重新清点调整。",
        ));
    }
    if one(
        &txn,
        "SELECT id FROM documents WHERE reference_id=? AND status='posted' LIMIT 1",
        vec![did.clone().into()],
    )
    .await?
    .is_some()
    {
        return Err(ApiError::conflict("这笔记录有关联退回，请先处理关联记录。"));
    }
    let reversal = id();
    let number = format!("ZF-{}", &reversal[..12]);
    execute(
        &txn,
        "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)",
        vec![
            reversal.clone().into(),
            number.into(),
            "void".into(),
            actor.id.clone().into(),
            actor.name.clone().into(),
            "".into(),
            reason.clone().into(),
            "posted".into(),
            did.clone().into(),
            now().into(),
        ],
    )
    .await?;
    let lines = all(
        &txn,
        "SELECT * FROM document_lines WHERE document_id=?",
        vec![did.clone().into()],
    )
    .await?;
    for line in lines {
        let iid = text(&line, "item_id");
        ensure_not_counting(&txn, &iid).await?;
        let material = item(
            &one(
                &txn,
                "SELECT * FROM items WHERE id=?",
                vec![iid.clone().into()],
            )
            .await?
            .ok_or_else(ApiError::missing)?,
        );
        let delta = -int(&line, "delta");
        let balance = material
            .balance
            .checked_add(delta)
            .filter(|x| *x >= 0 && *x <= domain::MAX_QUANTITY)
            .ok_or_else(|| ApiError::conflict("后续出入库已影响库存，当前不能作废这笔记录。"))?;
        execute(
            &txn,
            "UPDATE items SET balance=?,version=version+1 WHERE id=?",
            vec![balance.into(), iid.into()],
        )
        .await?;
        insert_line(&txn, &reversal, &material, delta.abs(), delta, balance).await?;
    }
    execute(
        &txn,
        "UPDATE documents SET status='voided' WHERE id=?",
        vec![did.clone().into()],
    )
    .await?;
    audit(
        &txn,
        &actor,
        "作废记录",
        &did,
        json!({"reason":reason,"reversal_id":reversal}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
pub async fn audits(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    actor.require("records.read")?;
    let offset = (filter.page.unwrap_or(1).clamp(1, 1_000_000) - 1) * 50;
    let (clause, values) = audit_filter(&filter, &actor)?;
    let count = one(
        &s.db,
        &format!("SELECT COUNT(*) AS total FROM audit WHERE {clause}"),
        values.clone(),
    )
    .await?
    .unwrap();
    let actions = all(
        &s.db,
        "SELECT DISTINCT action FROM audit WHERE (?=1 OR actor_id=?) ORDER BY action",
        vec![actor.can("records.all").into(), actor.id.clone().into()],
    )
    .await?;
    let mut paged = values;
    paged.push(offset.into());
    Ok(Json(
        json!({"items":all(&s.db,&format!("SELECT * FROM audit WHERE {clause} ORDER BY created_at DESC,id LIMIT 50 OFFSET ?"),paged).await?.into_iter().map(audit_json).collect::<Vec<_>>(),"total":int(&count,"total"),"actions":actions.iter().map(|row|text(row,"action")).collect::<Vec<_>>()}),
    ))
}
