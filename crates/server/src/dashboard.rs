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
        let rows=all(&txn,&format!("{} SELECT business_date,department_id,salesperson_id,department_name,salesperson_name,SUM(due) AS due,SUM(paid) AS paid,SUM(CASE WHEN due>paid THEN 1 ELSE 0 END) AS debt_count,SUM(CASE WHEN due>paid THEN due-paid ELSE 0 END) AS positive_debt FROM ledger WHERE billable=1 AND business_date<=? GROUP BY business_date,department_id,salesperson_id ORDER BY business_date DESC",sales::LEDGER_CTE),vec![today_text.clone().into()]).await?;
        for row in rows {
            let business_date = text(&row, "business_date");
            let due = int(&row, "due");
            let received = int(&row, "paid");
            if business_date >= month_start.to_string() {
                amount += due;
                paid += received;
                let group=performance.entry((text(&row,"department_id"),text(&row,"salesperson_id"))).or_insert_with(||json!({"department":text(&row,"department_name"),"salesperson":text(&row,"salesperson_name"),"due":0}));
                group["due"] = json!(group["due"].as_i64().unwrap() + due);
            }
            if business_date >= previous_start.to_string()
                && business_date <= previous_to.to_string()
            {
                comparison += due;
            }
            if business_date < aged_before {
                aged_count += int(&row, "debt_count");
                aged_debt += int(&row, "positive_debt");
            }
            if let Some(value) = daily.get_mut(&business_date) {
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
        // Counts include every visible state. Only posted documents contribute
        // receivables; signed payments keep the exact existing balances rule.
        let grouped=all(&txn,&format!(r#"WITH selected AS MATERIALIZED (SELECT id,status,data FROM sales WHERE {scope}),
        credits AS (SELECT r.sale_id,SUM(json_extract(l.value,'$.credit')) AS credit FROM sales_returns r JOIN selected s ON s.id=r.sale_id,json_each(r.data,'$.lines') l GROUP BY r.sale_id),
        receipts AS (SELECT c.sale_id,SUM(c.amount) AS paid FROM sales_cash c JOIN selected s ON s.id=c.sale_id GROUP BY c.sale_id)
        SELECT json_extract(s.data,'$.type_id') AS type_id,json_extract(s.data,'$.type_name') AS type_name,COUNT(*) AS total,
        SUM(CASE WHEN s.status='posted' THEN 1 ELSE 0 END) AS posted,
        SUM(CASE WHEN s.status='posted' THEN json_extract(s.data,'$.total')-COALESCE(r.credit,0) ELSE 0 END) AS due,SUM(COALESCE(c.paid,0)) AS paid
        FROM selected s LEFT JOIN credits r ON r.sale_id=s.id LEFT JOIN receipts c ON c.sale_id=s.id GROUP BY json_extract(s.data,'$.type_id')"#),values.clone()).await?;
        let mut types = BTreeMap::<String, Value>::new();
        let (mut all_count, mut total, mut posted, mut today_due, mut today_paid) =
            (0i64, 0i64, 0i64, 0i64, 0i64);
        for row in grouped {
            let tid = text(&row, "type_id");
            let count = int(&row, "total");
            all_count += count;
            types.insert(
                tid.clone(),
                json!({"id":tid,"name":text(&row,"type_name"),"count":count}),
            );
            if type_id.is_empty() || type_id == tid {
                total += count;
                posted += int(&row, "posted");
                today_due += int(&row, "due");
                today_paid += int(&row, "paid");
            }
        }
        let mut detail_scope = scope;
        let mut detail_values = values;
        if !type_id.is_empty() {
            detail_scope.push_str(" AND json_extract(data,'$.type_id')=?");
            detail_values.push(type_id.into());
        }
        let rows = all(
            &txn,
            &format!(
                "SELECT data FROM sales WHERE {detail_scope} ORDER BY created_at DESC,id LIMIT 6"
            ),
            detail_values,
        )
        .await?;
        let mut items = vec![];
        for row in rows {
            let sale: sales::Sale = serde_json::from_str(&text(&row, "data"))
                .map_err(|_| ApiError::bad("读取单据失败。"))?;
            let (due, paid) = sales::balances(&txn, &sale).await?;
            items.push(json!({"id":sale.id,"number":sale.number,"type_name":sale.type_name,"customer":sale.customer["name"],"actor_name":sale.actor_name,"department_name":sale.department_name,"salesperson_name":sale.salesperson_name,"status":sale.status,"billable":sale.billable,"due":due,"paid":paid,"debt":due-paid}));
        }
        result["sales"] = json!({"items":items,"total":total,"all_count":all_count,"due":today_due,"paid":today_paid,"debt":today_due-today_paid,"posted":posted,"types":types.into_values().collect::<Vec<_>>(),"all":actor.can("sales.all")});
    }
    Ok(Json(result))
}
