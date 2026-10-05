use crate::{
    auth::{clean, current},
    db::*,
    domain,
    error::{ApiError, Result},
    inventory::{self, insert_line, item},
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use sea_orm::TransactionTrait;
use serde::Deserialize;
use serde_json::{Value, json};

pub async fn list(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    if actor.role != "admin" && !actor.can_count {
        return Err(ApiError::forbidden());
    }
    let rows = all(
        &s.db,
        "SELECT * FROM stocktakes ORDER BY created_at DESC LIMIT 50",
        vec![],
    )
    .await?;
    let mut result = vec![];
    for r in rows {
        let sid = text(&r, "id");
        let lines=all(&s.db,"SELECT sl.*,i.name,i.code,i.unit,i.precision FROM stocktake_lines sl JOIN items i ON sl.item_id=i.id WHERE sl.stocktake_id=? ORDER BY i.name",vec![sid.clone().into()]).await?;
        result.push(json!({"id":sid,"status":text(&r,"status"),"note":text(&r,"note"),"created_at":int(&r,"created_at"),"lines":lines.iter().map(|l|json!({"item_id":text(l,"item_id"),"name":text(l,"name"),"code":text(l,"code"),"unit":text(l,"unit"),"precision":int(l,"precision"),"expected":int(l,"expected"),"actual":int(l,"actual")})).collect::<Vec<_>>()}));
    }
    Ok(Json(json!({"items":result})))
}
#[derive(Deserialize)]
pub struct Start {
    item_ids: Vec<String>,
}
pub async fn start(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Start>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    if input.item_ids.is_empty() || input.item_ids.len() > 100 {
        return Err(ApiError::bad("每次清点请选择 1–100 件物料。"));
    }
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    let sid = id();
    execute(
        &txn,
        "INSERT INTO stocktakes VALUES (?,?,?,?,?)",
        vec![
            sid.clone().into(),
            actor.id.clone().into(),
            "open".into(),
            "".into(),
            now().into(),
        ],
    )
    .await?;
    let mut seen = std::collections::HashSet::new();
    for iid in input.item_ids {
        if !seen.insert(iid.clone()) {
            continue;
        }
        inventory::ensure_not_counting(&txn, &iid).await?;
        let row = one(
            &txn,
            "SELECT * FROM items WHERE id=? AND active=1",
            vec![iid.clone().into()],
        )
        .await?
        .ok_or_else(ApiError::missing)?;
        execute(
            &txn,
            "INSERT INTO stocktake_lines VALUES (?,?,?,?,?)",
            vec![
                id().into(),
                sid.clone().into(),
                iid.into(),
                int(&row, "balance").into(),
                (-1i64).into(),
            ],
        )
        .await?;
    }
    audit(&txn, &actor, "开始清点", &sid, json!({"count":seen.len()})).await?;
    txn.commit().await?;
    Ok(Json(json!({"id":sid})))
}
#[derive(Deserialize)]
pub struct Counts {
    lines: Vec<inventory::MovementLine>,
}
pub async fn count(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<String>,
    Json(input): Json<Counts>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    if actor.role != "admin" && (!actor.can_count || actor.role == "viewer") {
        return Err(ApiError::forbidden());
    }
    if input.lines.is_empty() || input.lines.len() > 100 {
        return Err(ApiError::bad("请选择需要填写的物料。"));
    }
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    if one(
        &txn,
        "SELECT id FROM stocktakes WHERE id=? AND status='open'",
        vec![sid.clone().into()],
    )
    .await?
    .is_none()
    {
        return Err(ApiError::conflict("该清点已经结束，请刷新。"));
    }
    for l in input.lines {
        let row=one(&txn,"SELECT i.precision FROM items i JOIN stocktake_lines sl ON sl.item_id=i.id WHERE sl.stocktake_id=? AND i.id=?",vec![sid.clone().into(),l.item_id.clone().into()]).await?.ok_or_else(ApiError::missing)?;
        let qty = domain::quantity(&l.quantity, int(&row, "precision"), true)?;
        execute(
            &txn,
            "UPDATE stocktake_lines SET actual=? WHERE stocktake_id=? AND item_id=?",
            vec![qty.into(), sid.clone().into(), l.item_id.into()],
        )
        .await?;
    }
    audit(&txn, &actor, "填写清点数量", &sid, json!({})).await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct Finish {
    confirm: bool,
    #[serde(default)]
    reason: String,
}
pub async fn finish(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(sid): Path<String>,
    Json(input): Json<Finish>,
) -> Result<Json<Value>> {
    let actor = current(&s, &headers).await?;
    actor.admin()?;
    let _lock = s.writes.lock().await;
    let txn = s.db.begin().await?;
    if one(
        &txn,
        "SELECT id FROM stocktakes WHERE id=? AND status='open'",
        vec![sid.clone().into()],
    )
    .await?
    .is_none()
    {
        return Err(ApiError::conflict("该清点已经结束。"));
    }
    let mut did = String::new();
    if input.confirm {
        let lines = all(
            &txn,
            "SELECT * FROM stocktake_lines WHERE stocktake_id=?",
            vec![sid.clone().into()],
        )
        .await?;
        if lines.iter().any(|l| int(l, "actual") < 0) {
            return Err(ApiError::bad("还有物料未填写实盘数量，没有库存请填 0。"));
        }
        let has_difference = lines.iter().any(|l| int(l, "actual") != int(l, "expected"));
        let reason = clean(&input.reason, "差异原因", 500, has_difference)?;
        did = id();
        execute(
            &txn,
            "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)",
            vec![
                did.clone().into(),
                format!("PD-{}", &did[..12]).into(),
                "adjustment".into(),
                actor.id.clone().into(),
                actor.name.clone().into(),
                "".into(),
                reason.into(),
                "posted".into(),
                sid.clone().into(),
                now().into(),
            ],
        )
        .await?;
        for l in lines {
            let iid = text(&l, "item_id");
            let actual = int(&l, "actual");
            let material = item(
                &one(
                    &txn,
                    "SELECT * FROM items WHERE id=?",
                    vec![iid.clone().into()],
                )
                .await?
                .ok_or_else(ApiError::missing)?,
            );
            if material.balance != int(&l, "expected") {
                return Err(ApiError::conflict(
                    "清点期间库存异常变化，请取消并重新清点。",
                ));
            }
            let delta = actual - material.balance;
            execute(
                &txn,
                "UPDATE items SET balance=?,version=version+1 WHERE id=?",
                vec![actual.into(), iid.into()],
            )
            .await?;
            insert_line(&txn, &did, &material, delta.abs(), delta, actual).await?;
        }
    }
    execute(
        &txn,
        "UPDATE stocktakes SET status=?,note=? WHERE id=?",
        vec![
            if input.confirm {
                "completed"
            } else {
                "cancelled"
            }
            .into(),
            input.reason.clone().into(),
            sid.clone().into(),
        ],
    )
    .await?;
    audit(
        &txn,
        &actor,
        if input.confirm {
            "确认清点"
        } else {
            "取消清点"
        },
        &sid,
        json!({"document_id":did,"reason":input.reason}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true,"document_id":did})))
}
