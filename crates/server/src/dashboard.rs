//! Read-only workbench summaries use the same balances and scopes as the ledgers.
use crate::{
    auth::{clean, current},
    db::*,
    error::{ApiError, Result},
    inventory, sales,
    state::AppState,
};
use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
};
use chrono::{Datelike, Days, Local, NaiveDate, TimeZone};
use sea_orm::TransactionTrait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Deserialize)]
pub struct Filter {
    type_id: Option<String>,
}

fn midnight(day: NaiveDate) -> Result<i64> {
    Local
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .map(|time| time.timestamp_millis())
        .ok_or_else(|| ApiError::bad("库存主机日期或时区无效，请检查系统时间。"))
}

pub async fn overview(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    let clock = Local::now();
    let today = clock.date_naive();
    let month_start = today.with_day(1).unwrap();
    let previous_end = month_start.pred_opt().unwrap();
    let previous_start = previous_end.with_day(1).unwrap();
    let previous_to = previous_end
        .with_day(today.day().min(previous_end.day()))
        .unwrap();
    let chart_start = today.checked_sub_days(Days::new(29)).unwrap();
    let day_start = midnight(today)?;
    let day_end = midnight(today.succ_opt().unwrap())?;
    let month_time = midnight(month_start)?;
    let today_text = today.to_string();
    let type_id = clean(
        filter.type_id.as_deref().unwrap_or(""),
        "单据类型",
        100,
        false,
    )?;
    let txn = s.db.begin().await?;
    let mut result = json!({
        "today": today_text,
        "month_start": month_start.to_string(),
        "previous_start": previous_start.to_string(),
        "previous_to": previous_to.to_string(),
        "time_zone": clock.format("%:z").to_string(),
    });
    if actor.can("items.read") {
        let row = one(&txn, "SELECT COUNT(*) AS total,COUNT(CASE WHEN balance>0 THEN 1 END) AS stocked,COUNT(CASE WHEN minimum>=0 AND balance<=minimum THEN 1 END) AS low,COUNT(CASE WHEN balance=0 THEN 1 END) AS zero FROM items WHERE active=1", vec![]).await?.unwrap();
        result["inventory"] = json!({"total":int(&row,"total"),"stocked":int(&row,"stocked"),"low":int(&row,"low"),"zero":int(&row,"zero")});
        if actor.can("stocktake.read") {
            // Count each active material once, using confirmation time, never creation time.
            let row = one(&txn, "SELECT COUNT(DISTINCT l.item_id) AS counted,COUNT(DISTINCT CASE WHEN l.delta<>0 THEN l.item_id END) AS differences FROM documents d JOIN stocktakes st ON st.id=d.reference_id JOIN document_lines l ON l.document_id=d.id JOIN items i ON i.id=l.item_id WHERE d.kind='adjustment' AND d.status='posted' AND st.status='completed' AND i.active=1 AND d.created_at>=? AND d.created_at<?", vec![month_time.into(),day_end.into()]).await?.unwrap();
            result["stocktake"] =
                json!({"counted":int(&row,"counted"),"differences":int(&row,"differences")});
        }
    }
    if actor.can("records.read") {
        let (scope, mut values) =
            inventory::document_filter(&inventory::Filter::default(), &actor)?;
        values.extend([day_start.into(), day_end.into()]);
        let row = one(&txn, &format!("SELECT COUNT(*) AS total FROM documents d WHERE {scope} AND d.created_at>=? AND d.created_at<?"), values).await?.unwrap();
        result["records"] = json!({"total":int(&row,"total"),"all":actor.can("records.all")});
    }
    if actor.can("finance.read") {
        let rows = all(&txn, "SELECT data FROM sales WHERE status='posted' AND json_extract(data,'$.billable')=1 AND json_extract(data,'$.business_date')<=? ORDER BY created_at DESC,id", vec![today_text.clone().into()]).await?;
        let (mut amount, mut paid, mut comparison) = (0i64, 0i64, 0i64);
        let mut performance: BTreeMap<(String, String), Value> = BTreeMap::new();
        let (mut aged_count, mut aged_debt) = (0i64, 0i64);
        let aged_before = today.checked_sub_days(Days::new(60)).unwrap().to_string();
        let mut daily: BTreeMap<String, i64> = (0..30)
            .map(|i| {
                (
                    chart_start
                        .checked_add_days(Days::new(i))
                        .unwrap()
                        .to_string(),
                    0,
                )
            })
            .collect();
        for row in rows {
            let sale: sales::Sale = serde_json::from_str(&text(&row, "data"))
                .map_err(|_| ApiError::bad("读取单据失败。"))?;
            let (due, received) = sales::balances(&txn, &sale).await?;
            if sale.business_date >= month_start.to_string() {
                amount += due;
                paid += received;
                let group = performance.entry((sale.department_id.clone(),sale.salesperson_id.clone())).or_insert_with(|| json!({"department":sale.department_name,"salesperson":sale.salesperson_name,"due":0}));
                group["due"] = json!(group["due"].as_i64().unwrap() + due);
            }
            if sale.business_date >= previous_start.to_string()
                && sale.business_date <= previous_to.to_string()
            {
                comparison += due;
            }
            if sale.business_date < aged_before && due > received {
                aged_count += 1;
                aged_debt += due - received;
            }
            if let Some(value) = daily.get_mut(&sale.business_date) {
                *value += due;
            }
        }
        let mut performance: Vec<_> = performance.into_values().collect();
        performance.sort_by_key(|row| std::cmp::Reverse(row["due"].as_i64().unwrap()));
        let performance_total = performance.len();
        performance.truncate(5);
        result["performance"] = json!({"items":performance,"total":performance_total});
        result["aged_debt"] = json!({"count":aged_count,"debt":aged_debt});
        result["finance"] = json!({"due":amount,"paid":paid,"debt":amount-paid,"comparison_due":comparison,"daily":daily.into_iter().map(|(date,due)|json!({"date":date,"due":due})).collect::<Vec<_>>()});
    }
    if actor.can("sales.read") {
        let filter = sales::Filter {
            q: None,
            customer_id: None,
            status: None,
            page: None,
            from: Some(today_text.clone()),
            to: Some(today_text),
        };
        let (scope, values, _) = sales::list_filter(&filter, &actor)?;
        let rows = all(
            &txn,
            &format!("SELECT data FROM sales WHERE {scope} ORDER BY created_at DESC,id"),
            values,
        )
        .await?;
        let mut types: BTreeMap<String, Value> = BTreeMap::new();
        let mut items = Vec::new();
        let mut total = 0;
        let (mut today_due, mut today_paid, mut posted) = (0i64, 0i64, 0i64);
        let all_count = rows.len();
        for row in rows {
            let sale: sales::Sale = serde_json::from_str(&text(&row, "data"))
                .map_err(|_| ApiError::bad("读取单据失败。"))?;
            let group = types
                .entry(sale.type_id.clone())
                .or_insert_with(|| json!({"id":sale.type_id,"name":sale.type_name,"count":0}));
            group["count"] = json!(group["count"].as_i64().unwrap() + 1);
            if !type_id.is_empty() && sale.type_id != type_id {
                continue;
            }
            total += 1;
            let (due, paid) = sales::balances(&txn, &sale).await?;
            today_due += due;
            today_paid += paid;
            if sale.status == "posted" {
                posted += 1;
            }
            if items.len() < 6 {
                items.push(json!({"id":sale.id,"number":sale.number,"type_name":sale.type_name,"customer":sale.customer["name"],"actor_name":sale.actor_name,"department_name":sale.department_name,"salesperson_name":sale.salesperson_name,"status":sale.status,"billable":sale.billable,"due":due,"paid":paid,"debt":due-paid}));
            }
        }
        result["sales"] = json!({"items":items,"total":total,"all_count":all_count,"due":today_due,"paid":today_paid,"debt":today_due-today_paid,"posted":posted,"types":types.into_values().collect::<Vec<_>>(),"all":actor.can("sales.all")});
    }
    Ok(Json(result))
}
