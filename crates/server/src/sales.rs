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
use chrono::{Datelike, Local, NaiveDate};
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
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
fn catalog_reference_sources() -> String {
    let mut sources = Vec::new();
    for (table, sale_id, prefixes) in [
        ("sales", "id", &["$."][..]),
        ("sales_revisions", "sale_id", &["$.before.", "$.after."][..]),
    ] {
        let fields = prefixes
            .iter()
            .flat_map(|prefix| {
                [
                    "type_id",
                    "customer_id",
                    "department_id",
                    "salesperson_id",
                    "initial_payment.account_id",
                ]
                .iter()
                .map(move |field| format!("json_extract(source.data,'{prefix}{field}')"))
            })
            .collect::<Vec<_>>()
            .join(",");
        sources.push(format!("SELECT source.{sale_id} AS sale_id,ref.value AS ref FROM {table} source,json_each(json_array({fields})) ref"));
    }
    sources.push("SELECT sale_id,account_id AS ref FROM sales_cash".into());
    sources.join(" UNION ALL ")
}
async fn catalog_references(db: &impl ConnectionTrait) -> Result<HashMap<String, i64>> {
    let rows=all(db,&format!("SELECT ref,COUNT(DISTINCT sale_id) AS total FROM ({}) WHERE ref IS NOT NULL AND ref<>'' GROUP BY ref",catalog_reference_sources()),vec![]).await?;
    Ok(rows
        .iter()
        .map(|r| (text(r, "ref"), int(r, "total")))
        .collect())
}

#[derive(Deserialize)]
pub struct CatalogFilter {
    options: Option<bool>,
    q: Option<String>,
    kind: Option<String>,
}
pub async fn catalog(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<CatalogFilter>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索", 100, false)?.to_lowercase();
    let rows = all(
        &s.db,
        "SELECT * FROM sales_catalog ORDER BY kind,COALESCE(json_extract(data,'$.sort'),0),name",
        vec![],
    )
    .await?;
    let lightweight = filter.options.unwrap_or(false);
    let references = if lightweight {
        HashMap::new()
    } else {
        catalog_references(&s.db).await?
    };
    let mut members_by_department = HashMap::<String, usize>::new();
    for row in &rows {
        if text(row, "kind") == "salesperson" {
            let data = parsed(&text(row, "data"))?;
            if let Some(department) = data["department_id"].as_str() {
                *members_by_department
                    .entry(department.to_owned())
                    .or_default() += 1;
            }
        }
    }
    let mut items = vec![];
    for r in &rows {
        let permission = match text(&r, "kind").as_str() {
            "account" => "accounts.read",
            "customer" => "customers.read",
            _ => "catalog.read",
        };
        if actor.can(permission) {
            let mut value = catalog_json(r)?;
            if filter
                .kind
                .as_ref()
                .is_some_and(|kind| kind != &text(r, "kind"))
                || (!q.is_empty()
                    && ![
                        value["name"].as_str(),
                        value["data"]["contact"].as_str(),
                        value["data"]["phone"].as_str(),
                    ]
                    .into_iter()
                    .flatten()
                    .any(|v| v.to_lowercase().contains(&q)))
            {
                continue;
            }
            let used = references.get(&text(r, "id")).copied().unwrap_or(0);
            let members = members_by_department
                .get(&text(r, "id"))
                .copied()
                .unwrap_or(0);
            value["can_delete"] =
                json!(!lightweight && text(r, "kind") != "company" && used == 0 && members == 0);
            value["usage_count"] =
                if !lightweight && (actor.can("sales.all") || actor.can("finance.read")) {
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
    let total = items.len();
    if filter.q.is_some() {
        items.truncate(50);
    }
    Ok(Json(json!({"items":items,"total":total})))
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
    let txn = s.db.begin().await?;
    let result = save_catalog_record(&txn, &actor, input).await?;
    txn.commit().await?;
    Ok(Json(result))
}
pub(crate) async fn save_catalog_record(
    txn: &impl ConnectionTrait,
    actor: &User,
    input: CatalogInput,
) -> Result<Value> {
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
    let eid = if input.kind == "company" {
        "company".into()
    } else if input.id.is_empty() {
        id()
    } else {
        input.id.clone()
    };
    let previous = one(
        txn,
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
    if input.kind == "department" && input.data.get("contact").is_none() {
        if let Some(old) = &previous {
            data["contact"] = parsed(&text(old, "data"))?["contact"].clone();
        }
    }
    if input.kind == "account" {
        let old_data = previous
            .as_ref()
            .map(|r| parsed(&text(r, "data")))
            .transpose()?
            .unwrap_or_else(|| json!({}));
        let account_type = match input.data.get("account_type") {
            Some(value) => value
                .as_str()
                .ok_or_else(|| ApiError::bad("账户类型请填写文字。"))?,
            None => old_data["account_type"].as_str().unwrap_or(""),
        };
        data["account_type"] = json!(clean(account_type, "账户类型", 30, false)?);
    }
    if input.kind == "salesperson" {
        let department_id = input.data["department_id"].as_str().unwrap_or("");
        let unchanged = previous.as_ref().is_some_and(|r| {
            parsed(&text(r, "data"))
                .ok()
                .is_some_and(|v| v["department_id"] == department_id)
        });
        if !unchanged {
            entry(txn, department_id, "department").await?;
        }
        data["department_id"] = json!(department_id);
    }
    let duplicate = all(
        txn,
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
    execute(txn,"INSERT INTO sales_catalog VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active,version=excluded.version,data=excluded.data",vec![eid.clone().into(),input.kind.clone().into(),name.into(),(input.active as i64).into(),version.into(),data.to_string().into()]).await?;
    audit(
        txn,
        actor,
        "修改销售配置",
        &eid,
        json!({"before":previous.as_ref().map(catalog_json).transpose()?,"input":input}),
    )
    .await?;
    let result = catalog_json(
        &one(
            txn,
            "SELECT * FROM sales_catalog WHERE id=?",
            vec![eid.into()],
        )
        .await?
        .unwrap(),
    )?;
    Ok(result)
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
    let discount_changed = old.map_or(rate != 10000 || rounding != 0, |sale| {
        rate != sale.discount_rate || rounding != sale.rounding
    });
    if discount_changed && !actor.can("sales.discount") {
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
            kind: previous.map_or(Some(text(&row, "kind")), |l| l.kind.clone()),
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
fn accumulate_return(map: &mut HashMap<String, Returned>, record: ReturnRecord) {
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
        accumulate_return(&mut map, record);
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
    // Deletion needs existence only. Stop at the first historical reference;
    // never build every customer's usage map while holding the write lock.
    let used = one(
        &txn,
        &format!(
            "SELECT 1 FROM ({}) WHERE ref=? LIMIT 1",
            catalog_reference_sources()
        ),
        vec![eid.clone().into()],
    )
    .await?
    .is_some();
    let members = one(&txn, "SELECT id FROM sales_catalog WHERE kind='salesperson' AND json_extract(data,'$.department_id')=? LIMIT 1", vec![eid.clone().into()]).await?.is_some();
    if used || members {
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
    pub status: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}
// Counts use the search/date scope before applying the selected status.
pub(crate) fn list_filter(
    filter: &Filter,
    actor: &User,
) -> Result<(String, Vec<sea_orm::Value>, String)> {
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索", 100, false)?;
    let customer = filter.customer_id.clone().unwrap_or_default();
    let status = filter.status.clone().unwrap_or_default();
    if !["", "draft", "posted", "voided"].contains(&status.as_str()) {
        return Err(ApiError::bad("单据状态筛选无效。"));
    }
    let from = filter
        .from
        .clone()
        .filter(|v| !v.is_empty())
        .map(|v| date(&v))
        .transpose()?
        .unwrap_or_default();
    let to = filter
        .to
        .clone()
        .filter(|v| !v.is_empty())
        .map(|v| date(&v))
        .transpose()?
        .unwrap_or_default();
    if !from.is_empty() && !to.is_empty() && from > to {
        return Err(ApiError::bad("开始日期不能晚于结束日期。"));
    }
    let mut clauses = vec!["1=1"];
    let mut values: Vec<sea_orm::Value> = vec![];
    if !actor.can("sales.all") {
        clauses.push("actor_id=?");
        values.push(actor.id.clone().into());
    }
    if !customer.is_empty() {
        clauses.push("customer_id=?");
        values.push(customer.into());
    }
    if !q.is_empty() {
        clauses.push("instr(data,?)>0");
        values.push(q.into());
    }
    if !from.is_empty() {
        clauses.push("json_extract(data,'$.business_date')>=?");
        values.push(from.into());
    }
    if !to.is_empty() {
        clauses.push("json_extract(data,'$.business_date')<=?");
        values.push(to.into());
    }
    Ok((clauses.join(" AND "), values, status))
}
pub(crate) async fn balances(db: &impl ConnectionTrait, sale: &Sale) -> Result<(i64, i64)> {
    Ok((
        due(sale, &returned(db, &sale.id).await?),
        paid(db, &sale.id).await?,
    ))
}
// This projection reads immutable document snapshots and signed cash/return rows.
// It is shared by finance and the workbench, within each caller's read transaction.
pub(crate) const LEDGER_CTE: &str = r#"WITH
cash_totals AS MATERIALIZED (SELECT sale_id,SUM(amount) AS paid FROM sales_cash GROUP BY sale_id),
return_totals AS MATERIALIZED (SELECT r.sale_id,SUM(json_extract(l.value,'$.credit')) AS credit FROM sales_returns r,json_each(r.data,'$.lines') l GROUP BY r.sale_id),
ledger AS MATERIALIZED (
 SELECT s.id,s.customer_id,json_extract(s.data,'$.customer.name') AS customer_name,
 json_extract(s.data,'$.business_date') AS business_date,json_extract(s.data,'$.billable') AS billable,
 COALESCE(json_extract(s.data,'$.department_id'),'') AS department_id,
 COALESCE(json_extract(s.data,'$.department_name'),'') AS department_name,
 COALESCE(json_extract(s.data,'$.salesperson_id'),'') AS salesperson_id,
 COALESCE(json_extract(s.data,'$.salesperson_name'),'') AS salesperson_name,
 json_extract(s.data,'$.total')-COALESCE(r.credit,0) AS due,COALESCE(c.paid,0) AS paid
 FROM sales s INDEXED BY sales_reporting
 LEFT JOIN return_totals r ON r.sale_id=s.id LEFT JOIN cash_totals c ON c.sale_id=s.id
 WHERE s.status='posted'
) "#;

pub async fn list(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    let txn = s.db.begin().await?;
    sales_access(&actor)?;
    let page = filter.page.unwrap_or(1).clamp(1, 1000000);
    let (base, mut values, status) = list_filter(&filter, &actor)?;
    let counts = one(&txn, &format!("SELECT COUNT(*) AS total,COUNT(CASE WHEN status='draft' THEN 1 END) AS draft,COUNT(CASE WHEN status='posted' THEN 1 END) AS posted,COUNT(CASE WHEN status='voided' THEN 1 END) AS voided FROM sales WHERE {base}"),values.clone()).await?.unwrap();
    let total = int(&counts, if status.is_empty() { "total" } else { &status });
    let mut scope = base;
    if !status.is_empty() {
        scope.push_str(" AND status=?");
        values.push(status.into());
    }
    values.push(((page - 1) * 50).into());
    let rows=all(&txn,&format!("SELECT s.data FROM (SELECT id,created_at FROM sales WHERE {scope} ORDER BY created_at DESC,id LIMIT 50 OFFSET ?) page JOIN sales s ON s.id=page.id ORDER BY page.created_at DESC,page.id"), values).await?;
    let mut items = vec![];
    for row in rows {
        let sale: Sale = serde_json::from_str(&text(&row, "data"))
            .map_err(|_| ApiError::bad("读取单据失败。"))?;
        let (amount, received) = balances(&txn, &sale).await?;
        let mut v = serde_json::to_value(&sale).unwrap();
        v["due"] = json!(amount);
        v["paid"] = json!(received);
        v["debt"] = json!(amount - received);
        items.push(v);
    }
    Ok(Json(
        json!({"items":items,"page":page,"total":total,"counts":{"all":int(&counts,"total"),"draft":int(&counts,"draft"),"posted":int(&counts,"posted"),"voided":int(&counts,"voided")}}),
    ))
}
#[derive(Deserialize)]
pub struct AdjustmentFilter {
    pub q: Option<String>,
    pub action: Option<String>,
    pub page: Option<i64>,
}

/// Project only summary fields; never return unrestricted revision snapshots.
pub async fn adjustments(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<AdjustmentFilter>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    sales_access(&actor)?;
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索", 100, false)?;
    let action = filter.action.unwrap_or_default();
    if !["", "return", "void"].contains(&action.as_str()) {
        return Err(ApiError::bad("请选择有效的退货或作废动作。"));
    }
    let page = filter.page.unwrap_or(1).clamp(1, 1_000_000);
    let txn = s.db.begin().await?;
    let clause = "(?=1 OR s.actor_id=?) AND json_extract(r.data,'$.command.action') IN ('return','void') AND (?='' OR json_extract(r.data,'$.command.action')=?) AND (?='' OR instr(json_extract(r.data,'$.after.number'),?)>0 OR instr(json_extract(r.data,'$.after.customer.name'),?)>0 OR instr(r.reason,?)>0)";
    let mut values: Vec<sea_orm::Value> = vec![
        actor.can("sales.all").into(),
        actor.id.into(),
        action.clone().into(),
        action.into(),
        q.clone().into(),
        q.clone().into(),
        q.clone().into(),
        q.into(),
    ];
    let total = int(&one(&txn, &format!("SELECT COUNT(*) AS total FROM sales_revisions r JOIN sales s ON s.id=r.sale_id WHERE {clause}"), values.clone()).await?.unwrap(), "total");
    values.push(((page - 1) * 50).into());
    let rows = all(&txn, &format!("SELECT r.sale_id,r.version,r.actor_name,r.reason,r.created_at,r.data FROM sales_revisions r JOIN sales s ON s.id=r.sale_id WHERE {clause} ORDER BY r.created_at DESC,r.sale_id,r.version DESC LIMIT 50 OFFSET ?"), values).await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let snapshot = parsed(&text(&row, "data"))?;
        let before = &snapshot["before"];
        let after = &snapshot["after"];
        let amount = |value: &Value, field: &str| {
            value[field]
                .as_i64()
                .ok_or_else(|| ApiError::bad("退货或作废的历史金额不完整。"))
        };
        let due_change = amount(after, "due")? - amount(before, "due")?;
        let refund = amount(before, "paid")? - amount(after, "paid")?;
        items.push(json!({
            "sale_id": text(&row, "sale_id"),
            "version": int(&row, "version"),
            "number": after["number"],
            "customer_name": after["customer"]["name"],
            "action": snapshot["command"]["action"],
            "reason": text(&row, "reason"),
            "actor_name": text(&row, "actor_name"),
            "created_at": int(&row, "created_at"),
            "due_change": due_change,
            "refund": refund,
        }));
    }
    Ok(Json(json!({"items": items, "total": total})))
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

#[derive(Deserialize, Default)]
pub struct CashFilter {
    pub account_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub page: Option<i64>,
}
pub(crate) fn cash_filter(filter: &CashFilter) -> Result<(String, Vec<sea_orm::Value>)> {
    let account = clean(
        filter.account_id.as_deref().unwrap_or(""),
        "收款账户",
        100,
        false,
    )?;
    let from = filter
        .from
        .as_deref()
        .filter(|v| !v.is_empty())
        .map(date)
        .transpose()?
        .unwrap_or_default();
    let to = filter
        .to
        .as_deref()
        .filter(|v| !v.is_empty())
        .map(date)
        .transpose()?
        .unwrap_or_default();
    if !from.is_empty() && !to.is_empty() && from > to {
        return Err(ApiError::bad("开始日期不能晚于结束日期。"));
    }
    let mut clauses = vec!["1=1"];
    let mut values = vec![];
    if !account.is_empty() {
        clauses.push("c.account_id=?");
        values.push(account.into());
    }
    if !from.is_empty() {
        clauses.push("c.business_date>=?");
        values.push(from.into());
    }
    if !to.is_empty() {
        clauses.push("c.business_date<=?");
        values.push(to.into());
    }
    Ok((clauses.join(" AND "), values))
}
pub(crate) async fn cash_entries(
    db: &impl ConnectionTrait,
    filter: &CashFilter,
    limit: Option<i64>,
) -> Result<Vec<Value>> {
    let (scope, mut values) = cash_filter(filter)?;
    let mut sql = format!(
        "SELECT c.*,json_extract(s.data,'$.number') AS number FROM sales_cash c JOIN sales s ON s.id=c.sale_id WHERE {scope} ORDER BY c.created_at DESC,c.id"
    );
    if let Some(limit) = limit {
        sql.push_str(" LIMIT ? OFFSET ?");
        values.extend([
            limit.into(),
            ((filter.page.unwrap_or(1).clamp(1, 1_000_000) - 1) * limit).into(),
        ]);
    }
    Ok(all(db,&sql,values).await?.iter().map(|r|json!({"id":text(r,"id"),"sale_id":text(r,"sale_id"),"number":text(r,"number"),"account_id":text(r,"account_id"),"account_name":text(r,"account_name"),"amount":int(r,"amount"),"actor_name":text(r,"actor_name"),"business_date":text(r,"business_date"),"note":text(r,"note"),"reversal_of":text(r,"reversal_of")})).collect())
}
async fn cash_accounts(
    db: &impl ConnectionTrait,
    filter: &CashFilter,
) -> Result<(Vec<Value>, i64)> {
    let (scope, values) = cash_filter(filter)?;
    let mut accounts = HashMap::<String, Value>::new();
    let account = filter.account_id.as_deref().unwrap_or("");
    for row in all(
        db,
        "SELECT id,name,active,data FROM sales_catalog WHERE kind='account' AND (?='' OR id=?)",
        vec![account.into(), account.into()],
    )
    .await?
    {
        let data = parsed(&text(&row, "data"))?;
        accounts.insert(text(&row,"id"),json!({"id":text(&row,"id"),"name":text(&row,"name"),"active":int(&row,"active")==1,"account_type":data["account_type"].as_str().unwrap_or(""),"received":0,"refunded":0,"net":0}));
    }
    let rows=all(db,&format!("SELECT c.account_id,c.account_name,MAX(c.created_at) AS latest,COUNT(*) AS count,SUM(MAX(c.amount,0)) AS received,SUM(MAX(-c.amount,0)) AS refunded,SUM(c.amount) AS net FROM sales_cash c WHERE {scope} GROUP BY c.account_id"),values).await?;
    let mut total = 0;
    for row in rows {
        let aid = text(&row, "account_id");
        total += int(&row, "count");
        let value = accounts
            .entry(aid.clone())
            .or_insert_with(|| json!({"id":aid,"name":text(&row,"account_name")}));
        for key in ["received", "refunded", "net"] {
            value[key] = json!(int(&row, key));
        }
    }
    let mut accounts: Vec<_> = accounts.into_values().collect();
    accounts.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Ok((accounts, total))
}
pub async fn cash_ledger(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<CashFilter>,
) -> Result<Json<Value>> {
    current(&s, &headers).await?.require("finance.read")?;
    let txn = s.db.begin().await?;
    let requested = json!({"account_id":filter.account_id.as_deref().unwrap_or(""),"from":filter.from.as_deref().unwrap_or(""),"to":filter.to.as_deref().unwrap_or(""),"page":filter.page.unwrap_or(1)});
    let (accounts, total) = cash_accounts(&txn, &filter).await?;
    let page = filter
        .page
        .unwrap_or(1)
        .clamp(1, ((total + 49) / 50).max(1));
    let filter = CashFilter {
        page: Some(page),
        ..filter
    };
    let items = cash_entries(&txn, &filter, Some(50)).await?;
    let net: i64 = accounts.iter().map(|a| a["net"].as_i64().unwrap()).sum();
    Ok(Json(
        json!({"items":items,"accounts":accounts,"total":total,"page":page,"net":net,"requested":requested}),
    ))
}

#[derive(Deserialize)]
pub struct FinanceFilter {
    entries: Option<bool>,
    q: Option<String>,
    performance_period: Option<String>,
}

pub async fn finance(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<FinanceFilter>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    let txn = s.db.begin().await?;
    actor.require("finance.read")?;
    let today = Local::now().date_naive();
    let month = today.with_day(1).unwrap();
    let period = filter.performance_period.as_deref().unwrap_or("all");
    let from = match period {
        "all" => None,
        "month" => Some(month),
        "quarter" => Some(month.with_month((today.month0() / 3) * 3 + 1).unwrap()),
        "year" => Some(month.with_month(1).unwrap()),
        _ => {
            return Err(ApiError::bad(
                "业绩期间无效，请选择本月、本季、本年或全部。",
            ));
        }
    }
    .map(|day| day.to_string());
    let as_of = today;
    let today = today.to_string();
    let month = month.to_string();
    let mut monthly_departments = HashMap::<String, i64>::new();
    let mut monthly_salespeople = HashMap::<String, i64>::new();
    let mut monthly_categories = HashMap::<String, i64>::new();
    let mut category_names = HashMap::<String, String>::new();
    let mut unclassified = 0i64;
    let mut monthly_accounts = HashMap::<String, i64>::new();
    let mut customers: HashMap<String, Value> = HashMap::new();
    let mut performance: HashMap<(String, String), Value> = HashMap::new();
    let mut performance_choices: HashMap<(String, String), Value> = HashMap::new();
    let mut total = 0;
    let mut net_paid = 0;
    let grouped = all(&txn, &format!(r#"{LEDGER_CTE}
SELECT 'customer' AS dimension,customer_id AS id1,'' AS id2,customer_name AS name1,'' AS name2,
 COUNT(*) AS count,SUM(due) AS due,SUM(paid) AS paid,COALESCE(MIN(CASE WHEN due>paid THEN business_date END),'') AS oldest
 FROM ledger GROUP BY customer_id
UNION ALL SELECT 'performance',department_id,salesperson_id,department_name,salesperson_name,COUNT(*),SUM(due),SUM(paid),''
 FROM ledger WHERE billable=1 AND (?='' OR business_date BETWEEN ? AND ?) GROUP BY department_id,salesperson_id
UNION ALL SELECT 'choices',department_id,salesperson_id,department_name,salesperson_name,0,0,0,''
 FROM ledger WHERE billable=1 GROUP BY department_id,salesperson_id
UNION ALL SELECT 'monthly',department_id,salesperson_id,'','',0,SUM(due),0,''
 FROM ledger WHERE billable=1 AND business_date BETWEEN ? AND ? GROUP BY department_id,salesperson_id"#),
 vec![from.clone().unwrap_or_default().into(),from.clone().unwrap_or_default().into(),today.clone().into(),month.clone().into(),today.clone().into()]).await?;
    for row in grouped {
        let id1 = text(&row, "id1");
        let id2 = text(&row, "id2");
        let amount = int(&row, "due");
        let received = int(&row, "paid");
        match text(&row, "dimension").as_str() {
            "customer" => {
                total += amount;
                net_paid += received;
                let oldest = text(&row, "oldest");
                let days = if oldest.is_empty() {
                    None
                } else {
                    Some(
                        as_of
                            .signed_duration_since(
                                NaiveDate::parse_from_str(&oldest, "%Y-%m-%d")
                                    .map_err(|_| ApiError::bad("读取单据业务日期失败。"))?,
                            )
                            .num_days()
                            .max(0),
                    )
                };
                customers.insert(id1.clone(),json!({"id":id1,"name":text(&row,"name1"),"due":amount,"paid":received,"debt":amount-received,"count":int(&row,"count"),"oldest_debt_date":if oldest.is_empty(){None}else{Some(oldest)},"debt_days":days}));
            }
            "performance" => {
                performance.insert((id1.clone(),id2.clone()),json!({"department_id":id1,"department_name":text(&row,"name1"),"salesperson_id":id2,"salesperson_name":text(&row,"name2"),"count":int(&row,"count"),"due":amount,"paid":received,"debt":amount-received}));
            }
            "choices" => {
                performance_choices.insert((id1.clone(),id2.clone()),json!({"department_id":id1,"department_name":text(&row,"name1"),"salesperson_id":id2,"salesperson_name":text(&row,"name2")}));
            }
            "monthly" => {
                *monthly_departments.entry(id1).or_default() += amount;
                *monthly_salespeople.entry(id2).or_default() += amount;
            }
            _ => unreachable!(),
        }
    }
    // Expand only this month's lines; normalize historical category names in Rust.
    let categories=all(&txn,r#"WITH credits AS MATERIALIZED (
 SELECT r.sale_id,json_extract(l.value,'$.item_id') AS item_id,SUM(json_extract(l.value,'$.credit')) AS credit
 FROM sales_returns r,json_each(r.data,'$.lines') l GROUP BY r.sale_id,item_id)
 SELECT json_extract(l.value,'$.kind') AS kind,SUM(json_extract(l.value,'$.allocated')-COALESCE(c.credit,0)) AS amount
 FROM sales s,json_each(s.data,'$.lines') l LEFT JOIN credits c ON c.sale_id=s.id AND c.item_id=json_extract(l.value,'$.item_id')
 WHERE s.status='posted' AND json_extract(s.data,'$.billable')=1 AND json_extract(s.data,'$.business_date') BETWEEN ? AND ?
 GROUP BY json_extract(l.value,'$.kind')"#,vec![month.clone().into(),today.clone().into()]).await?;
    for row in categories {
        let kind: Option<String> = row.try_get("", "kind").map_err(ApiError::from)?;
        if let Some(kind) = kind {
            let key = crate::options::key(&kind);
            category_names.entry(key.clone()).or_insert(kind);
            *monthly_categories.entry(key).or_default() += int(&row, "amount");
        } else {
            unclassified += int(&row, "amount");
        }
    }
    // Include people without sales so they can be selected and shown as zero.
    let catalog_rows = all(
        &txn,
        "SELECT id,kind,name,data FROM sales_catalog WHERE kind IN ('department','salesperson')",
        vec![],
    )
    .await?;
    let names: HashMap<_, _> = catalog_rows
        .iter()
        .map(|r| (text(r, "id"), text(r, "name")))
        .collect();
    for row in &catalog_rows {
        if text(row, "kind") == "salesperson" {
            let id = text(row, "id");
            let data = parsed(&text(row, "data"))?;
            let department = data["department_id"].as_str().unwrap_or("").to_string();
            performance_choices.entry((department.clone(),id.clone())).or_insert_with(||json!({"department_id":department,"department_name":"","salesperson_id":id,"salesperson_name":""}));
        }
    }
    for value in performance_choices.values_mut() {
        for (id_key, name_key) in [
            ("department_id", "department_name"),
            ("salesperson_id", "salesperson_name"),
        ] {
            if let Some(name) = names.get(value[id_key].as_str().unwrap_or("")) {
                value[name_key] = json!(name);
            }
        }
    }
    let q = clean(filter.q.as_deref().unwrap_or(""), "搜索", 100, false)?;
    let cash_filter = CashFilter {
        account_id: Some(q.clone()),
        ..CashFilter::default()
    };
    let (accounts, _) = cash_accounts(&txn, &cash_filter).await?;
    let entries = if filter.entries.unwrap_or(true) {
        cash_entries(&txn, &cash_filter, None).await?
    } else {
        vec![]
    };
    for row in all(&txn,"SELECT c.account_id,SUM(c.amount) AS amount FROM sales_cash c WHERE c.business_date BETWEEN ? AND ? AND (?='' OR c.account_id=?) GROUP BY c.account_id",vec![month.clone().into(),today.clone().into(),q.clone().into(),q.into()]).await? {
        monthly_accounts.insert(text(&row,"account_id"),int(&row,"amount"));
    }
    Ok(Json(
        json!({"period":{"value":period,"from":from,"to":if period=="all" {None} else {Some(&today)}},"monthly":{"from":month,"to":today,"accounts":monthly_accounts,"departments":monthly_departments,"salespeople":monthly_salespeople,"categories":monthly_categories,"category_names":category_names,"unclassified":unclassified},"due":total,"paid":net_paid,"debt":total-net_paid,"performance_choices":performance_choices.into_values().collect::<Vec<_>>(),"performance":performance.into_values().collect::<Vec<_>>(),"customers":customers.into_values().collect::<Vec<_>>(),"accounts":accounts,"entries":entries}),
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
    // SQLite permits NULL in a non-integer primary key; neither NULL nor the
    // empty cursor sentinel may escape the batched validation below.
    if one(
        db,
        "SELECT 1 FROM sales WHERE id IS NULL OR id='' LIMIT 1",
        vec![],
    )
    .await?
    .is_some()
    {
        return Err(invalid());
    }

    let catalog: HashSet<(String, String)> = all(db, "SELECT id,kind FROM sales_catalog", vec![])
        .await?
        .iter()
        .map(|r| (text(r, "id"), text(r, "kind")))
        .collect();
    let mut after = String::new();
    loop {
        let rows = all(
            db,
            "SELECT * FROM sales WHERE id>? ORDER BY id LIMIT 500",
            vec![after.clone().into()],
        )
        .await?;
        if rows.is_empty() {
            break;
        }
        after = text(rows.last().unwrap(), "id");
        let placeholders = vec!["?"; rows.len()].join(",");
        let ids: Vec<sea_orm::Value> = rows.iter().map(|r| text(r, "id").into()).collect();
        let mut batch_returns = HashMap::<String, HashMap<String, Returned>>::new();
        for row in all(
            db,
            &format!("SELECT sale_id,data FROM sales_returns WHERE sale_id IN ({placeholders})"),
            ids.clone(),
        )
        .await?
        {
            let record: ReturnRecord =
                serde_json::from_str(&text(&row, "data")).map_err(|_| invalid())?;
            accumulate_return(
                batch_returns.entry(text(&row, "sale_id")).or_default(),
                record,
            );
        }
        let batch_paid:HashMap<String,i64>=all(db,&format!("SELECT sale_id,SUM(amount) AS paid FROM sales_cash WHERE sale_id IN ({placeholders}) GROUP BY sale_id"),ids).await?.iter().map(|r|(text(r,"sale_id"),int(r,"paid"))).collect();
        for row in rows {
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
                    if !catalog.contains(&(eid.clone(), kind.to_string())) {
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
            let returns = batch_returns.remove(&sale.id).unwrap_or_default();
            for (iid, r) in &returns {
                let l = sale
                    .lines
                    .iter()
                    .find(|l| &l.item_id == iid)
                    .ok_or_else(invalid)?;
                if r.quantity < 0
                    || r.quantity > l.quantity
                    || r.credit < 0
                    || r.credit > l.allocated
                {
                    return Err(invalid());
                }
            }
            let paid = batch_paid.get(&sale.id).copied().unwrap_or(0);
            let due = due(&sale, &returns);
            if due < 0 || paid < 0 || paid > due || (sale.status == "draft" && !returns.is_empty())
            {
                return Err(invalid());
            }
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
