# Task State
## Objective / Phase
Active goal：全部做到位啊。依据 docs/客户需求/20261009.md、会话确认与 v2 原型；整体尚未完成，不标记 complete。
当前阶段：ACCEPTANCE。本批实现、自查与验收完成。Direct，无 subagent。用户已授权全部提交推送，不合并、不发 Release。
分支 feat/sales-and-receivables；上一交付 c42d04f。本批工作台、菜单、操作列与类型独立列按已授权提交推送，交付版本以分支 HEAD 和 origin 核验为准。

## Delivered history
- 2211f46：自定义角色/模块权限、逐行选料、固定标题/操作栏、财务同页、基础资料左清单右表格。
- d3fd9c0：欠款/部分/全额收款，同事务扣库存入账；欠款签字打印、两张照片、必填星号及关联单据数。
- e743d14：物料/单据/记录筛选与同条件导出、手机内容区滚动。
- 86ec3eb：客户ID账款/补收上下文、单据完整筛选导出、物料导入弹窗。
- c42d04f：退货作废历史金额汇总、取消/过期请求修复；当时完整 Chromium93/WebKit93 PASS。

## Current implementation
- dashboard.rs /api/dashboard：单事务只读汇总，复用 sales::balances 和已有权限范围。主机本地日期；月度当前应收/净实收/欠款、上月同期、30日应收、今日单据六张预览与全量计数、实际业绩及60天欠款。
- 清点用确认产生的调整单时间，活跃物料去重；未确认/取消不计。不引入成本和目标。
- HomeOverview.tsx：经营概况、库存指标、今日单据、提醒与实际业绩。HomeLink 原生深链支持新标签，dirty guard 通过后才改 URL；正常导航清理 sale_open/sale_print。
- 按用户确认恢复15项管理员业务菜单：工作台、开单、单据、客户、退货、物料、出入库、清点、记录、收款、账户、业绩、基础资料、人员、备份。角色按权限减少。规范不进入业务菜单，版本移到菜单外关于。
- invoice 直达既有 SaleEditor，sales 为列表；movement 复用 Records 与收发表单。finance/accounts/performance 保持同一个组件，按导航定位并聚焦分区、保留筛选；无二级财务 tabs。
- 最新要求：单据尾列操作区，查看/编辑草稿/修订按状态权限显示；今日单据查看、退货查看原单。桌面 sticky 右侧，手机带分隔线的独立底部操作行。复用已有详情/编辑，无新增业务事务。

- 用户确认列表中类型不明显：将单号下的小字改为独立“单据类型”列，手机单独一行带明确标签，继续显示历史类型名称。桌面短类型/日期保持可读。

## Verification / Acceptance
- 前端构建后再 Rust 后端构建 PASS /tmp/erp-type-{frontend,backend}.log；npm run typecheck:e2e、cargo fmt --all --check、git diff --check PASS。Rust7 PASS /tmp/erp-home-unit.log，之后后端未修改。
- Chromium全量102 PASS（8.7m）/tmp/erp-menu-final-chromium.log；之后用户追加类型独立列，最终构建受影响/原失败场景19 PASS（2.4m）/tmp/erp-type-chromium.log。
- 最终完整WebKit102 PASS（15.6m）/tmp/erp-type-webkit.log，session90383已结束，4289测试服务退出。
- 首次完整WebKit95 PASS/7超时（1.5h）：pmset证实主机多次自动休眠，最初两次412秒/931秒与trace空档一致，另有唤醒后登录迟缓。临时caffeinate防休眠后完整102通过；没有放宽断言或修改业务逻辑，caffeinate session67321已停止。旧失败trace存tmp/menu-webkit-failures。
- 更早工作台WebKit一次失败为首次汇总载入导致快捷入口移动，已延后首载入口显示并加受控回归；最终全量包含此修复。菜单专项的同URL不重置编辑器为测试操作错误，已改走真实返回/确认流程，未削弱业务断言。
- 工作台18种真实显示+18种百万金额/长姓名组合PASS /tmp/erp-home-{visual,stress}.log；菜单/列表90种显示组合PASS /tmp/erp-menu-visual.log；最终类型列18种组合PASS /tmp/erp-document-type-visual.log。
- 最终嵌入服务在1280/1024/320及浅深主题中操作可见，财务定位PASS /tmp/erp-type-embedded.log；桌面/手机截图人工查看。不能声称全站无障碍/像素对齐完成。
- 自查PASS：范围、复用、权限、历史快照、无schema更改/新依赖、回归、复杂度、持久状态。当前批次需求验收PASS：15个菜单和真实入口、财务同页定位保留筛选、菜单外关于、尾列显式操作、独立类型列、手机分区、真实工作台指标。

## Constraints / Preview
- 成本与目标暂停：原需求没有销售目标，成本算法未确认。历史快照不随资料现值重算，精度最多3位。
- 已应用 .claude/skills/web-design-guidelines/SKILL.md，规则 /tmp/erp-web-interface-guidelines.md。业务导航仍复用原按钮路由，本批新增工作台跳转为原生链接；不宣称全站链接语义已统一。
- 每条回复以✅ CLAUDE.md loaded 🎉开头；显式 staging，保留 tmp、数据库与预览，排除生成物。
- Vite5173 → backend4280 PID95755/session89975，最终构建已重启，数据/tmp/erp-live，admin / Aa123456!。保留5500、4290、8912。
- tmp/latest-debt-print.pdf、tmp/latest-debt-pdf-render.png 已查看欠款与签字内容；实体打印机/相机/手机软键盘未测，PDF/上传/照片备份恢复已测。

## Remaining overall scope
1. 全局物料/单号/客户搜索：复用接口和 dirty guard，先确认再改 URL，客户按ID定位。
2. 客户/基础资料/物料候选导入导出：复用 transfer 解析/预览/事务和重复不覆盖规则。
3. material_options 只有id/field/name/key/version，缺状态/排序/说明/引用/最近使用/来源。迁移前 options.rs 的位置式 INSERT 改显式列；备份兼容。未知旧来源/时间保持未知，不回写物料/历史。
4. 字典拖拽排序有键盘/触控替代；剩余页面逐项对照原型复核。
5. 成本和目标继续暂停，勿从演示占位推导规则。

## Next Action
本批交付核验本地HEAD与origin/feat/sales-and-receivables一致。整体下一批为全局物料/单号/客户搜索：先复核 items、sales、sales/catalog 的既有查询和客户ID定位；复用 navigation dirty guard，再补入口与浏览器验收。成本/目标等待用户明确语义，其余已授权工作不重复询问。

## Checkpoint
2026-10-10：最终类型列已实现并验证；Chromium全量102+最终补测19、WebKit最终全量102通过。本批自查/需求验收PASS，整体原型尚未完成。
