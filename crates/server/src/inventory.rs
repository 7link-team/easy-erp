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
#[derive(Deserialize, Default)]
pub struct Filter {
    pub q: Option<String>,
    pub page: Option<u64>,
    pub kind: Option<String>,
    pub low: Option<bool>,
}
pub async fn items(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<JsonValue>> {
    current(&s, &headers).await?;
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索内容", 100, false)?;
    let kind = filter.kind.unwrap_or_default();
    let page = filter.page.unwrap_or(1).clamp(1, 1_000_000);
    let search = format!(
        "%{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let where_clause = "active=1 AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR barcode=?) AND (?='' OR kind=?) AND (?=0 OR (minimum>=0 AND balance<=minimum))";
    let values: Vec<sea_orm::Value> = vec![
        search.clone().into(),
        search.into(),
        q.into(),
        kind.clone().into(),
        kind.into(),
        (filter.low.unwrap_or(false) as i64).into(),
    ];
    let count = one(
        &s.db,
        &format!("SELECT COUNT(*) AS total FROM items WHERE {where_clause}"),
        values.clone(),
    )
    .await?
    .unwrap();
    let mut paged = values;
    paged.push(((page - 1) * 50).into());
    let rows=all(&s.db,&format!("SELECT items.*, (EXISTS(SELECT 1 FROM document_lines dl WHERE dl.item_id=items.id) OR EXISTS(SELECT 1 FROM stocktake_lines sl WHERE sl.item_id=items.id)) AS has_history, (SELECT COUNT(*) FROM stocktake_lines sl JOIN stocktakes st ON sl.stocktake_id=st.id WHERE sl.item_id=items.id AND st.status='open') AS counting FROM items WHERE {where_clause} ORDER BY created_at DESC,id LIMIT 50 OFFSET ?"),paged).await?;
    Ok(Json(
        json!({"items":rows.iter().map(item).collect::<Vec<_>>(),"total":int(&count,"total"),"page":page}),
    ))
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
    if !domain::ITEM_KINDS.contains(&input.kind.as_str()) || !(0..=3).contains(&input.precision) {
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
    actor.admin()?;
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
            input.spec.trim().into(),
            input.kind.into(),
            input.unit.trim().into(),
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
    actor.admin()?;
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
    execute(&txn,"UPDATE items SET code=?,name=?,spec=?,kind=?,unit=?,precision=?,barcode=?,minimum=?,version=version+1 WHERE id=?",vec![code.into(),input.name.trim().into(),input.spec.trim().into(),input.kind.into(),input.unit.trim().into(),input.precision.into(),input.barcode.trim().into(),minimum.into(),iid.clone().into()]).await?;
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
    actor.admin()?;
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
    actor.admin()?;
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
    if kind.admin_only() {
        actor.admin()?;
    } else if actor.role != "admin"
        && (actor.role == "viewer"
            || (kind.incoming() && !actor.can_in)
            || (!kind.incoming() && !actor.can_out))
    {
        return Err(ApiError::forbidden());
    }
    if matches!(kind, MovementKind::ReturnIn | MovementKind::ReturnOut)
        && input.reference_id.is_empty()
    {
        actor.admin()?;
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
pub async fn documents(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<JsonValue>> {
    let actor = current(&s, &headers).await?;
    let offset = (filter.page.unwrap_or(1).clamp(1, 1_000_000) - 1) * 50;
    let actor_filter = if actor.role == "admin" {
        String::new()
    } else {
        actor.id
    };
    let rows=all(&s.db,"SELECT * FROM documents WHERE (?='' OR actor_id=?) ORDER BY created_at DESC,id LIMIT 50 OFFSET ?",vec![actor_filter.clone().into(),actor_filter.into(),offset.into()]).await?;
    let mut docs = vec![];
    for row in rows {
        docs.push(document(&s.db, row).await?);
    }
    Ok(Json(json!({"items":docs})))
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
    actor.admin()?;
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
    let uid = if actor.role == "admin" {
        String::new()
    } else {
        actor.id
    };
    let offset = (filter.page.unwrap_or(1).clamp(1, 1_000_000) - 1) * 50;
    Ok(Json(
        json!({"items":all(&s.db,"SELECT * FROM audit WHERE (?='' OR actor_id=?) ORDER BY created_at DESC,id LIMIT 50 OFFSET ?",vec![uid.clone().into(),uid.into(),offset.into()]).await?.into_iter().map(audit_json).collect::<Vec<_>>()}),
    ))
}
