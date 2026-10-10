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


## 2026-10-10 设计收尾与登录
Decision: 开发代理显式保留 Host，继续沿用服务的 Origin 校验；浏览器经过代理登录作为回归场景。
Reason: 原 Vite 字符串代理重写 Host，真实浏览器登录失败，而无 Origin 的 API 脚本误判成功。
Alternatives Considered: 放宽服务来源校验或删掉 Origin；均不采用。
Tradeoffs: 反向代理须保持外部 Host 与 Origin 一致。
Scope: vite.config.ts、开发代理 E2E。
Status: 已实现并验证。

Decision: 保留开单内收款快捷入口；本轮完成现有设计落地的验证与缺陷修复，独立拆页和字典交互重构列明为原型差异。
Reason: 用户同意按登录优先、实际功能验收、整理提交的顺序收尾；无需为入口形式重写已验证业务。
Alternatives Considered: 删除快捷入口或照原型一次性拆页；会扩大行为变更范围。
Tradeoffs: 原型与实装仍有布局差异，已在设计文档第 18 节注明。
Scope: 本轮 UI、文档、测试；保留演示数据库，不合并或发 Release。
Status: 实施。

Decision: 签名身份沿用现有 Secrets 与工作区外本地目录，文档推荐密码管理器附件和异地恢复口令；不建私有 submodule。
Reason: GitHub Secrets 不能读回，必须另有可恢复备份。
Alternatives Considered: 明文私有仓库不采用；如另选加密仓库须独立制定保管方案。
Tradeoffs: 异地保存和恢复演练仍需保管人实际执行；本轮仅补规程，不宣称备份已完成。
Scope: docs/发布与自动更新.md。
Status: 规程完成，实际异地备份未验证。


## 2026-10-10 侧栏与工作台反馈
Decision: 桌面侧栏只让 nav 滚动，品牌标题与底部说明固定；开单发货复用 task-card，并入工作台常用操作网格。
Reason: 用户反馈侧栏标题随菜单滚动、开单按钮设计不协调。
Alternatives Considered: 标题使用 sticky、保留独立开单按钮；现有 flex 侧栏与任务卡片可直接复用。
Tradeoffs: 电脑宽屏四个入口同排，手机两列；按现有权限显示入口。
Scope: App、现有样式和相关 UI 回归。
Status: 已实现，真实浏览器截图及 Chromium / WebKit 相关测试通过。

## 2026-10-10 表单与逐行选料
Decision: 开单在明细列表末尾“添加一行”，新行内选择物料后聚焦数量；不采用固定页脚添加入口或独立批量选料弹窗。
Reason: 用户明确要求连续加行、就地填写，避免长单据上下往返。
Alternatives Considered: 页顶物料按钮列表、固定底部批量选择，均被用户否定。
Tradeoffs: 一次选择一个物料，已选物料禁用，数量在原行修改。
Scope: SaleEditor、现有 Popover 和共享表单样式。
Status: 已实现，11 行与手机交互回归通过。

Decision: 可维护下拉末项提供带分隔线和浅底的“＋新增”，复用配置弹窗，保存后自动选择并保留父表单。
Reason: 用户要求不离开当前表单、去掉大块快速新增按钮并统一视觉。
Alternatives Considered: 跳转维护页会中断填写；固定枚举不具备维护接口，不添加入口。
Tradeoffs: 沿用权限，客户可由开单人员新增，部门/业务员/账户限管理员；嵌套表单阻止提交冒泡。
Scope: 客户、部门、业务员、账户；字典继续手输，筛选保持原行为。
Status: 已实现并专项验证。

Decision: 库存不足在数量旁即时提示，确认前拦截并聚焦；草稿允许保存。修订可开量为当前库存加原单数量，后端事务继续最终校验。
Reason: 用户反馈库存 86 输入 99 无提示；与现有草稿不扣库存、修订按差量扣库存规则一致。
Alternatives Considered: 只等提交后报错、禁存草稿，都不采用。
Tradeoffs: 前端库存为读取时快照，并发库存变化仍由后端判断。
Scope: 开单/草稿/修订、按 ids 批量查询物料。
Status: 已实现，库存与修订回归通过。
