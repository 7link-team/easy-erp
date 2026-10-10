# Task State
## Goal / Objective
Active goal：“全部做到位啊”。以 docs/客户需求/20261009.md + 会话确认事项为准，完成业务并按 design-system/v2/prototype.html 对齐。用户已授权全部提交推送；不合并、不发 Release。
## Phase / Execution
Direct，未使用 subagent。本批 query parity 已提交并推送 e743d14，Chromium/WebKit各52项回归通过；当前源码与构建一致。整体原型对齐仍未完成，不标记 goal complete。
## Delivered commits
- 2211f46：自定义角色/权限、逐行物料、固定表单标题和操作、财务同页分区及第一批原型结构。
- d3fd9c0：开单结算/欠款签字打印/红色必填/真实关联统计/字典维护；92f5b8f 文档检查点，均已推送。
- e743d14：物料/销售/记录查询、同条件导出、手机内容与底栏滚动修复；已推送。
## Verified delivered behavior
- 开单与收发共用 ItemPicker/document.css，明细末尾添加一行，可更换/删除。入库允许零库存，出库/销售禁选；预选物料直接显示。超库存即时提示并拦截确认，草稿允许保存，修订可开量包含原单数量。
- 可维护下拉末项“＋新增”有分隔线、浅底、统一对齐；弹窗成功后自动选择，保留父表单。固定枚举/筛选不放新增。更正流水只列未冲销原流水，无可选时明确说明。
- 自定义角色/模块动作前后端鉴权，受保护管理员、旧 worker/viewer 16 组合迁移、会话撤销、角色备份恢复。财务为同页客户欠款/账户流水/部门业绩，保持用户确认。
- 基础资料为左清单/右表格/底部新增；支持排序/说明、行内启停与计款、未引用删除。物料候选删除不改历史；客户/资料关联单据去重，包含历史 before/after 快照，零关联显示 0。
- 开单/草稿编辑全部欠款/部分收款/全额收款，实际收款与确认扣库存同事务、沿用 sales.pay。草稿仅保存待登记值，修订不重复收款；无 schema 变更，无值字段省略以保留旧幂等指纹。
- 客户原例 10050－50＝应收10000，收5000，欠5000；红色必填星号在共享 Field 统一，隐藏“必填”保留可访问名。
- 欠款打印签字区列应收/已收/剩余欠款、客户签收及欠款确认和日期。详情上传最多两张照片，不强制作为开单前置。实际 PDF 已查看，打印关闭纸纹层以免变灰。
## Current batch: query parity
- inventory.rs：规格/名称/编码/条码搜索；active/low/zero/archived 状态及真实计数，库存排序；列表/导出共用谓词。恢复启用要求 items.update、版本号、事务审计。
- sales.rs / Sales.tsx：单据状态/业务日期筛选、数量和分页；单据与收款状态分列。草稿显示未记账，确认单金额用实际 due。搜索/筛选/page 保存在 URL。
- Records.tsx：出入库逐物料明细账册、搜索/类型、审计搜索/动作及总数；按当前条件 CSV 导出。本人记录范围和 admin-only 导出保持。
- 手机 app-shell 内容区与底栏分成两行，workspace 在底栏上方滚动，修复较高筛选导致末行按钮被遮挡；导航时滚动 workspace 顶部；仅 screen 媒体生效。
- tests/e2e/queries.spec.ts 新增3个集成场景：筛选/计数/排序/导出/恢复及权限，销售状态/日期/本人范围，记录/审计筛选/导出及隔离。既有 workflows 更新低库存控件与空状态文案。
- ui.spec.ts 原测试假设统计卡片数字全白不正确；沿用既有 warning-number 琥珀色并独立断言，未改业务断言。
## Constraints / Important decisions
- 用户质疑成本算法稳定性并指出原文无销售额目标：成本与目标扩展暂停，尚未实施相关模型/代码；不从原型样例推断新会计/考核规则。
- 历史数据不随字典现值重算；应收与实收区分，数量最多3位小数。
- 用户明确要求 .claude/skills/web-design-guidelines，已读取应用，规则最新获取至 /tmp/erp-web-interface-guidelines.md。
- 每条用户可见回复以“✅ CLAUDE.md loaded 🎉”开头。保留 tmp/ 数据与截图及既有预览服务；显式 staging，不能提交产物。
## Verification
已交付批次：sales/catalog/roles Chromium31 + WebKit31；最终打印/权限各3；Rust7、前后端构建、类型及格式检查通过。此前全量 WebKit76通过。
当前 query 批次：
- npm run build、cargo build -p easy-erp-server PASS（先前端后嵌入式后端）；npm run typecheck:e2e / cargo fmt --all --check / git diff --check PASS。
- Rust7 PASS /tmp/erp-query-unit.log。
- Chromium52 PASS（4.3m）/tmp/erp-query-chromium.log。修复手机导航遮挡后的布局专项10 PASS /tmp/erp-query-layout.log。
- WebKit52 PASS（5.9m）/tmp/erp-query-webkit.log；4289回归服务已结束。
- 物料/单据/记录 ×1280/390/320 ×light/dark ×3字号（54组合）无页面溢出或运行时错误；已人工查看桌面销售、手机库存/销售/记录及欠款 PDF。截图 tmp/query-*.png，日志 /tmp/erp-query-visual.log。
- 已重启4280最新嵌入式构建，并通过真实浏览器登录/物料状态计数/单据状态筛选 smoke。Vite5173继续服务最新源码。
- 实体打印机、相机及实体手机软键盘未测；PDF与文件上传已测。不宣称全站无障碍或像素验收完成。
## Preview / Artifacts
Vite http://127.0.0.1:5173 → backend4280，数据 /tmp/erp-live，PID77779。admin / Aa123456!。保留5500原型、4290与8912预览。
PDF tmp/latest-debt-print.pdf、tmp/latest-debt-pdf-render.png；前批 tmp/latest-settlement-*.png / tmp/latest-{customers,catalog}-*.png；当前 tmp/query-{inventory,sales,records}-{width}-{theme}.png。
## Remaining work / Concrete next batch
1. 本批两轮复核 PASS：复用/权限/事务/无关改动/测试产物自查；查询/导出/手机布局需求验收。e743d14 已推送，整体原型验收仍未完成。
2. 客户档案补真实应收/实收/欠款及往来入口，复用 FinancePanel/CustomerLedger 和 finance.read 权限；从客户打开单据后返回仍保留客户上下文。
3. 单据列表导出复用现有 transfer 编码、单据查询和金额口径；库存导入入口从物料可达，复用现有模板/预览/确认导入，避免重复实现。
4. 原型退货与作废汇总查询入口仍缺；详情退货/作废操作已存在。不要混淆退货减免和实际退款。
5. 基础资料/客户/物料候选导入导出尚未齐；须复用当前解析/预览/事务和历史不回写规则。拖拽排序未做，已有数字排序。
6. 再逐页核对真实原型/原文验收，保留财务同页、逐行选料、自定义角色等明确修改；不要把成本/目标、占位趋势当业务缺陷补进去。
## Next Action / Checkpoint
检查 src/pages/Sales.tsx 客户表及 CustomerLedger，复用现有 finance API/finance.read 权限补真实账款和往来入口，并验证从单据返回的客户上下文。2026-10-10，e743d14已推送，Chromium52/WebKit52通过，预览已更新。
