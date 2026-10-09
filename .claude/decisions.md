# Decisions

## 物料候选与业务资料
Decision: 单独 material_options 表，仅提供候选，业务继续保存字面值与历史快照。
Reason: 用户明确允许删除只影响列表；避免批量改动库存单位和历史资料。
Alternatives Considered: 业务全部关联可变字典 ID，改名自动同步。
Tradeoffs: 纠正物料实际值必须从物料编辑，候选改名不会自动修复现有物料。
Scope: 规格、类型、单位。
Status: 用户授权设计关联影响处理，实施方案已说明。

## 单据类型
Decision: 沿用 sales_catalog，开单手输在命令事务内新增；必须明确是否计款；已停用类型拒绝新用，管理修改限管理员。
Reason: 复用现有 ID/规则与历史快照，避免名称猜测财务行为。
Scope: 本次单据类型可输入要求。
Status: 实施。

## 导航
Decision: 客户与基础资料独立一级菜单，基础资料内只有一层共享 Tab。
Reason: 用户要求减少层级；客户原文无深层设计限制。
Scope: 客户、基础资料、库存快捷开单。
Status: 实施。
