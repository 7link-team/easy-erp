use crate::{
    auth::{self, User},
    db::*,
    error::{ApiError, Result},
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde::Deserialize;
use serde_json::{Value, json};

pub const PERMISSIONS: &[(&str, &str, &str)] = &[
    ("items.read", "物料", "查看"),
    ("items.create", "物料", "新增"),
    ("items.update", "物料", "修改"),
    ("items.delete", "物料", "删除/停用"),
    ("movement.in", "收发库存", "入库"),
    ("movement.out", "收发库存", "出库"),
    ("movement.special", "收发库存", "退回/报损/期初登记"),
    ("records.read", "操作记录", "查看本人"),
    ("records.all", "操作记录", "查看所有人"),
    ("records.void", "操作记录", "作废"),
    ("stocktake.read", "库存清点", "查看"),
    ("stocktake.create", "库存清点", "发起"),
    ("stocktake.count", "库存清点", "填写数量"),
    ("stocktake.finish", "库存清点", "确认/取消"),
    ("sales.read", "销售单据", "查看本人"),
    ("sales.all", "销售单据", "查看所有人"),
    ("sales.create", "销售单据", "新建/编辑草稿"),
    ("sales.confirm", "销售单据", "确认出库"),
    ("sales.revise", "销售单据", "修订"),
    ("sales.discount", "销售单据", "优惠/抹零"),
    ("sales.pay", "销售单据", "收款"),
    ("sales.refund", "销售单据", "退款"),
    ("sales.correct", "销售单据", "更正流水"),
    ("sales.return", "销售单据", "退货"),
    ("sales.void", "销售单据", "作废"),
    ("sales.upload", "销售单据", "上传凭证"),
    ("sales.attachment_delete", "销售单据", "移除凭证"),
    ("sales.history", "销售单据", "查看历史"),
    ("customers.read", "客户", "查看"),
    ("customers.create", "客户", "新增"),
    ("customers.update", "客户", "修改/停用"),
    ("catalog.read", "业务基础资料", "查看"),
    ("catalog.create", "业务基础资料", "新增"),
    ("catalog.update", "业务基础资料", "修改/停用"),
    ("options.read", "物料字典", "查看"),
    ("options.create", "物料字典", "新增"),
    ("options.update", "物料字典", "修改"),
    ("options.delete", "物料字典", "删除"),
    ("accounts.read", "资金账户", "查看"),
    ("accounts.create", "资金账户", "新增"),
    ("accounts.update", "资金账户", "修改/停用"),
    ("finance.read", "收款报表", "查看全部欠款/流水/业绩"),
];
pub fn dependencies(permission: &str) -> Vec<String> {
    let mut result = vec![];
    let module = permission.split('.').next().unwrap_or("");
    let read = format!("{module}.read");
    if read != permission && PERMISSIONS.iter().any(|p| p.0 == read) {
        result.push(read);
    }
    let extra: &[&str] = match permission {
        "movement.in" | "movement.out" | "stocktake.create" => &["items.read"],
        "movement.special" => &["items.read", "movement.in", "movement.out"],
        "sales.confirm" => &[
            "sales.create",
            "items.read",
            "customers.read",
            "catalog.read",
        ],
        "sales.create" | "sales.revise" => &["items.read", "customers.read", "catalog.read"],
        "sales.pay" | "sales.refund" | "sales.correct" => &["accounts.read"],
        _ => &[],
    };
    result.extend(extra.iter().map(|v| v.to_string()));
    result
}
pub fn legacy_id(role: &str, inbound: bool, outbound: bool, count: bool) -> String {
    if role == "viewer" {
        "viewer".into()
    } else {
        format!("worker-{}{}{}", inbound as u8, outbound as u8, count as u8)
    }
}
pub fn legacy_permissions(inbound: bool, outbound: bool, count: bool) -> Vec<String> {
    let mut permissions = vec!["items.read", "options.read", "records.read"];
    if inbound {
        permissions.push("movement.in");
    }
    if outbound {
        permissions.extend([
            "movement.out",
            "sales.read",
            "sales.create",
            "sales.confirm",
            "sales.upload",
            "customers.read",
            "customers.create",
            "catalog.read",
        ]);
    }
    if count {
        permissions.extend(["stocktake.read", "stocktake.count"]);
    }
    permissions.into_iter().map(str::to_owned).collect()
}
pub async fn initialize(db: &impl ConnectionTrait) -> Result<()> {
    for flags in 0..9 {
        let viewer = flags == 8;
        let (inbound, outbound, count) = (
            !viewer && flags & 4 != 0,
            !viewer && flags & 2 != 0,
            !viewer && flags & 1 != 0,
        );
        let rid = legacy_id(
            if viewer { "viewer" } else { "worker" },
            inbound,
            outbound,
            count,
        );
        let name = if viewer {
            "查看员".to_string()
        } else if flags == 7 {
            "操作员".to_string()
        } else {
            let actions: Vec<_> = [(inbound, "入库"), (outbound, "出库"), (count, "清点")]
                .into_iter()
                .filter_map(|(yes, label)| yes.then_some(label))
                .collect();
            format!(
                "操作员（{}）",
                if actions.is_empty() {
                    "仅查看".into()
                } else {
                    actions.join("、")
                }
            )
        };
        execute(
            db,
            "INSERT INTO roles (id,name,permissions,version) VALUES (?,?,?,1)",
            vec![
                rid.into(),
                name.into(),
                json!(legacy_permissions(inbound, outbound, count))
                    .to_string()
                    .into(),
            ],
        )
        .await?;
    }
    execute(db,"UPDATE users SET role='worker-' || CAST(can_in AS TEXT) || CAST(can_out AS TEXT) || CAST(can_count AS TEXT) WHERE role='worker'",vec![]).await?;
    Ok(())
}
pub async fn resolve(
    db: &impl ConnectionTrait,
    role: &str,
    inbound: bool,
    outbound: bool,
    count: bool,
) -> Result<String> {
    let rid = if role == "worker" {
        legacy_id(role, inbound, outbound, count)
    } else {
        role.to_string()
    };
    if rid == "admin"
        || one(
            db,
            "SELECT id FROM roles WHERE id=?",
            vec![rid.clone().into()],
        )
        .await?
        .is_none()
    {
        return Err(ApiError::bad("请选择有效角色。"));
    }
    Ok(rid)
}
pub async fn hydrate(db: &impl ConnectionTrait, user: &mut User) -> Result<()> {
    if user.role == "admin" {
        user.role_name = "管理员".into();
        user.permissions = PERMISSIONS.iter().map(|p| p.0.to_string()).collect();
    } else {
        let row = one(
            db,
            "SELECT * FROM roles WHERE id=?",
            vec![user.role.clone().into()],
        )
        .await?
        .ok_or_else(ApiError::forbidden)?;
        user.role_name = text(&row, "name");
        user.permissions =
            serde_json::from_str(&text(&row, "permissions")).map_err(|_| ApiError::forbidden())?;
    }
    user.can_in = user.can("movement.in");
    user.can_out = user.can("movement.out");
    user.can_count = user.can("stocktake.count");
    Ok(())
}
pub async fn list(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    auth::current(&s, &headers).await?.admin()?;
    let mut roles = vec![
        json!({"id":"admin","name":"管理员","protected":true,"permissions":PERMISSIONS.iter().map(|p|p.0).collect::<Vec<_>>(),"version":1}),
    ];
    for r in all(&s.db,"SELECT roles.*, (SELECT COUNT(*) FROM users WHERE users.role=roles.id) AS members FROM roles ORDER BY name",vec![]).await? {
        roles.push(json!({"id":text(&r,"id"),"name":text(&r,"name"),"permissions":serde_json::from_str::<Vec<String>>(&text(&r,"permissions")).map_err(|_|ApiError::bad("角色权限数据无效。"))?,"version":int(&r,"version"),"members":int(&r,"members"),"protected":false}));
    }
    Ok(Json(
        json!({"roles":roles,"permissions":PERMISSIONS.iter().map(|p|json!({"id":p.0,"module":p.1,"label":p.2,"requires":dependencies(p.0)})).collect::<Vec<_>>()}),
    ))
}
#[derive(Deserialize)]
pub struct Input {
    #[serde(default)]
    id: String,
    name: String,
    permissions: Vec<String>,
    #[serde(default)]
    version: i64,
}
pub async fn save(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<Input>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = auth::current(&s, &headers).await?;
    actor.admin()?;
    if input.id == "admin" {
        return Err(ApiError::bad("管理员角色受保护，不能修改。"));
    }
    let name = auth::clean(&input.name, "角色名称", 50, true)?;
    input.permissions.sort();
    input.permissions.dedup();
    if input
        .permissions
        .iter()
        .any(|p| !PERMISSIONS.iter().any(|known| known.0 == p))
    {
        return Err(ApiError::bad("包含未知权限。"));
    }
    for p in &input.permissions {
        if dependencies(p)
            .iter()
            .any(|required| !input.permissions.contains(required))
        {
            return Err(ApiError::bad("请同时勾选操作依赖的查看权限。"));
        }
    }
    let txn = s.db.begin().await?;
    if one(
        &txn,
        "SELECT id FROM roles WHERE name=? AND id<>?",
        vec![name.clone().into(), input.id.clone().into()],
    )
    .await?
    .is_some()
    {
        return Err(ApiError::conflict("角色名称已存在。"));
    }
    let rid = if input.id.is_empty() {
        id()
    } else {
        input.id.clone()
    };
    if input.id.is_empty() {
        execute(
            &txn,
            "INSERT INTO roles VALUES (?,?,?,1)",
            vec![
                rid.clone().into(),
                name.clone().into(),
                json!(input.permissions).to_string().into(),
            ],
        )
        .await?;
    } else {
        let changed = execute(
            &txn,
            "UPDATE roles SET name=?,permissions=?,version=version+1 WHERE id=? AND version=?",
            vec![
                name.clone().into(),
                json!(input.permissions).to_string().into(),
                rid.clone().into(),
                input.version.into(),
            ],
        )
        .await?;
        if changed.rows_affected() != 1 {
            return Err(ApiError::conflict("角色已变更，请刷新后重试。"));
        }
        execute(
            &txn,
            "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role=?)",
            vec![rid.clone().into()],
        )
        .await?;
    }
    audit(
        &txn,
        &actor,
        "维护角色",
        &rid,
        json!({"name":name,"permissions":input.permissions}),
    )
    .await?;
    txn.commit().await?;
    Ok(Json(json!({"id":rid})))
}
pub async fn remove(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(rid): Path<String>,
) -> Result<Json<Value>> {
    let _guard = s.writes.lock().await;
    let actor = auth::current(&s, &headers).await?;
    actor.admin()?;
    if rid == "admin" {
        return Err(ApiError::bad("管理员角色受保护，不能删除。"));
    }
    let txn = s.db.begin().await?;
    if one(
        &txn,
        "SELECT id FROM users WHERE role=? LIMIT 1",
        vec![rid.clone().into()],
    )
    .await?
    .is_some()
    {
        return Err(ApiError::conflict(
            "此角色仍有账号使用，请先为这些账号更换角色。",
        ));
    }
    if execute(
        &txn,
        "DELETE FROM roles WHERE id=?",
        vec![rid.clone().into()],
    )
    .await?
    .rows_affected()
        != 1
    {
        return Err(ApiError::missing());
    }
    audit(&txn, &actor, "删除角色", &rid, json!({})).await?;
    txn.commit().await?;
    Ok(Json(json!({"ok":true})))
}

pub async fn validate_backup(db: &impl ConnectionTrait) -> Result<()> {
    if one(
        db,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='roles'",
        vec![],
    )
    .await?
    .is_none()
    {
        return Ok(());
    }
    if one(
        db,
        "SELECT id FROM users WHERE role<>'admin' AND role NOT IN (SELECT id FROM roles) LIMIT 1",
        vec![],
    )
    .await?
    .is_some()
    {
        return Err(ApiError::bad("备份中的账号关联了不存在的角色。"));
    }
    for row in all(db, "SELECT id,permissions FROM roles", vec![]).await? {
        let permissions: Vec<String> = serde_json::from_str(&text(&row, "permissions"))
            .map_err(|_| ApiError::bad("备份角色权限格式无效。"))?;
        if text(&row, "id") == "admin"
            || permissions
                .iter()
                .any(|p| !PERMISSIONS.iter().any(|known| known.0 == p))
        {
            return Err(ApiError::bad("备份包含无效角色或权限。"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm_migration::MigratorTrait;

    #[tokio::test]
    async fn migration_preserves_every_legacy_permission_combination() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        crate::migration::Migrator::up(&db, Some(4)).await.unwrap();
        for flags in 0..16 {
            execute(
                &db,
                "INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)",
                vec![
                    format!("u{flags}").into(),
                    format!("user{flags}").into(),
                    "旧账号".into(),
                    "unused".into(),
                    if flags < 8 {
                        "worker".into()
                    } else {
                        "viewer".into()
                    },
                    ((flags & 4 != 0) as i64).into(),
                    ((flags & 2 != 0) as i64).into(),
                    ((flags & 1 != 0) as i64).into(),
                    1.into(),
                    0.into(),
                ],
            )
            .await
            .unwrap();
        }
        crate::migration::Migrator::up(&db, None).await.unwrap();
        for row in all(&db, "SELECT * FROM users ORDER BY username", vec![])
            .await
            .unwrap()
        {
            let flags: u8 = text(&row, "id")[1..].parse().unwrap();
            let mut actor = User {
                id: text(&row, "id"),
                username: text(&row, "username"),
                name: text(&row, "name"),
                role: text(&row, "role"),
                role_name: String::new(),
                permissions: vec![],
                can_in: false,
                can_out: false,
                can_count: false,
                active: true,
            };
            hydrate(&db, &mut actor).await.unwrap();
            assert_eq!(actor.can_in, flags < 8 && flags & 4 != 0);
            assert_eq!(actor.can_out, flags < 8 && flags & 2 != 0);
            assert_eq!(actor.can_count, flags < 8 && flags & 1 != 0);
            assert_eq!(actor.can("sales.read"), flags < 8 && flags & 2 != 0);
            assert_eq!(actor.can("customers.create"), flags < 8 && flags & 2 != 0);
            for denied in [
                "sales.all",
                "sales.refund",
                "sales.discount",
                "items.create",
                "records.all",
                "stocktake.finish",
            ] {
                assert!(!actor.can(denied), "{} must not gain {denied}", actor.id);
            }
        }
        validate_backup(&db).await.unwrap();
        db.close().await.unwrap();
    }
}
