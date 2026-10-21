//! Archived reports use exactly the same accounting functions as the summary screens.
use crate::{
    auth::current,
    error::{ApiError, Result},
    inventory, sales,
    state::AppState,
    storage::FileStorage,
};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, header},
    response::{IntoResponse, Response},
};
use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Period {
    Day,
    Week,
    Month,
    Quarter,
    Year,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Xlsx,
    Pdf,
}
#[derive(Deserialize)]
pub struct Request {
    pub(crate) period: Period,
    pub(crate) date: String,
    pub(crate) format: Format,
}

impl Period {
    pub(crate) fn bounds(&self, date: &str) -> Result<(String, String)> {
        // Reuse the sales calendar validator and inventory's local-day boundaries.
        let day = sales::business_day(date)?;
        if day != date {
            return Err(ApiError::bad("报告日期请使用 YYYY-MM-DD 格式。"));
        }
        let date = NaiveDate::parse_from_str(&day, "%Y-%m-%d").unwrap();
        let invalid = || ApiError::bad("报告期间超出 YYYY-MM-DD 支持的日期范围。");
        let (from, next) = match self {
            Self::Day => (date, date.checked_add_signed(Duration::days(1))),
            Self::Week => {
                let from = date - Duration::days(date.weekday().num_days_from_monday().into());
                (from, from.checked_add_signed(Duration::days(7)))
            }
            Self::Month | Self::Quarter | Self::Year => {
                let (month, months) = match self {
                    Self::Month => (date.month(), 1),
                    Self::Quarter => ((date.month() - 1) / 3 * 3 + 1, 3),
                    _ => (1, 12),
                };
                let from = NaiveDate::from_ymd_opt(date.year(), month, 1).unwrap();
                (from, from.checked_add_months(chrono::Months::new(months)))
            }
        };
        let to = next.ok_or_else(invalid)? - Duration::days(1);
        let from = from.format("%Y-%m-%d").to_string();
        let to = to.format("%Y-%m-%d").to_string();
        if from.len() != 10 || to.len() != 10 {
            return Err(invalid());
        }
        inventory::period_bound(&from, false)?;
        inventory::period_bound(&to, true)?;
        Ok((from, to))
    }
    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Day => "日报",
            Self::Week => "周报",
            Self::Month => "月报",
            Self::Quarter => "季报",
            Self::Year => "年报",
        }
    }
}

fn string(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().into()
}

/// Presentation only: quantities and prices are formatted, never aggregated here.
fn report_rows(
    title: &str,
    from: &str,
    to: &str,
    stock: &Value,
    sales: &Value,
) -> Vec<Vec<String>> {
    let mut rows = vec![
        vec![title.into()],
        vec!["期间".into(), from.into(), to.into()],
        vec!["物料汇总".into()],
        [
            "物料编码",
            "物料名称",
            "规格",
            "单位",
            "成本价",
            "入库数量",
            "入库金额",
            "出库数量",
            "出库金额",
        ]
        .map(String::from)
        .to_vec(),
    ];
    for material in stock["materials"].as_array().into_iter().flatten() {
        let precision = material["precision"].as_i64().unwrap_or(0);
        rows.push(vec![
            string(material, "code"),
            string(material, "name"),
            string(material, "spec"),
            string(material, "unit"),
            material["cost_price"]
                .as_i64()
                .map(|v| format!("{}.{:04}", v / 10_000, v % 10_000))
                .unwrap_or_else(|| "未定价".into()),
            crate::domain::display(material["in_quantity"].as_i64().unwrap_or(0), precision),
            string(material, "in_value"),
            crate::domain::display(material["out_quantity"].as_i64().unwrap_or(0), precision),
            string(material, "out_value"),
        ]);
    }
    rows.extend([
        vec!["入库总额".into(), string(stock, "in_value")],
        vec!["出库总额".into(), string(stock, "out_value")],
        vec![
            "库存总成本（生成时当前库存）".into(),
            string(stock, "stock_value"),
        ],
        vec![
            "期间未定价物料数".into(),
            stock["unpriced_items"].to_string(),
        ],
        vec![
            "当前库存未定价物料数".into(),
            stock["stock_unpriced"].to_string(),
        ],
        vec!["客户收入".into()],
        vec!["客户名称".into(), "收入".into()],
    ]);
    for customer in sales["customers"].as_array().into_iter().flatten() {
        rows.push(vec![string(customer, "name"), string(customer, "amount")]);
    }
    rows.push(vec!["销售收入合计".into(), string(sales, "total_amount")]);
    rows
}

pub async fn create(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Request>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    Ok(Json(generate(&s, &actor, input).await?.metadata))
}

pub(crate) struct Generated {
    pub metadata: Value,
    pub bytes: Vec<u8>,
    pub filename: String,
    pub summary: String,
}

pub(crate) async fn generate(
    s: &AppState,
    actor: &crate::auth::User,
    input: Request,
) -> Result<Generated> {
    let (from, to) = input.period.bounds(&input.date)?;
    // Serialize with business writes so the two summaries describe the same state.
    let guard = s.writes.lock().await;
    let stock = inventory::documents_summary_data(
        &s,
        &actor,
        &inventory::Filter {
            from: Some(from.clone()),
            to: Some(to.clone()),
            ..Default::default()
        },
    )
    .await?;
    let sales = sales::summary_data(
        &s,
        &actor,
        &sales::Filter {
            from: Some(from.clone()),
            to: Some(to.clone()),
            ..Default::default()
        },
    )
    .await?;
    drop(guard);
    let rows = report_rows(input.period.label(), &from, &to, &stock, &sales);
    let extension = match input.format {
        Format::Xlsx => "xlsx",
        Format::Pdf => "pdf",
    };
    let key = format!(
        "reports/{}/{}/{}-{from}.{extension}",
        &from[..4],
        &from[5..7],
        input.period.label()
    );
    let bytes = tokio::task::spawn_blocking(move || match input.format {
        Format::Xlsx => crate::transfer::excel_bytes(&rows[0], &rows[1..]),
        Format::Pdf => crate::reports_pdf::render(&rows),
    })
    .await
    .map_err(|_| ApiError::bad("报告生成失败，请检查字体或改用 Excel。"))??;
    let size = bytes.len();
    let files = s.files();
    files.put(files.primary, &key, bytes.clone().into()).await?;
    Ok(Generated {
        filename: key.rsplit('/').next().unwrap().into(),
        summary: format!(
            "{} {} 至 {}\n入库总额：{}\n出库总额：{}\n销售合计：{}",
            input.period.label(),
            from,
            to,
            string(&stock, "in_value"),
            string(&stock, "out_value"),
            string(&sales, "total_amount")
        ),
        metadata: json!({"key":key,"size":size,"period_from":from,"period_to":to}),
        bytes,
    })
}

pub(crate) fn validate_name(name: &str) -> Result<()> {
    if name.len() > 100
        || !(name.ends_with(".xlsx") || name.ends_with(".pdf"))
        || name.contains("..")
        || !["日报-", "周报-", "月报-", "季报-", "年报-"]
            .iter()
            .any(|prefix| name.starts_with(prefix))
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "日周月季年报-.".contains(c))
    {
        return Err(ApiError::bad("报告文件名无效。"));
    }
    Ok(())
}
pub(crate) fn validate_key(key: &str) -> Result<()> {
    let parts = key.split('/').collect::<Vec<_>>();
    if parts.len() != 4
        || parts[0] != "reports"
        || parts[1].len() != 4
        || parts[2].len() != 2
        || !parts[1..3]
            .iter()
            .all(|part| part.bytes().all(|c| c.is_ascii_digit()))
        || NaiveDate::parse_from_str(&format!("{}-{}-01", parts[1], parts[2]), "%Y-%m-%d").is_err()
    {
        return Err(ApiError::bad("报告归档路径无效。"));
    }
    validate_name(parts[3])
}

#[derive(Serialize)]
pub(crate) struct ArchivedReport {
    pub name: String,
    pub key: String,
    size: u64,
    created_at: i64,
    #[serde(skip)]
    pub backend: String,
}
pub(crate) async fn archived(files: &FileStorage) -> Result<Vec<ArchivedReport>> {
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut kinds = files.kinds();
    kinds.sort_by_key(|kind| *kind != files.primary);
    for kind in kinds {
        for object in files.list(kind, "reports").await? {
            let key = object.location.to_string();
            if validate_key(&key).is_err() || !seen.insert(key.clone()) {
                continue;
            }
            items.push(ArchivedReport {
                name: key.rsplit('/').next().unwrap().into(),
                key,
                size: object.size,
                created_at: object.last_modified.timestamp_millis(),
                backend: kind.into(),
            });
        }
    }
    items.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.key.cmp(&b.key))
    });
    Ok(items)
}
pub async fn list(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    current(&s, &headers).await?.admin()?;
    Ok(Json(json!({"items":archived(&s.files()).await?})))
}
pub async fn download(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Response> {
    current(&s, &headers).await?.admin()?;
    validate_name(&name)?;
    let files = s.files();
    let report = archived(&files)
        .await?
        .into_iter()
        .find(|item| item.name == name)
        .ok_or_else(ApiError::missing)?;
    let object = files.get(&report.backend, &report.key).await?;
    let size = object.meta.size;
    let mut response = axum::body::Body::from_stream(object.into_stream()).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, size.into());
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static(if name.ends_with(".pdf") {
            "application/pdf"
        } else {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }),
    );
    // RFC 5987: Chinese filenames cannot be inserted literally into HTTP headers.
    let encoded = name
        .as_bytes()
        .iter()
        .map(|b| format!("%{b:02X}"))
        .collect::<String>();
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename*=UTF-8''{encoded}")
            .parse()
            .unwrap(),
    );
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn periods_follow_calendar_and_local_boundaries() {
        for (period, day, from, to) in [
            (Period::Day, "2026-10-21", "2026-10-21", "2026-10-21"),
            (Period::Week, "2026-01-01", "2025-12-29", "2026-01-04"),
            (Period::Month, "2024-02-15", "2024-02-01", "2024-02-29"),
            (Period::Quarter, "2026-12-31", "2026-10-01", "2026-12-31"),
            (Period::Year, "2024-05-01", "2024-01-01", "2024-12-31"),
        ] {
            assert_eq!(period.bounds(day).unwrap(), (from.into(), to.into()));
        }
        for date in ["2026-02-29", "2026-1-01", "2026-10-21T00:00:00Z"] {
            assert!(Period::Day.bounds(date).is_err());
        }
    }
    #[test]
    fn report_paths_reject_traversal_and_header_injection() {
        assert!(validate_key("reports/2026/10/日报-2026-10-21.xlsx").is_ok());
        for name in [
            "../日报-2026-10-21.xlsx",
            "日报-..pdf",
            "日报-\r\n.pdf",
            "日报-\\file.pdf",
            "日报-/file.pdf",
            "日报-file.zip",
        ] {
            assert!(validate_name(name).is_err());
        }
        for key in [
            "reports/2026/13/日报-a.pdf",
            "reports/../10/日报-a.pdf",
            "reports/2026/10/../日报-a.pdf",
        ] {
            assert!(validate_key(key).is_err());
        }
    }
}
