# Task State
## Objective / Phase
Active goal：全部做到位啊。以 docs/客户需求/20261009.md、会话确认事项与 v2 原型为准。整体尚未完成，不标记 complete。
Direct，无 subagent。用户已授权全部提交推送，不合并、不发 Release。
当前阶段：ACCEPTANCE。客户批次86ec3eb已推送；本批退货汇总与请求取消修复已完成双重复核，提交后继续工作台缺项。交付提交以Git记录为准。
## Delivered behavior
- 2211f46：自定义角色/模块权限及旧账号迁移、逐行物料、固定标题/操作栏、财务同页分区、基础资料左清单右表格。
- d3fd9c0：开单全部欠款/部分或全额收款，确认同事务扣库存与入账；欠款签字打印、两张凭证照片、红色必填星号、真实关联单据计数。
- e743d14：库存/单据/记录筛选及同条件导出、手机内容区滚动。
- 86ec3eb：客户按ID显示应收/净实收/欠款，对账补收后保留上下文；销售同筛选CSV/Excel导出，整数分精确格式化；共享TableImport物料页入口；搜索防抖期间隐藏旧物料操作。
## Current accepted batch
- 退货与作废菜单/api/sales/adjustments，原单号/历史客户/原因搜索、动作筛选和50条分页；URL保存筛选，原单详情往返保留。
- 复用sales_revisions当时before/after快照差额，分别显示应收变化和实际退款。后续补收/改名/作废不重算旧记录；原单号+版本标识，无新增TH/ZF编号或业务表。
- 仅sales.read可用，sales.all/父单归属控制范围；不暴露完整修订快照。手机两列金额直接可见，统一说明/行/分页留白。
- 真实回归发现共享api吞掉响应正文AbortError，返回伪成功error对象导致items.length崩溃。现传播取消/无效正文错误，useResource忽略过期成功结果；保留401会话失效流程。
## Verification / Acceptance
- 最终前端与嵌入式后端构建PASS（先前端后后端）；npm run typecheck:e2e / cargo fmt --all --check / git diff --check PASS。
- Rust7 PASS，/tmp/erp-returns-unit.log。
- 完整Chromium93 PASS（6.8m），/tmp/erp-returns-final-chromium.log。
- 完整WebKit93 PASS（9.0m），/tmp/erp-returns-final-webkit.log。session87759已结束，4289测试服务已退出。
- 新增测试覆盖历史抵债/退款、改名后金额稳定、51次退货分页和非计款、本人/无权限、取消正文/晚响应/无效JSON及恢复。未削弱原业务断言。
- 初轮相关55项54过1失败为上述真实取消问题；修复后原失败场景与受控专项2通过，再完整双浏览器各93通过。
- 18种屏宽/主题/字号和手机更多导航通过；对比度/溢出抽查无发现，/tmp/erp-returns-{visual,contrast}.log。人工检查桌面/320px填充数据截图及深色空状态。
- 自查PASS：范围/复用/权限/无schema更改/请求正确性/无无关重构/无生成物。当前批次需求验收PASS；整体原型仍未完成。
## Constraints
- 成本与销售目标扩展暂停：客户原文没有目标，成本算法未确认。不要实施或从演示数据反推会计规则。
- 历史快照不随资料现值重算；应收/净实收/退款分别表达；物料精度最多3位。
- 已应用.claude/skills/web-design-guidelines/SKILL.md，最新规则/tmp/erp-web-interface-guidelines.md。不能声称全站像素/无障碍验收完成。
- 每条回复以✅ CLAUDE.md loaded 🎉开头。保留tmp、数据库与预览；显式staging，排除产物。
## Preview / Artifacts
- Vite5173 → backend4280，最新PID83862，数据/tmp/erp-live，admin / Aa123456!；保留5500原型、4290和8912预览。
- tmp/latest-debt-print.pdf、tmp/latest-debt-pdf-render.png；tmp/customer-ledger-*.png、tmp/customer-sales-export.xlsx；tmp/returns-{chromium,webkit,live}-*.png。
- 实体打印机/相机/手机软键盘未测；PDF、照片上传及照片备份恢复已测。
## Remaining work
1. Home真实经营概况/今日销售/每日金额/清点进度。明确期间与口径，不添加成本和目标。
2. 客户/基础资料/物料候选导入导出仍缺；复用transfer解析/预览/事务及重复不覆盖规则。
3. material_options只有id/field/name/key/version，仍缺状态/排序/说明/引用/最近使用/来源；兼容迁移、显式INSERT列、备份验证。旧来源/时间无证据保持未知；候选不回写物料/历史。基础资料拖拽排序须有键盘/触控替代。
4. 原型全局物料/单号/客户搜索缺失；沿用dirty guard，确认离开之前不能改URL。
5. 按原型逐页复核导航和布局，保留用户明确的逐行选料、财务同页、自定义角色覆盖；成本/目标暂停。
## Next Action
本批完成提交推送后，读取App.tsx Home和原型workbench，将真实月度单据余额/每日金额/今日单据及清点完成数据接入工作台；先明确统计口径与日期边界，复用sales::balances及既有权限。不得重做已验收的打印/对账/退货。
## Checkpoint
2026-10-10：最终双浏览器各93通过，本批自查/验收完成，当前预览为最终构建。

## Next batch research (not implemented)
工作台原型prototype.html:142–265含经营概况/每日金额/今日单据/今日出入库/清点进度。当前Home在App.tsx:286，只有两库存卡+常用操作+最近出入库。可复用sales::balances统计按业务日期归属月份单据的当前应收/净实收/欠款，并明确不是“当月现金流水”；每日序列同一口径。不要复制目标/成本/虚构趋势。
清点月进度：stocktakes只有创建时间，完成动作会生成documents.kind=adjustment、reference_id=stocktake.id、created_at为实际完成时间；不能拿清点创建时间冒充完成日期。用已确认清点文档关联的活跃物料去重统计；取消和未确认不计，避免以列表前50条做全量。
全局搜索：navigation.ts navigate目前仅(page,initialItem)，任何深链参数必须在dirty guard同意后写URL。后续可扩展query patch参数；Search弹窗不丢父表单，结果点击被拒绝离开时URL/内容均不变。客户当前没有独立搜索输入，需要复用客户ID上下文而非名称混账。
