//! Tabular import/export adapters. Confirmed imports call the same inventory rules as forms.
use crate::{
    auth::{clean, current},
    db::*,
    domain,
    error::{ApiError, Result},
    inventory::{self, ItemInput, Movement, MovementLine},
    state::AppState,
};
use axum::{
    Json,
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, header},
    response::{IntoResponse, Response},
};
use calamine::{Reader, Xlsx};
use sea_orm::TransactionTrait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, io::Cursor};

const MAX_ROWS: usize = 100;
const MAX_FILE: usize = 5 * 1024 * 1024;
const ITEM_HEADERS: &[&str] = &[
    "物料编码",
    "物料名称",
    "规格",
    "类型",
    "单位",
    "小数位数",
    "条码",
    "最低库存",
];
const OPENING_HEADERS: &[&str] = &["物料编码", "第一次使用时的库存数量"];

#[derive(Deserialize)]
pub struct Options {
    #[serde(default = "default_format")]
    format: String,
    #[serde(default)]
    q: String,
}
fn default_format() -> String {
    "xlsx".into()
}
#[derive(Serialize, Deserialize)]
pub struct Preview {
    id: String,
    actor_id: String,
    mode: String,
    created_at: i64,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    errors: Vec<String>,
}
struct Table {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
}
fn expected(mode: &str) -> Result<Vec<String>> {
    Ok(match mode {
        "items" => ITEM_HEADERS,
        "opening" => OPENING_HEADERS,
        _ => return Err(ApiError::bad("请选择物料资料或首次库存登记模板。")),
    }
    .iter()
    .map(|s| s.to_string())
    .collect())
}
pub async fn template(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(mode): Path<String>,
    Query(options): Query<Options>,
) -> Result<Response> {
    current(&s, &headers).await?.admin()?;
    render(
        Table {
            headers: expected(&mode)?,
            rows: vec![],
        },
        &options.format,
        &format!("template-{mode}"),
    )
    .await
}

async fn render(table: Table, format: &str, name: &str) -> Result<Response> {
    if !["xlsx", "csv"].contains(&format) {
        return Err(ApiError::bad("请选择 Excel 或 CSV 格式。"));
    }
    let excel = format == "xlsx";
    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
        if excel {
            let mut workbook = rust_xlsxwriter::Workbook::new();
            let sheet = workbook.add_worksheet();
            for (c, v) in table.headers.iter().enumerate() {
                sheet
                    .write_string(0, c as u16, v)
                    .map_err(|_| ApiError::bad("生成表格失败。"))?;
                sheet
                    .set_column_width(c as u16, 20)
                    .map_err(|_| ApiError::bad("生成表格失败。"))?;
            }
            for (r, row) in table.rows.iter().enumerate() {
                for (c, v) in row.iter().enumerate() {
                    sheet
                        .write_string(r as u32 + 1, c as u16, v)
                        .map_err(|_| ApiError::bad("生成表格失败。"))?;
                }
            }
            workbook
                .save_to_buffer()
                .map_err(|_| ApiError::bad("生成表格失败。"))
        } else {
            let mut writer = csv::Writer::from_writer(vec![0xef, 0xbb, 0xbf]);
            writer
                .write_record(&table.headers)
                .map_err(|_| ApiError::bad("生成 CSV 失败。"))?;
            for row in table.rows {
                writer
                    .write_record(row.iter().map(|v| {
                        if v.starts_with(['=', '+', '-', '@', '\t', '\r']) {
                            format!("'{v}")
                        } else {
                            v.clone()
                        }
                    }))
                    .map_err(|_| ApiError::bad("生成 CSV 失败。"))?;
            }
            writer
                .into_inner()
                .map_err(|_| ApiError::bad("生成 CSV 失败。"))
        }
    })
    .await
    .map_err(|_| ApiError::bad("导出任务失败。"))??;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                if excel {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                } else {
                    "text/csv; charset=utf-8"
                }
                .to_string(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{name}.{format}\""),
            ),
        ],
        bytes,
    )
        .into_response())
}
pub async fn export(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(mode): Path<String>,
    Query(options): Query<Options>,
) -> Result<Response> {
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    let txn = s.db.begin().await?;
    let table = match mode.as_str() {
        "items" => {
            let q = clean(&options.q, "搜索", 100, false)?;
            let rows=all(&txn,"SELECT * FROM items WHERE active=1 AND (?='' OR instr(name,?)>0 OR instr(code,?)>0) ORDER BY code",vec![q.clone().into(),q.clone().into(),q.into()]).await?;
            if rows.len() > 50_000 {
                return Err(ApiError::bad("导出超过 50000 行，请缩小筛选范围。"));
            }
            let mut labels = ITEM_HEADERS
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>();
            labels.push("当前库存".into());
            Table {
                headers: labels,
                rows: rows
                    .iter()
                    .map(|r| {
                        let precision = int(r, "precision");
                        vec![
                            text(r, "code"),
                            text(r, "name"),
                            text(r, "spec"),
                            text(r, "kind"),
                            text(r, "unit"),
                            precision.to_string(),
                            text(r, "barcode"),
                            if int(r, "minimum") < 0 {
                                String::new()
                            } else {
                                domain::display(int(r, "minimum"), precision)
                            },
                            domain::display(int(r, "balance"), precision),
                        ]
                    })
                    .collect(),
            }
        }
        "documents" => {
            let rows=all(&txn,"SELECT d.number,d.kind,d.actor_name,d.person,d.status,d.note,d.created_at,l.item_code,l.item_name,l.unit,l.precision,l.delta,l.balance_after FROM documents d JOIN document_lines l ON d.id=l.document_id ORDER BY d.created_at DESC LIMIT 50001",vec![]).await?;
            if rows.len() > 50_000 {
                return Err(ApiError::bad("记录超过 50000 行，请按日期分批导出。"));
            }
            Table {
                headers: [
                    "记录号",
                    "用途",
                    "登记人",
                    "领用人/来源去向",
                    "状态",
                    "时间",
                    "物料编码",
                    "物料名称",
                    "变化数量",
                    "单位",
                    "操作后的库存",
                    "备注",
                ]
                .iter()
                .map(|s| s.to_string())
                .collect(),
                rows: rows
                    .iter()
                    .map(|r| {
                        vec![
                            text(r, "number"),
                            text(r, "kind"),
                            text(r, "actor_name"),
                            text(r, "person"),
                            text(r, "status"),
                            chrono::DateTime::from_timestamp_millis(int(r, "created_at"))
                                .unwrap()
                                .to_rfc3339(),
                            text(r, "item_code"),
                            text(r, "item_name"),
                            format!("{:.3}", int(r, "delta") as f64 / 1000.),
                            text(r, "unit"),
                            domain::display(int(r, "balance_after"), int(r, "precision")),
                            text(r, "note"),
                        ]
                    })
                    .collect(),
            }
        }
        "audit" => {
            let rows = all(
                &txn,
                "SELECT * FROM audit ORDER BY created_at DESC LIMIT 50001",
                vec![],
            )
            .await?;
            if rows.len() > 50_000 {
                return Err(ApiError::bad("操作记录过多，请缩小导出范围。"));
            }
            Table {
                headers: vec![
                    "时间".into(),
                    "操作人".into(),
                    "操作".into(),
                    "关联编号".into(),
                ],
                rows: rows
                    .iter()
                    .map(|r| {
                        vec![
                            chrono::DateTime::from_timestamp_millis(int(r, "created_at"))
                                .unwrap()
                                .to_rfc3339(),
                            text(r, "actor_name"),
                            text(r, "action"),
                            text(r, "object_id"),
                        ]
                    })
                    .collect(),
            }
        }
        _ => return Err(ApiError::bad("不支持此导出类型。")),
    };
    let count = table.rows.len();
    txn.commit().await?;
    let output = render(
        table,
        &options.format,
        &format!("{mode}-{}", chrono::Utc::now().format("%Y%m%d")),
    )
    .await?;
    audit(
        &s.db,
        &actor,
        "导出表格",
        &mode,
        json!({"rows":count,"format":options.format}),
    )
    .await?;
    Ok(output)
}

fn parse_file(name: &str, bytes: Vec<u8>) -> Result<Table> {
    let rows = if name.to_ascii_lowercase().ends_with(".csv") {
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| ApiError::bad("CSV 请保存为 UTF-8 编码。"))?
            .trim_start_matches('\u{feff}');
        csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader(text.as_bytes())
            .records()
            .map(|r| {
                r.map(|v| v.iter().map(|s| s.trim().to_string()).collect::<Vec<_>>())
                    .map_err(|_| ApiError::bad("CSV 列数不一致，请使用模板。"))
            })
            .take(MAX_ROWS + 2)
            .collect::<Result<Vec<_>>>()?
    } else if name.to_ascii_lowercase().ends_with(".xlsx") {
        {
            let mut archive = zip::ZipArchive::new(Cursor::new(&bytes))
                .map_err(|_| ApiError::bad("Excel 文件损坏。"))?;
            let mut size = 0;
            for i in 0..archive.len() {
                size += archive
                    .by_index(i)
                    .map_err(|_| ApiError::bad("Excel 文件损坏。"))?
                    .size();
                if size > 30 * 1024 * 1024 {
                    return Err(ApiError::bad("Excel 解压后过大，请拆分文件。"));
                }
            }
        }
        let mut book: Xlsx<_> = Xlsx::new(Cursor::new(bytes))
            .map_err(|_| ApiError::bad("无法读取 Excel，请使用 .xlsx 模板。"))?;
        let sheet = book
            .sheet_names()
            .first()
            .cloned()
            .ok_or_else(|| ApiError::bad("Excel 没有工作表。"))?;
        if let Ok(formulas) = book.worksheet_formula(&sheet)
            && formulas.cells().any(|(_, _, v)| !v.is_empty())
        {
            return Err(ApiError::bad("导入数据不能包含公式，请复制并粘贴为值。"));
        }
        book.worksheet_range(&sheet)
            .map_err(|_| ApiError::bad("无法读取工作表。"))?
            .rows()
            .take(MAX_ROWS + 2)
            .map(|r| {
                r.iter()
                    .map(|v| v.to_string().trim().to_string())
                    .collect::<Vec<_>>()
            })
            .collect()
    } else {
        return Err(ApiError::bad("只支持 .xlsx 和 UTF-8 CSV，请先下载模板。"));
    };
    let mut rows = rows.into_iter().filter(|r| r.iter().any(|v| !v.is_empty()));
    let headers = rows.next().ok_or_else(|| ApiError::bad("文件为空。"))?;
    let rows = rows.collect::<Vec<_>>();
    if rows.is_empty() || rows.len() > MAX_ROWS {
        return Err(ApiError::bad(
            "每次请导入 1–100 行数据，更多数据请分批导入。",
        ));
    }
    Ok(Table { headers, rows })
}
pub async fn preview(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(mode): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Preview>> {
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    let expected = expected(&mode)?;
    let field = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::bad("无法读取上传文件。"))?
        .ok_or_else(|| ApiError::bad("请选择导入文件。"))?;
    let name = field.file_name().unwrap_or("").to_string();
    let bytes = field
        .bytes()
        .await
        .map_err(|_| ApiError::bad("文件过大或上传中断。"))?;
    if bytes.len() > MAX_FILE {
        return Err(ApiError::bad("文件不能超过 5 MB。"));
    }
    let mut table = tokio::task::spawn_blocking(move || parse_file(&name, bytes.to_vec()))
        .await
        .map_err(|_| ApiError::bad("解析文件失败。"))??;
    if mode == "opening" && table.headers == ["物料编码", "期初数量"] {
        table.headers = OPENING_HEADERS
            .iter()
            .map(|value| (*value).to_owned())
            .collect();
    }
    if table.headers != expected {
        return Err(ApiError::bad(format!(
            "表头与模板不符，需要：{}。",
            expected.join("、")
        )));
    }
    let mut result = Preview {
        id: id(),
        actor_id: actor.id,
        mode,
        created_at: now(),
        headers: table.headers,
        rows: table.rows,
        errors: vec![],
    };
    let mut codes = HashSet::new();
    let mut barcodes = HashSet::new();
    for (index, row) in result.rows.iter().enumerate() {
        let check: Result<()> = async {
            if row.len() != result.headers.len() {
                return Err(ApiError::bad("列数与模板不一致。"));
            }
            let code = clean(&row[0], "物料编码", 64, true)?.to_uppercase();
            if !codes.insert(code.clone()) {
                return Err(ApiError::bad("文件内物料编码重复。"));
            }
            let existing =
                one(&s.db, "SELECT * FROM items WHERE code=?", vec![code.into()]).await?;
            if result.mode == "items" {
                if existing.is_some() {
                    return Err(ApiError::bad("物料编码已存在，请在物料页面修改资料。"));
                }
                let input = row_item(row)?;
                if !input.barcode.is_empty() && !barcodes.insert(input.barcode.clone()) {
                    return Err(ApiError::bad("文件内条码重复。"));
                }
                if !input.barcode.is_empty()
                    && one(
                        &s.db,
                        "SELECT id FROM items WHERE barcode=?",
                        vec![input.barcode.into()],
                    )
                    .await?
                    .is_some()
                {
                    return Err(ApiError::bad("条码已被其他物料使用。"));
                }
            } else {
                let existing =
                    existing.ok_or_else(|| ApiError::bad("没有找到物料，请先导入物料资料。"))?;
                domain::quantity(&row[1], int(&existing, "precision"), true)?;
                if one(
                    &s.db,
                    "SELECT id FROM document_lines WHERE item_id=? LIMIT 1",
                    vec![text(&existing, "id").into()],
                )
                .await?
                .is_some()
                {
                    return Err(ApiError::bad(
                        "该物料已有出入库记录，不能再次导入首次库存数量；请使用清点库存。",
                    ));
                }
            }
            Ok(())
        }
        .await;
        if let Err(e) = check {
            result.errors.push(format!("第 {} 行：{}", index + 2, e.1));
        }
    }
    let dir = s.data_dir.join("imports");
    tokio::fs::create_dir_all(&dir).await?;
    tokio::fs::write(
        dir.join(format!("{}.json", result.id)),
        serde_json::to_vec(&result).unwrap(),
    )
    .await?;
    Ok(Json(result))
}
fn row_item(row: &[String]) -> Result<ItemInput> {
    let precision = row[5]
        .parse::<i64>()
        .map_err(|_| ApiError::bad("小数位数请填 0、1、2 或 3。"))?;
    if !(0..=3).contains(&precision) || !domain::ITEM_KINDS.contains(&row[3].as_str()) {
        return Err(ApiError::bad("类型或小数位数不正确。"));
    }
    if !row[7].is_empty() {
        domain::quantity(&row[7], precision, true)?;
    }
    Ok(ItemInput {
        code: Some(clean(&row[0], "物料编码", 64, true)?),
        name: clean(&row[1], "物料名称", 100, true)?,
        spec: clean(&row[2], "规格", 100, false)?,
        kind: row[3].clone(),
        unit: clean(&row[4], "单位", 16, true)?,
        precision,
        barcode: clean(&row[6], "条码", 128, false)?,
        minimum: Some(row[7].clone()),
        version: None,
    })
}
pub async fn commit(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(job): Path<String>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    if uuid::Uuid::parse_str(&job).is_err() {
        return Err(ApiError::bad("导入任务编号无效。"));
    }
    let bytes = tokio::fs::read(s.data_dir.join("imports").join(format!("{job}.json"))).await?;
    let preview: Preview = serde_json::from_slice(&bytes)
        .map_err(|_| ApiError::bad("导入预览已失效，请重新上传。"))?;
    if preview.actor_id != actor.id {
        return Err(ApiError::forbidden());
    }
    if now() - preview.created_at > 3_600_000 {
        return Err(ApiError::bad("导入预览已超过一小时，请重新上传检查。"));
    }
    if !preview.errors.is_empty() {
        return Err(ApiError::bad("文件仍有错误，请修改后重新上传。"));
    }
    if preview.mode == "opening" {
        let mut lines = vec![];
        for row in &preview.rows {
            let m = one(
                &s.db,
                "SELECT id FROM items WHERE code=? AND active=1",
                vec![row[0].to_uppercase().into()],
            )
            .await?
            .ok_or_else(ApiError::missing)?;
            lines.push(MovementLine {
                item_id: text(&m, "id"),
                quantity: row[1].clone(),
            });
        }
        return Ok(Json(
            inventory::post_movement(
                &s,
                actor,
                Movement {
                    request_id: job,
                    kind: "opening".into(),
                    person: String::new(),
                    note: "首次库存表格导入".into(),
                    reference_id: String::new(),
                    lines,
                },
            )
            .await?,
        ));
    }
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    if let Some(old) = one(
        &txn,
        "SELECT response FROM requests WHERE id=? AND actor_id=?",
        vec![job.clone().into(), actor.id.clone().into()],
    )
    .await?
    {
        return Ok(Json(serde_json::from_str(&text(&old, "response")).unwrap()));
    }
    for row in &preview.rows {
        inventory::create_item_record(&txn, &actor, row_item(row)?).await?;
    }
    let response = json!({"ok":true,"count":preview.rows.len()});
    audit(&txn, &actor, "导入物料", &job, response.clone()).await?;
    execute(
        &txn,
        "INSERT INTO requests VALUES (?,?,?,?,?)",
        vec![
            job.into(),
            actor.id.into(),
            "import-items".into(),
            response.to_string().into(),
            now().into(),
        ],
    )
    .await?;
    txn.commit().await?;
    Ok(Json(response))
}
