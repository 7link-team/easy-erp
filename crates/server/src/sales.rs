//! Sales commands own both their inventory and their financial adjustments.
use crate::{
    auth::{self, User, clean, current},
    db::*,
    domain,
    error::{ApiError, Result},
    inventory, money,
    state::AppState,
};
use axum::{
    Json,
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, header},
    response::{IntoResponse, Response},
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Serialize, Deserialize)]
pub struct SaleLine {
    pub item_id: String,
    pub name: String,
    pub code: String,
    pub spec: String,
    pub unit: String,
    pub quantity: i64,
    pub price: i64,
    pub amount: i64,
    pub allocated: i64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Sale {
    pub id: String,
    pub number: String,
    pub actor_id: String,
    pub actor_name: String,
    pub customer_id: String,
    pub customer: Value,
    #[serde(default)]
    pub department_id: String,
    #[serde(default)]
    pub department_name: String,
    #[serde(default)]
    pub salesperson_id: String,
    #[serde(default)]
    pub salesperson_name: String,
    pub type_id: String,
    pub type_name: String,
    pub billable: bool,
    pub business_date: String,
    pub note: String,
    pub status: String,
    pub version: i64,
    pub created_at: i64,
    pub lines: Vec<SaleLine>,
    pub subtotal: i64,
    pub discount_rate: i64,
    pub discount: i64,
    pub rounding: i64,
    pub total: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_payment: Option<InitialPayment>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct InitialPayment {
    pub account_id: String,
    pub amount: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct InputLine {
    pub item_id: String,
    pub quantity: String,
    #[serde(default)]
    pub price: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct SaleInput {
    pub customer_id: String,
    pub type_id: String,
    #[serde(default)]
    pub type_name: String,
    #[serde(default)]
    pub type_billable: Option<bool>,
    #[serde(default)]
    pub department_id: String,
    #[serde(default)]
    pub salesperson_id: String,
    pub business_date: String,
    #[serde(default)]
    pub note: String,
    pub lines: Vec<InputLine>,
    #[serde(default = "full_rate")]
    pub discount_rate: String,
    #[serde(default = "zero")]
    pub rounding: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_payment: Option<InitialPayment>,
}
fn full_rate() -> String {
    "100".into()
}
fn zero() -> String {
    "0".into()
}
#[derive(Serialize, Deserialize)]
pub struct Command {
    pub request_id: String,
    #[serde(default)]
    pub sale_id: String,
    pub action: String,
    #[serde(default)]
    pub version: i64,
    pub input: Option<SaleInput>,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub amount: String,
    #[serde(default)]
    pub business_date: String,
    #[serde(default)]
    pub cash_id: String,
    #[serde(default)]
    pub lines: Vec<InputLine>,
}
fn sales_access(actor: &User) -> Result<()> {
    actor.require("sales.read")
}
fn owner(actor: &User, sale: &Sale) -> Result<()> {
    sales_access(actor)?;
    if !actor.can("sales.all") && actor.id != sale.actor_id {
        return Err(ApiError::forbidden());
    }
    Ok(())
}
fn date(value: &str) -> Result<String> {
    let parsed = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ApiError::bad("请选择有效业务日期。"))?;
    if value.len() != 10 || parsed.format("%Y-%m-%d").to_string() != value {
        return Err(ApiError::bad("请选择有效业务日期。"));
    }
    Ok(value.into())
}
fn parsed(value: &str) -> Result<Value> {
    serde_json::from_str(value).map_err(|_| ApiError::bad("单据数据损坏，请检查主机日志。"))
}
async fn load(db: &impl ConnectionTrait, sid: &str) -> Result<Sale> {
    let row = one(db, "SELECT data FROM sales WHERE id=?", vec![sid.into()])
        .await?
        .ok_or_else(ApiError::missing)?;
    serde_json::from_str(&text(&row, "data")).map_err(|_| ApiError::bad("无法读取单据。"))
}
fn catalog_json(row: &sea_orm::QueryResult) -> Result<Value> {
    Ok(
        json!({"id":text(row,"id"),"kind":text(row,"kind"),"name":text(row,"name"),"active":int(row,"active")==1,"version":int(row,"version"),"data":parsed(&text(row,"data"))?}),
    )
}
async fn entry(db: &impl ConnectionTrait, eid: &str, kind: &str) -> Result<Value> {
    let row = one(
        db,
        "SELECT * FROM sales_catalog WHERE id=? AND kind=? AND active=1",
        vec![eid.into(), kind.into()],
    )
    .await?
    .ok_or_else(|| ApiError::bad("所选客户、类型、账户、部门或业务员不存在或已停用。"))?;
    catalog_json(&row)
}
// Include historical snapshots when deciding whether a catalog entry can be deleted.
// Counting distinct sale IDs avoids double-counting revisions of the same document.
async fn catalog_references(db: &impl ConnectionTrait) -> Result<HashMap<String, i64>> {
    let mut sources = Vec::new();
    for (table, sale_id, prefix) in [
        ("sales", "id", "$."),
        ("sales_revisions", "sale_id", "$.before."),
        ("sales_revisions", "sale_id", "$.after."),
    ] {
        for field in [
            "type_id",
            "customer_id",
            "department_id",
            "salesperson_id",
            "initial_payment.account_id",
        ] {
            sources.push(format!(
                "SELECT {sale_id} AS sale_id,json_extract(data,'{prefix}{field}') AS ref FROM {table}"
            ));
        }
    }
    sources.push("SELECT sale_id,account_id AS ref FROM sales_cash".into());
    let rows = all(db, &format!("SELECT ref,COUNT(DISTINCT sale_id) AS total FROM ({}) WHERE ref IS NOT NULL AND ref<>'' GROUP BY ref", sources.join(" UNION ALL ")), vec![]).await?;
    Ok(rows
        .iter()
        .map(|r| (text(r, "ref"), int(r, "total")))
        .collect())
}

pub async fn catalog(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    let rows = all(
        &s.db,
        "SELECT * FROM sales_catalog ORDER BY kind,COALESCE(json_extract(data,'$.sort'),0),name",
        vec![],
    )
    .await?;
    let references = catalog_references(&s.db).await?;
    let mut items = vec![];
    for r in &rows {
        let permission = match text(&r, "kind").as_str() {
            "account" => "accounts.read",
            "customer" => "customers.read",
            _ => "catalog.read",
        };
        if actor.can(permission) {
            let mut value = catalog_json(r)?;
            let used = references.get(&text(r, "id")).copied().unwrap_or(0);
            let members = rows
                .iter()
                .filter(|member| {
                    text(member, "kind") == "salesperson"
                        && parsed(&text(member, "data"))
                            .ok()
                            .is_some_and(|data| data["department_id"] == text(r, "id"))
                })
                .count();
            value["can_delete"] = json!(text(r, "kind") != "company" && used == 0 && members == 0);
            value["usage_count"] = if actor.can("sales.all") || actor.can("finance.read") {
                json!(used)
            } else {
                Value::Null
            };
            if text(r, "kind") == "department" {
                value["member_count"] = json!(members);
            }
            items.push(value);
        }
    }
    Ok(Json(json!({"items":items})))
}
#[derive(Deserialize, Serialize)]
pub struct CatalogInput {
    #[serde(default)]
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(default = "enabled")]
    pub active: bool,
    #[serde(default)]
    pub version: i64,
    #[serde(default)]
    pub data: Value,
}
fn enabled() -> bool {
    true
}
pub async fn save_catalog(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CatalogInput>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    let module = match input.kind.as_str() {
        "customer" => "customers",
        "account" => "accounts",
        _ => "catalog",
    };
    actor.require(&format!(
        "{module}.{}",
        if input.id.is_empty() {
            "create"
        } else {
            "update"
        }
    ))?;
    if !input.active {
        actor.require(&format!("{module}.update"))?;
    }
    if ![
        "customer",
        "type",
        "account",
        "company",
        "department",
        "salesperson",
    ]
    .contains(&input.kind.as_str())
    {
        return Err(ApiError::bad("配置类型无效。"));
    }
    let name = clean(&input.name, "名称", 100, true)?;
    let mut data = json!({});
    for key in ["phone", "contact", "address", "note"] {
        data[key] = json!(clean(
            input.data[key].as_str().unwrap_or(""),
            key,
            200,
            false
        )?);
    }
    let sort = match input.data.get("sort") {
        None => 0,
        Some(value) => value
            .as_i64()
            .filter(|value| (0..=9999).contains(value))
            .ok_or_else(|| ApiError::bad("排列顺序请填写 0–9999 的整数。"))?,
    };
    data["sort"] = json!(sort);
    if input.kind == "type" {
        data["billable"] = json!(
            input.data["billable"]
                .as_bool()
                .ok_or_else(|| ApiError::bad("请选择是否计款。"))?
        );
    }
    let txn = s.db.begin().await?;
    let eid = if input.kind == "company" {
        "company".into()
    } else if input.id.is_empty() {
        id()
    } else {
        input.id.clone()
    };
    let previous = one(
        &txn,
        "SELECT * FROM sales_catalog WHERE id=?",
        vec![eid.clone().into()],
    )
    .await?;
    if let Some(ref old) = previous {
        if text(old, "kind") != input.kind || int(old, "version") != input.version {
            return Err(ApiError::conflict("配置已更新，请刷新后重试。"));
        }
    } else if !input.id.is_empty() {
        return Err(ApiError::missing());
    }
    if input.kind == "salesperson" {
        let department_id = input.data["department_id"].as_str().unwrap_or("");
        let unchanged = previous.as_ref().is_some_and(|r| {
            parsed(&text(r, "data"))
                .ok()
                .is_some_and(|v| v["department_id"] == department_id)
        });
        if !unchanged {
            entry(&txn, department_id, "department").await?;
        }
        data["department_id"] = json!(department_id);
    }
    let duplicate = all(
        &txn,
        "SELECT * FROM sales_catalog WHERE kind=? AND id<>?",
        vec![input.kind.clone().into(), eid.clone().into()],
    )
    .await?
    .iter()
    .any(|r| {
        crate::options::key(&text(r, "name")) == crate::options::key(&name)
            && (input.kind != "salesperson"
                || parsed(&text(r, "data"))
                    .ok()
                    .is_some_and(|v| v["department_id"] == data["department_id"]))
    });
    if duplicate {
        return Err(ApiError::conflict(
            "该名称已存在，请选择已有记录或使用不同名称。",
        ));
    }
    let version = previous.as_ref().map_or(1, |r| int(r, "version") + 1);
    execute(&txn,"INSERT INTO sales_catalog VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active,version=excluded.version,data=excluded.data",vec![eid.clone().into(),input.kind.clone().into(),name.into(),(input.active as i64).into(),version.into(),data.to_string().into()]).await?;
    audit(
        &txn,
        &actor,
        "修改销售配置",
        &eid,
        json!({"before":previous.as_ref().map(catalog_json).transpose()?,"input":input}),
    )
    .await?;
    let result = catalog_json(
        &one(
            &txn,
            "SELECT * FROM sales_catalog WHERE id=?",
            vec![eid.into()],
        )
        .await?
        .unwrap(),
    )?;
    txn.commit().await?;
    Ok(Json(result))
}
async fn prepare(
    db: &impl ConnectionTrait,
    actor: &User,
    input: &SaleInput,
    old: Option<&Sale>,
) -> Result<Sale> {
    date(&input.business_date)?;
    clean(&input.note, "备注", 500, false)?;
    if input.lines.is_empty() || input.lines.len() > 100 {
        return Err(ApiError::bad("每张单请选择 1–100 件物料。"));
    }
    // Preserve snapshots on edits unless the corresponding reference actually changes.
    let customer = if let Some(o) = old.filter(|o| o.customer_id == input.customer_id) {
        o.customer.clone()
    } else {
        entry(db, &input.customer_id, "customer").await?
    };
    let typ = if let Some(o) = old.filter(|o| o.type_id == input.type_id) {
        json!({"name":o.type_name,"data":{"billable":o.billable}})
    } else {
        entry(db, &input.type_id, "type").await?
    };
    let (department_name, salesperson_name) =
        if input.department_id.is_empty() && input.salesperson_id.is_empty() {
            (String::new(), String::new())
        } else if input.department_id.is_empty() || input.salesperson_id.is_empty() {
            return Err(ApiError::bad("请选择部门及该部门的业务员。"));
        } else if let Some(o) = old.filter(|o| {
            o.department_id == input.department_id && o.salesperson_id == input.salesperson_id
        }) {
            (o.department_name.clone(), o.salesperson_name.clone())
        } else {
            let department = entry(db, &input.department_id, "department").await?;
            let salesperson = entry(db, &input.salesperson_id, "salesperson").await?;
            if salesperson["data"]["department_id"].as_str() != Some(input.department_id.as_str()) {
                return Err(ApiError::bad("业务员不属于所选部门。"));
            }
            (
                department["name"].as_str().unwrap_or("").into(),
                salesperson["name"].as_str().unwrap_or("").into(),
            )
        };
    let billable = typ["data"]["billable"].as_bool().unwrap_or(false);
    let rate = money::decimal(&input.discount_rate, 2)?;
    let rounding = money::decimal(&input.rounding, 2)?;
    if rate > 10000 {
        return Err(ApiError::bad("折扣率须在 0–100% 之间。"));
    }
    if !actor.can("sales.discount") && (rate != 10000 || rounding != 0) {
        return Err(ApiError::forbidden());
    }
    if !billable && (rate != 10000 || rounding != 0) {
        return Err(ApiError::bad("不计款单据不能设置优惠。"));
    }
    let mut seen = HashSet::new();
    let mut lines = vec![];
    let mut subtotal = 0i64;
    for line in &input.lines {
        if !seen.insert(&line.item_id) {
            return Err(ApiError::bad("同一物料请合并数量。"));
        }
        let row = one(
            db,
            "SELECT * FROM items WHERE id=?",
            vec![line.item_id.clone().into()],
        )
        .await?
        .ok_or_else(|| ApiError::bad("物料不存在或已停用。"))?;
        let material = inventory::item(&row);
        let previous = old.and_then(|o| o.lines.iter().find(|l| l.item_id == line.item_id));
        let quantity = domain::quantity(&line.quantity, material.precision, false)?;
        if !material.active && previous.is_none_or(|l| quantity > l.quantity) {
            return Err(ApiError::bad("不能增加已停用物料的出库数量。"));
        }
        let price = if billable {
            money::decimal(&line.price, 4)?
        } else {
            0
        };
        let amount = money::line(quantity, price)?;
        subtotal = subtotal
            .checked_add(amount)
            .filter(|v| *v <= money::MAX_MONEY)
            .ok_or_else(|| ApiError::bad("单据金额过大。"))?;
        lines.push(SaleLine {
            item_id: line.item_id.clone(),
            name: previous.map_or(material.name, |l| l.name.clone()),
            code: previous.map_or(material.code, |l| l.code.clone()),
            spec: previous.map_or(text(&row, "spec"), |l| l.spec.clone()),
            unit: previous.map_or(material.unit, |l| l.unit.clone()),
            quantity,
            price,
            amount,
            allocated: 0,
        });
    }
    let discounted = money::rounded(subtotal as i128 * rate as i128, 10000)?;
    if rounding > discounted {
        return Err(ApiError::bad("抹零金额不能超过折后金额。"));
    }
    let total = discounted - rounding;
    if let Some(payment) = &input.initial_payment {
        if old.is_some_and(|s| s.status == "posted") {
            return Err(ApiError::bad("已确认单据请使用收款操作。"));
        }
        actor.require("sales.pay")?;
        let amount = money::decimal(&payment.amount, 2)?;
        if !billable || amount == 0 || amount > total {
            return Err(ApiError::bad("本次收款必须大于 0 且不能超过应收金额。"));
        }
        entry(db, &payment.account_id, "account").await?;
    }
    // Cumulative allocation distributes cent remainders deterministically and never
    // allocates a negative amount to a zero-price line.
    let mut cumulative = 0i64;
    let mut allocated = 0i64;
    for line in &mut lines {
        cumulative += line.amount;
        let target = if subtotal == 0 {
            0
        } else {
            money::rounded(total as i128 * cumulative as i128, subtotal as i128)?
        };
        line.allocated = target - allocated;
        allocated = target;
    }
    let sid = old.map_or_else(id, |o| o.id.clone());
    Ok(Sale {
        id: sid.clone(),
        number: old.map_or_else(
            || format!("XS-{}-{}", chrono::Utc::now().format("%Y%m%d"), &sid[..8]),
            |o| o.number.clone(),
        ),
        actor_id: old.map_or(actor.id.clone(), |o| o.actor_id.clone()),
        actor_name: old.map_or(actor.name.clone(), |o| o.actor_name.clone()),
        customer_id: input.customer_id.clone(),
        customer,
        department_id: input.department_id.clone(),
        department_name,
        salesperson_id: input.salesperson_id.clone(),
        salesperson_name,
        type_id: input.type_id.clone(),
        type_name: typ["name"].as_str().unwrap_or("").into(),
        billable,
        business_date: input.business_date.clone(),
        note: input.note.trim().into(),
        status: old.map_or("draft".into(), |o| o.status.clone()),
        version: old.map_or(1, |o| o.version + 1),
        created_at: old.map_or_else(now, |o| o.created_at),
        lines,
        subtotal,
        discount_rate: rate,
        discount: subtotal - discounted,
        rounding,
        total,
        initial_payment: input.initial_payment.clone(),
    })
}
#[derive(Clone, Serialize, Deserialize)]
struct Returned {
    item_id: String,
    quantity: i64,
    credit: i64,
}
#[derive(Serialize, Deserialize)]
struct ReturnRecord {
    id: String,
    actor_name: String,
    reason: String,
    business_date: String,
    created_at: i64,
    lines: Vec<Returned>,
    credit: i64,
}
async fn returned(db: &impl ConnectionTrait, sid: &str) -> Result<HashMap<String, Returned>> {
    let mut map: HashMap<String, Returned> = HashMap::new();
    for r in all(
        db,
        "SELECT data FROM sales_returns WHERE sale_id=?",
        vec![sid.into()],
    )
    .await?
    {
        let record: ReturnRecord =
            serde_json::from_str(&text(&r, "data")).map_err(|_| ApiError::bad("退货记录损坏。"))?;
        for line in record.lines {
            let entry = map.entry(line.item_id.clone()).or_insert(Returned {
                item_id: line.item_id,
                quantity: 0,
                credit: 0,
            });
            entry.quantity += line.quantity;
            entry.credit += line.credit;
        }
    }
    Ok(map)
}
async fn paid(db: &impl ConnectionTrait, sid: &str) -> Result<i64> {
    Ok(int(
        &one(
            db,
            "SELECT COALESCE(SUM(amount),0) AS amount FROM sales_cash WHERE sale_id=?",
            vec![sid.into()],
        )
        .await?
        .unwrap(),
        "amount",
    ))
}
#[derive(Deserialize)]
pub struct CatalogVersion {
    version: i64,
}
pub async fn remove_catalog(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(eid): Path<String>,
    Query(input): Query<CatalogVersion>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    let txn = s.db.begin().await?;
    let row = one(
        &txn,
        "SELECT * FROM sales_catalog WHERE id=?",
        vec![eid.clone().into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    let kind = text(&row, "kind");
    let module = match kind.as_str() {
        "customer" => "customers",
        "account" => "accounts",
        _ => "catalog",
    };
    actor.require(&format!("{module}.delete"))?;
    if kind == "company" {
        return Err(ApiError::bad("公司信息只能修改，不能删除。"));
    }
    if int(&row, "version") != input.version {
        return Err(ApiError::conflict("资料已修改，请刷新后重试。"));
    }
    let used = catalog_references(&txn)
        .await?
        .get(&eid)
        .copied()
        .unwrap_or(0);
    let members = one(&txn, "SELECT id FROM sales_catalog WHERE kind='salesperson' AND json_extract(data,'$.department_id')=? LIMIT 1", vec![eid.clone().into()]).await?.is_some();
    if used > 0 || members {
        return Err(ApiError::conflict(
            "资料已有单据或业务员关联，请改为停用；历史记录会继续保留。",
        ));
    }
    execute(
        &txn,
        "DELETE FROM sales_catalog WHERE id=?",
        vec![eid.clone().into()],
    )
    .await?;
    audit(
        &txn,
        &actor,
        "删除未使用基础资料",
        &eid,
        catalog_json(&row)?,
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}

fn due(sale: &Sale, returns: &HashMap<String, Returned>) -> i64 {
    if sale.status == "posted" {
        sale.total - returns.values().map(|r| r.credit).sum::<i64>()
    } else {
        0
    }
}
async fn cash(
    db: &impl ConnectionTrait,
    actor: &User,
    sid: &str,
    account: &str,
    amount: i64,
    date_value: &str,
    note: &str,
    reversal: &str,
) -> Result<()> {
    let acc = entry(db, account, "account").await?;
    execute(
        db,
        "INSERT INTO sales_cash VALUES (?,?,?,?,?,?,?,?,?,?)",
        vec![
            id().into(),
            sid.into(),
            account.into(),
            acc["name"].as_str().unwrap().into(),
            amount.into(),
            actor.name.clone().into(),
            date(date_value)?.into(),
            clean(note, "收退款备注", 500, false)?.into(),
            reversal.into(),
            now().into(),
        ],
    )
    .await?;
    Ok(())
}
async fn inventory_delta(
    db: &impl ConnectionTrait,
    actor: &User,
    sid: &str,
    delta: &HashMap<String, i64>,
    reason: &str,
) -> Result<()> {
    if delta.values().all(|v| *v == 0) {
        return Ok(());
    }
    let did = id();
    execute(
        db,
        "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)",
        vec![
            did.clone().into(),
            format!("XS-KC-{}", &did[..8]).into(),
            "sales".into(),
            actor.id.clone().into(),
            actor.name.clone().into(),
            "".into(),
            reason.into(),
            "posted".into(),
            "".into(),
            now().into(),
        ],
    )
    .await?;
    execute(
        db,
        "INSERT INTO sales_inventory VALUES (?,?)",
        vec![did.clone().into(), sid.into()],
    )
    .await?;
    for (iid, change) in delta {
        if *change == 0 {
            continue;
        }
        inventory::ensure_not_counting(db, iid).await?;
        let r = one(
            db,
            "SELECT * FROM items WHERE id=?",
            vec![iid.clone().into()],
        )
        .await?
        .ok_or_else(ApiError::missing)?;
        let material = inventory::item(&r);
        if *change < 0 && !material.active {
            return Err(ApiError::bad("不能出库已停用物料。"));
        }
        let balance = material
            .balance
            .checked_add(*change)
            .filter(|v| *v >= 0 && *v <= domain::MAX_QUANTITY)
            .ok_or_else(|| {
                ApiError::conflict(format!(
                    "{} 库存不足或超出上限，当前库存 {} {}。",
                    material.name,
                    domain::display(material.balance, 3),
                    material.unit
                ))
            })?;
        if execute(
            db,
            "UPDATE items SET balance=?,version=version+1 WHERE id=? AND balance=?",
            vec![balance.into(), iid.clone().into(), material.balance.into()],
        )
        .await?
        .rows_affected()
            != 1
        {
            return Err(ApiError::conflict("库存已变化，请刷新重试。"));
        }
        inventory::insert_line(db, &did, &material, change.abs(), *change, balance).await?;
    }
    Ok(())
}
async fn persist(db: &impl ConnectionTrait, sale: &Sale) -> Result<()> {
    execute(db,"INSERT INTO sales VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,status=excluded.status,version=excluded.version,data=excluded.data",vec![sale.id.clone().into(),sale.actor_id.clone().into(),sale.customer_id.clone().into(),sale.status.clone().into(),sale.version.into(),sale.created_at.into(),serde_json::to_string(sale).unwrap().into()]).await?;
    Ok(())
}
async fn detail(db: &impl ConnectionTrait, actor: &User, sale: Sale) -> Result<Value> {
    owner(actor, &sale)?;
    let returns = returned(db, &sale.id).await?;
    let paid = paid(db, &sale.id).await?;
    let mut result = serde_json::to_value(&sale).unwrap();
    result["due"] = json!(due(&sale, &returns));
    result["paid"] = json!(paid);
    result["debt"] = json!(due(&sale, &returns) - paid);
    result["returned"] = json!(returns);
    let payments = all(
        db,
        "SELECT * FROM sales_cash WHERE sale_id=? ORDER BY created_at,id",
        vec![sale.id.clone().into()],
    )
    .await?;
    result["payments"]=json!(payments.iter().map(|r|json!({"id":text(r,"id"),"account_id":text(r,"account_id"),"account_name":text(r,"account_name"),"amount":int(r,"amount"),"actor_name":text(r,"actor_name"),"business_date":text(r,"business_date"),"note":text(r,"note"),"reversal_of":text(r,"reversal_of")})).collect::<Vec<_>>());
    result["attachments"]=json!(all(db,"SELECT id,mime,active,actor_name,created_at FROM sales_attachments WHERE sale_id=? AND (active=1 OR ?=1) ORDER BY created_at",vec![sale.id.clone().into(),actor.can("sales.history").into()]).await?.iter().map(|r|json!({"id":text(r,"id"),"mime":text(r,"mime"),"active":int(r,"active")==1,"actor_name":text(r,"actor_name"),"created_at":int(r,"created_at")})).collect::<Vec<_>>());
    result["returns"] = json!(
        all(
            db,
            "SELECT data FROM sales_returns WHERE sale_id=? ORDER BY created_at",
            vec![sale.id.clone().into()]
        )
        .await?
        .iter()
        .map(|r| parsed(&text(r, "data")))
        .collect::<Result<Vec<_>>>()?
    );
    result["revisions"]=json!(all(db,"SELECT version,actor_name,reason,created_at FROM sales_revisions WHERE sale_id=? ORDER BY version DESC",vec![sale.id.into()]).await?.iter().map(|r|json!({"version":int(r,"version"),"actor_name":text(r,"actor_name"),"reason":text(r,"reason"),"created_at":int(r,"created_at")})).collect::<Vec<_>>());
    Ok(result)
}
#[derive(Deserialize, Default)]
pub struct Filter {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub customer_id: Option<String>,
}
pub async fn list(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    let txn = s.db.begin().await?;
    sales_access(&actor)?;
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索", 100, false)?;
    let customer = filter.customer_id.unwrap_or_default();
    let page = filter.page.unwrap_or(1).clamp(1, 1000000);
    let rows=all(&txn,"SELECT data FROM sales WHERE (?=1 OR actor_id=?) AND (?='' OR customer_id=?) AND (?='' OR instr(data,?)>0) ORDER BY created_at DESC,id LIMIT 50 OFFSET ?",vec![actor.can("sales.all").into(),actor.id.clone().into(),customer.clone().into(),customer.into(),q.clone().into(),q.into(),((page-1)*50).into()]).await?;
    let mut items = vec![];
    for row in rows {
        let sale: Sale = serde_json::from_str(&text(&row, "data"))
            .map_err(|_| ApiError::bad("读取单据失败。"))?;
        let r = returned(&txn, &sale.id).await?;
        let p = paid(&txn, &sale.id).await?;
        let mut v = serde_json::to_value(&sale).unwrap();
        v["due"] = json!(due(&sale, &r));
        v["paid"] = json!(p);
        v["debt"] = json!(due(&sale, &r) - p);
        items.push(v);
    }
    Ok(Json(json!({"items":items,"page":page})))
}
pub async fn get(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<String>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    let txn = s.db.begin().await?;
    Ok(Json(detail(&txn, &actor, load(&txn, &sid).await?).await?))
}

pub async fn command(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<Command>,
) -> Result<Json<Value>> {
    if uuid::Uuid::parse_str(&input.request_id).is_err() {
        return Err(ApiError::bad("请求编号无效。"));
    }
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    sales_access(&actor)?;
    let permission = match input.action.as_str() {
        "save" => "sales.create",
        "confirm" => "sales.confirm",
        "revise" => "sales.revise",
        "pay" => "sales.pay",
        "refund" => "sales.refund",
        "correct" => "sales.correct",
        "return" => "sales.return",
        "void" => "sales.void",
        _ => return Err(ApiError::bad("单据操作无效。")),
    };
    actor.require(permission)?;
    if input.sale_id.is_empty() {
        actor.require("sales.create")?;
    }
    let hash = auth::digest(&format!("sales:{}", serde_json::to_string(&input).unwrap()));
    let txn = s.db.begin().await?;
    if let Some(row) = one(
        &txn,
        "SELECT * FROM requests WHERE id=?",
        vec![input.request_id.clone().into()],
    )
    .await?
    {
        if text(&row, "actor_id") != actor.id || text(&row, "fingerprint") != hash {
            return Err(ApiError::conflict("请求编号已用于其他内容。"));
        }
        let response = parsed(&text(&row, "response"))?;
        owner(
            &actor,
            &load(&txn, response["id"].as_str().ok_or_else(ApiError::missing)?).await?,
        )?;
        return Ok(Json(response));
    }
    let old = if input.sale_id.is_empty() {
        None
    } else {
        Some(load(&txn, &input.sale_id).await?)
    };
    if let Some(o) = &old {
        owner(&actor, o)?;
        if o.version != input.version {
            return Err(ApiError::conflict("单据已被修改，请刷新后重试。"));
        }
        if o.status == "voided" {
            return Err(ApiError::conflict("已作废单据不能继续操作。"));
        }
    }
    let reason = clean(
        &input.reason,
        "操作原因",
        500,
        old.as_ref().is_some_and(|o| o.status == "posted"),
    )?;
    let before = if let Some(o) = &old {
        Some(detail(&txn, &actor, o.clone()).await?)
    } else {
        None
    };
    let mut sale;
    let mut returns;
    match input.action.as_str() {
        "save" | "confirm" | "revise" => {
            if input.action == "save" && old.as_ref().is_some_and(|o| o.status != "draft") {
                return Err(ApiError::bad("已确认单据请使用修订单据。"));
            }
            if input.action == "confirm" && old.as_ref().is_some_and(|o| o.status != "draft") {
                return Err(ApiError::conflict("该单已确认。"));
            }
            if input.action == "revise" && !old.as_ref().is_some_and(|o| o.status == "posted") {
                return Err(ApiError::bad("只能修订已确认单据。"));
            }
            if let Some(ref mut data) = input.input {
                if !data.type_name.trim().is_empty() {
                    let name = clean(&data.type_name, "单据类型", 100, true)?;
                    let existing = all(
                        &txn,
                        "SELECT * FROM sales_catalog WHERE kind='type'",
                        vec![],
                    )
                    .await?
                    .into_iter()
                    .find(|r| crate::options::key(&text(r, "name")) == crate::options::key(&name));
                    data.type_id = if let Some(r) = existing {
                        if int(&r, "active") != 1 {
                            return Err(ApiError::bad("该单据类型已停用，请管理员启用后使用。"));
                        }
                        text(&r, "id")
                    } else {
                        let billable = data
                            .type_billable
                            .ok_or_else(|| ApiError::bad("新单据类型请选择是否计款。"))?;
                        let eid = id();
                        execute(
                            &txn,
                            "INSERT INTO sales_catalog VALUES (?,'type',?,1,1,?)",
                            vec![
                                eid.clone().into(),
                                name.clone().into(),
                                json!({"billable":billable,"sort":0}).to_string().into(),
                            ],
                        )
                        .await?;
                        audit(
                            &txn,
                            &actor,
                            "开单新增类型",
                            &eid,
                            json!({"name":name,"billable":billable}),
                        )
                        .await?;
                        eid
                    };
                }
            }
            sale = prepare(
                &txn,
                &actor,
                input
                    .input
                    .as_ref()
                    .ok_or_else(|| ApiError::bad("缺少开单内容。"))?,
                old.as_ref(),
            )
            .await?;
            if input.action != "save" {
                sale.status = "posted".into();
            }
            returns = returned(&txn, &sale.id).await?;
            for (iid, r) in &returns {
                let l = sale
                    .lines
                    .iter()
                    .find(|l| &l.item_id == iid)
                    .ok_or_else(|| ApiError::conflict("已有退货的物料不能移除。"))?;
                if l.quantity < r.quantity || l.allocated < r.credit {
                    return Err(ApiError::conflict(
                        "修订后的数量或金额不能低于该物料已退数量和金额。",
                    ));
                }
            }
            if sale.status == "posted" {
                let mut delta = HashMap::new();
                if let Some(o) = old.as_ref().filter(|o| o.status == "posted") {
                    for l in &o.lines {
                        *delta.entry(l.item_id.clone()).or_insert(0) += l.quantity;
                    }
                }
                for l in &sale.lines {
                    *delta.entry(l.item_id.clone()).or_insert(0) -= l.quantity;
                }
                inventory_delta(
                    &txn,
                    &actor,
                    &sale.id,
                    &delta,
                    &format!("{}：{}", sale.type_name, reason),
                )
                .await?;
                if let Some(payment) = sale.initial_payment.take() {
                    cash(
                        &txn,
                        &actor,
                        &sale.id,
                        &payment.account_id,
                        money::decimal(&payment.amount, 2)?,
                        &sale.business_date,
                        "开单收款",
                        "",
                    )
                    .await?;
                }
                let over = paid(&txn, &sale.id).await? - due(&sale, &returns);
                if over > 0 {
                    actor.require("sales.refund")?;
                    cash(
                        &txn,
                        &actor,
                        &sale.id,
                        &input.account_id,
                        -over,
                        &input.business_date,
                        &reason,
                        "",
                    )
                    .await?;
                }
            }
        }
        "pay" | "refund" | "correct" | "void" | "return" => {
            sale = old.clone().ok_or_else(ApiError::missing)?;
            if sale.status != "posted" {
                return Err(ApiError::bad("请先确认单据。"));
            }
            sale.version += 1;
            returns = returned(&txn, &sale.id).await?;
            match input.action.as_str() {
                "pay" | "refund" => {
                    let amount = money::decimal(&input.amount, 2)?;
                    if amount == 0 {
                        return Err(ApiError::bad("收退款金额必须大于 0。"));
                    }
                    let current_paid = paid(&txn, &sale.id).await?;
                    let change = if input.action == "refund" {
                        -amount
                    } else {
                        amount
                    };
                    if current_paid + change < 0 || current_paid + change > due(&sale, &returns) {
                        return Err(ApiError::bad("收退款不能超出该单应收或净实收金额。"));
                    }
                    cash(
                        &txn,
                        &actor,
                        &sale.id,
                        &input.account_id,
                        change,
                        &input.business_date,
                        &reason,
                        "",
                    )
                    .await?;
                }
                "correct" => {
                    let row = one(
                        &txn,
                        "SELECT * FROM sales_cash WHERE id=? AND sale_id=?",
                        vec![input.cash_id.clone().into(), sale.id.clone().into()],
                    )
                    .await?
                    .ok_or_else(ApiError::missing)?;
                    if !text(&row, "reversal_of").is_empty()
                        || one(
                            &txn,
                            "SELECT id FROM sales_cash WHERE reversal_of=?",
                            vec![input.cash_id.clone().into()],
                        )
                        .await?
                        .is_some()
                    {
                        return Err(ApiError::bad("该流水已经冲销，不能再次更正。"));
                    }
                    let original = int(&row, "amount");
                    let amount = money::decimal(&input.amount, 2)?;
                    let corrected = if original < 0 { -amount } else { amount };
                    let new_paid = paid(&txn, &sale.id).await? - original + corrected;
                    if new_paid < 0 || new_paid > due(&sale, &returns) {
                        return Err(ApiError::bad("更正后的收款超出有效范围。"));
                    }
                    // Reversal can use a retired account, preserving its historical identity.
                    execute(
                        &txn,
                        "INSERT INTO sales_cash VALUES (?,?,?,?,?,?,?,?,?,?)",
                        vec![
                            id().into(),
                            sale.id.clone().into(),
                            text(&row, "account_id").into(),
                            text(&row, "account_name").into(),
                            (-original).into(),
                            actor.name.clone().into(),
                            date(&input.business_date)?.into(),
                            reason.clone().into(),
                            input.cash_id.clone().into(),
                            now().into(),
                        ],
                    )
                    .await?;
                    if amount > 0 {
                        cash(
                            &txn,
                            &actor,
                            &sale.id,
                            &input.account_id,
                            corrected,
                            &input.business_date,
                            &reason,
                            "",
                        )
                        .await?;
                    }
                }
                "void" => {
                    let delta = sale
                        .lines
                        .iter()
                        .map(|l| {
                            (
                                l.item_id.clone(),
                                l.quantity - returns.get(&l.item_id).map_or(0, |r| r.quantity),
                            )
                        })
                        .collect();
                    inventory_delta(&txn, &actor, &sale.id, &delta, &reason).await?;
                    let remaining = paid(&txn, &sale.id).await?;
                    if remaining > 0 {
                        actor.require("sales.refund")?;
                        cash(
                            &txn,
                            &actor,
                            &sale.id,
                            &input.account_id,
                            -remaining,
                            &input.business_date,
                            &reason,
                            "",
                        )
                        .await?;
                    }
                    sale.status = "voided".into();
                }
                "return" => {
                    if input.lines.is_empty() || input.lines.len() > 100 {
                        return Err(ApiError::bad("请选择退货物料和数量。"));
                    }
                    let mut seen = HashSet::new();
                    let mut delta = HashMap::new();
                    let mut lines = vec![];
                    let mut credit = 0;
                    for l in &input.lines {
                        if !seen.insert(&l.item_id) {
                            return Err(ApiError::bad("请合并重复物料。"));
                        }
                        let original = sale
                            .lines
                            .iter()
                            .find(|o| o.item_id == l.item_id)
                            .ok_or_else(|| ApiError::bad("原单没有该物料。"))?;
                        let prior = returns.get(&l.item_id);
                        let already = prior.map_or(0, |r| r.quantity);
                        let credited = prior.map_or(0, |r| r.credit);
                        let material = one(
                            &txn,
                            "SELECT precision FROM items WHERE id=?",
                            vec![l.item_id.clone().into()],
                        )
                        .await?
                        .ok_or_else(ApiError::missing)?;
                        let qty =
                            domain::quantity(&l.quantity, int(&material, "precision"), false)?;
                        if qty > original.quantity - already {
                            return Err(ApiError::bad("退货数量超过该物料剩余可退数量。"));
                        }
                        let value = money::rounded(
                            (original.allocated - credited) as i128 * qty as i128,
                            (original.quantity - already) as i128,
                        )?;
                        credit += value;
                        delta.insert(l.item_id.clone(), qty);
                        lines.push(Returned {
                            item_id: l.item_id.clone(),
                            quantity: qty,
                            credit: value,
                        });
                    }
                    inventory_delta(&txn, &actor, &sale.id, &delta, &reason).await?;
                    let rid = id();
                    let record = ReturnRecord {
                        id: rid.clone(),
                        actor_name: actor.name.clone(),
                        reason: reason.clone(),
                        business_date: date(&input.business_date)?,
                        created_at: now(),
                        lines,
                        credit,
                    };
                    execute(
                        &txn,
                        "INSERT INTO sales_returns VALUES (?,?,?,?)",
                        vec![
                            rid.into(),
                            sale.id.clone().into(),
                            now().into(),
                            serde_json::to_string(&record).unwrap().into(),
                        ],
                    )
                    .await?;
                    returns = returned(&txn, &sale.id).await?;
                    let excess = paid(&txn, &sale.id).await? - due(&sale, &returns);
                    if excess > 0 {
                        actor.require("sales.refund")?;
                        cash(
                            &txn,
                            &actor,
                            &sale.id,
                            &input.account_id,
                            -excess,
                            &input.business_date,
                            &reason,
                            "",
                        )
                        .await?;
                    }
                }
                _ => unreachable!(),
            }
        }
        _ => return Err(ApiError::bad("单据操作无效。")),
    }
    persist(&txn, &sale).await?;
    let result = detail(&txn, &actor, sale.clone()).await?;
    let snapshot = json!({"before":before,"after":result,"command":input,"actor_name":actor.name});
    execute(
        &txn,
        "INSERT INTO sales_revisions VALUES (?,?,?,?,?,?,?)",
        vec![
            id().into(),
            sale.id.clone().into(),
            sale.version.into(),
            actor.name.clone().into(),
            reason.clone().into(),
            now().into(),
            snapshot.to_string().into(),
        ],
    )
    .await?;
    audit(
        &txn,
        &actor,
        &format!("销售单操作：{}", input.action),
        &sale.id,
        snapshot,
    )
    .await?;
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
    Ok(Json(result))
}

pub async fn finance(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    let txn = s.db.begin().await?;
    actor.require("finance.read")?;
    let mut customers: HashMap<String, Value> = HashMap::new();
    let mut performance: HashMap<(String, String), Value> = HashMap::new();
    let mut total = 0;
    let mut net_paid = 0;
    for row in all(&txn, "SELECT data FROM sales WHERE status='posted'", vec![]).await? {
        let sale: Sale = serde_json::from_str(&text(&row, "data"))
            .map_err(|_| ApiError::bad("读取单据失败。"))?;
        let amount = due(&sale, &returned(&txn, &sale.id).await?);
        let received = paid(&txn, &sale.id).await?;
        if sale.billable {
            let p = performance.entry((sale.department_id.clone(), sale.salesperson_id.clone())).or_insert(
                json!({"department_id":sale.department_id,"department_name":sale.department_name,"salesperson_id":sale.salesperson_id,"salesperson_name":sale.salesperson_name,"count":0,"due":0,"paid":0,"debt":0})
            );
            p["count"] = json!(p["count"].as_i64().unwrap() + 1);
            p["due"] = json!(p["due"].as_i64().unwrap() + amount);
            p["paid"] = json!(p["paid"].as_i64().unwrap() + received);
            p["debt"] = json!(p["due"].as_i64().unwrap() - p["paid"].as_i64().unwrap());
        }
        total += amount;
        net_paid += received;
        let c = customers.entry(sale.customer_id.clone()).or_insert(
            json!({"id":sale.customer_id,"name":sale.customer["name"],"due":0,"paid":0,"debt":0}),
        );
        c["due"] = json!(c["due"].as_i64().unwrap() + amount);
        c["paid"] = json!(c["paid"].as_i64().unwrap() + received);
        c["debt"] = json!(c["due"].as_i64().unwrap() - c["paid"].as_i64().unwrap());
    }
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索", 100, false)?;
    let cash_rows=all(&txn,"SELECT c.*,s.data AS sale_data FROM sales_cash c JOIN sales s ON s.id=c.sale_id WHERE (?='' OR c.account_id=?) ORDER BY c.created_at DESC,c.id",vec![q.clone().into(),q.into()]).await?;
    let mut accounts: HashMap<String, Value> = HashMap::new();
    let mut entries = vec![];
    for row in cash_rows {
        let amount = int(&row, "amount");
        let aid = text(&row, "account_id");
        let a = accounts.entry(aid.clone()).or_insert(
            json!({"id":aid,"name":text(&row,"account_name"),"received":0,"refunded":0,"net":0}),
        );
        if amount >= 0 {
            a["received"] = json!(a["received"].as_i64().unwrap() + amount);
        } else {
            a["refunded"] = json!(a["refunded"].as_i64().unwrap() - amount);
        }
        a["net"] = json!(a["net"].as_i64().unwrap() + amount);
        entries.push(json!({"id":text(&row,"id"),"sale_id":text(&row,"sale_id"),"number":parsed(&text(&row,"sale_data"))?["number"],"account_id":text(&row,"account_id"),"account_name":text(&row,"account_name"),"amount":amount,"actor_name":text(&row,"actor_name"),"business_date":text(&row,"business_date"),"note":text(&row,"note"),"reversal_of":text(&row,"reversal_of")}));
    }
    Ok(Json(
        json!({"due":total,"paid":net_paid,"debt":total-net_paid,"performance":performance.into_values().collect::<Vec<_>>(),"customers":customers.into_values().collect::<Vec<_>>(),"accounts":accounts.into_values().collect::<Vec<_>>(),"entries":entries}),
    ))
}

pub async fn upload(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    actor.require("sales.upload")?;
    owner(&actor, &load(&s.db, &sid).await?)?;
    let field = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::bad("上传图片失败。"))?
        .ok_or_else(|| ApiError::bad("请选择凭证图片。"))?;
    let bytes = field
        .bytes()
        .await
        .map_err(|_| ApiError::bad("图片太大或上传失败。"))?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(ApiError::bad("每张图片最大 10 MB。"));
    }
    let data = bytes.to_vec();
    let mime = tokio::task::spawn_blocking(move || -> Result<&'static str> {
        let format = image::guess_format(&data)
            .map_err(|_| ApiError::bad("请选择有效的 JPEG、PNG 或 WebP 图片。"))?;
        let mime = match format {
            image::ImageFormat::Jpeg => "image/jpeg",
            image::ImageFormat::Png => "image/png",
            image::ImageFormat::WebP => "image/webp",
            _ => return Err(ApiError::bad("仅支持 JPEG、PNG、WebP。")),
        };
        let mut reader = image::ImageReader::with_format(std::io::Cursor::new(&data), format);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(10000);
        limits.max_image_height = Some(10000);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        reader
            .decode()
            .map_err(|_| ApiError::bad("图片损坏或像素过大。"))?;
        Ok(mime)
    })
    .await
    .map_err(|_| ApiError::bad("图片验证失败。"))??;
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    let sale = load(&s.db, &sid).await?;
    actor.require("sales.upload")?;
    owner(&actor, &sale)?;
    if sale.status == "voided" {
        return Err(ApiError::conflict("不能向作废单据上传凭证。"));
    }
    let txn = s.db.begin().await?;
    if int(
        &one(
            &txn,
            "SELECT COUNT(*) AS count FROM sales_attachments WHERE sale_id=? AND active=1",
            vec![sid.clone().into()],
        )
        .await?
        .unwrap(),
        "count",
    ) >= 2
    {
        return Err(ApiError::bad("每张单最多保存两张凭证。"));
    }
    let aid = id();
    execute(
        &txn,
        "INSERT INTO sales_attachments VALUES (?,?,?,?,?,?,?)",
        vec![
            aid.clone().into(),
            sid.clone().into(),
            mime.into(),
            1.into(),
            actor.name.clone().into(),
            now().into(),
            bytes.to_vec().into(),
        ],
    )
    .await?;
    audit(
        &txn,
        &actor,
        "上传销售凭证",
        &sid,
        json!({"attachment_id":aid}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"id":aid})))
}
pub async fn attachment(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(aid): Path<String>,
) -> Result<Response> {
    let actor = current(&s, &headers).await?;
    let row = one(
        &s.db,
        "SELECT * FROM sales_attachments WHERE id=?",
        vec![aid.into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    owner(&actor, &load(&s.db, &text(&row, "sale_id")).await?)?;
    if int(&row, "active") != 1 {
        actor.require("sales.history")?;
    }
    let bytes: Vec<u8> = row
        .try_get("", "data")
        .map_err(|_| ApiError::bad("图片数据损坏。"))?;
    Ok(([(header::CONTENT_TYPE, text(&row, "mime"))], bytes).into_response())
}
pub async fn remove_attachment(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(aid): Path<String>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = current(&s, &headers).await?;
    actor.require("sales.attachment_delete")?;
    let txn = s.db.begin().await?;
    let row = one(
        &txn,
        "SELECT * FROM sales_attachments WHERE id=? AND active=1",
        vec![aid.clone().into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    owner(&actor, &load(&txn, &text(&row, "sale_id")).await?)?;
    execute(
        &txn,
        "UPDATE sales_attachments SET active=0 WHERE id=?",
        vec![aid.clone().into()],
    )
    .await?;
    audit(
        &txn,
        &actor,
        "移除销售凭证",
        &text(&row, "sale_id"),
        json!({"attachment_id":aid}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
pub async fn revision(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path((sid, version)): Path<(String, i64)>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    actor.require("sales.history")?;
    owner(&actor, &load(&s.db, &sid).await?)?;
    let row = one(
        &s.db,
        "SELECT data FROM sales_revisions WHERE sale_id=? AND version=?",
        vec![sid.into(), version.into()],
    )
    .await?
    .ok_or_else(ApiError::missing)?;
    Ok(Json(parsed(&text(&row, "data"))?))
}

/// Validate business invariants before a backup can replace live sales data.
pub async fn validate_backup(db: &impl ConnectionTrait) -> Result<()> {
    if one(
        db,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sales'",
        vec![],
    )
    .await?
    .is_none()
    {
        return Ok(());
    }
    let invalid = || ApiError::bad("备份中的销售、收款或退货数据不一致，不能恢复。");
    for row in all(db, "SELECT * FROM sales", vec![]).await? {
        let sale: Sale = serde_json::from_str(&text(&row, "data")).map_err(|_| invalid())?;
        if sale.id != text(&row, "id")
            || sale.actor_id != text(&row, "actor_id")
            || sale.customer_id != text(&row, "customer_id")
            || sale.status != text(&row, "status")
            || sale.version != int(&row, "version")
            || !["draft", "posted", "voided"].contains(&sale.status.as_str())
            || sale.lines.is_empty()
            || sale.lines.len() > 100
            || sale.discount_rate < 0
            || sale.discount_rate > 10000
            || sale.rounding < 0
        {
            return Err(invalid());
        }
        if sale.department_id.is_empty() != sale.salesperson_id.is_empty() {
            return Err(invalid());
        }
        if !sale.department_id.is_empty() {
            for (eid, kind) in [
                (&sale.department_id, "department"),
                (&sale.salesperson_id, "salesperson"),
            ] {
                if one(
                    db,
                    "SELECT id FROM sales_catalog WHERE id=? AND kind=?",
                    vec![eid.clone().into(), kind.into()],
                )
                .await?
                .is_none()
                {
                    return Err(invalid());
                }
            }
        }
        let mut seen = HashSet::new();
        let mut subtotal = 0i64;
        let mut allocation = 0i64;
        for l in &sale.lines {
            if !seen.insert(&l.item_id)
                || l.quantity <= 0
                || l.quantity > domain::MAX_QUANTITY
                || l.price < 0
                || l.price > money::MAX_MONEY
                || l.amount < 0
                || l.allocated < 0
                || money::line(l.quantity, l.price)? != l.amount
                || (!sale.billable && l.price != 0)
            {
                return Err(invalid());
            }
            subtotal = subtotal
                .checked_add(l.amount)
                .filter(|v| *v <= money::MAX_MONEY)
                .ok_or_else(invalid)?;
            allocation = allocation.checked_add(l.allocated).ok_or_else(invalid)?;
        }
        let discounted = money::rounded(subtotal as i128 * sale.discount_rate as i128, 10000)?;
        if sale.subtotal != subtotal
            || sale.discount != subtotal - discounted
            || sale.rounding > discounted
            || sale.total != discounted - sale.rounding
            || allocation != sale.total
        {
            return Err(invalid());
        }
        let returns = returned(db, &sale.id).await?;
        for (iid, r) in &returns {
            let l = sale
                .lines
                .iter()
                .find(|l| &l.item_id == iid)
                .ok_or_else(invalid)?;
            if r.quantity < 0 || r.quantity > l.quantity || r.credit < 0 || r.credit > l.allocated {
                return Err(invalid());
            }
        }
        let paid = paid(db, &sale.id).await?;
        let due = due(&sale, &returns);
        if due < 0 || paid < 0 || paid > due || (sale.status == "draft" && !returns.is_empty()) {
            return Err(invalid());
        }
    }
    for sql in [
        "SELECT COUNT(*) AS count FROM sales_cash c LEFT JOIN sales s ON s.id=c.sale_id LEFT JOIN sales_catalog a ON a.id=c.account_id AND a.kind='account' WHERE s.id IS NULL OR a.id IS NULL",
        "SELECT COUNT(*) AS count FROM sales_cash c LEFT JOIN sales_cash o ON o.id=c.reversal_of WHERE c.reversal_of<>'' AND (o.id IS NULL OR o.sale_id<>c.sale_id OR o.amount<>-c.amount OR o.reversal_of<>'')",
        "SELECT COUNT(*) AS count FROM (SELECT reversal_of FROM sales_cash WHERE reversal_of<>'' GROUP BY reversal_of HAVING COUNT(*)>1)",
        "SELECT COUNT(*) AS count FROM sales_returns r LEFT JOIN sales s ON s.id=r.sale_id WHERE s.id IS NULL",
        "SELECT COUNT(*) AS count FROM sales_inventory i LEFT JOIN sales s ON s.id=i.sale_id LEFT JOIN documents d ON d.id=i.document_id WHERE s.id IS NULL OR d.id IS NULL OR d.kind<>'sales' OR d.status<>'posted'",
        "SELECT COUNT(*) AS count FROM sales_attachments a LEFT JOIN sales s ON s.id=a.sale_id WHERE s.id IS NULL OR length(a.data)>10485760 OR a.mime NOT IN ('image/jpeg','image/png','image/webp')",
        "SELECT COUNT(*) AS count FROM (SELECT sale_id FROM sales_attachments WHERE active=1 GROUP BY sale_id HAVING COUNT(*)>2)",
    ] {
        if int(&one(db, sql, vec![]).await?.unwrap(), "count") != 0 {
            return Err(invalid());
        }
    }
    Ok(())
}
