# Task State

## Task / Objective
用户目标：全部做到位啊。当前要求：按docs/客户需求/20261009.md理解业务，客户未提的功能不需要；并使用.claude/skills/web-design-guidelines审查现有界面。
分支feat/sales-and-receivables，开始于0aa549d（已推送）。Direct，无subagent。用户已授权全部提交推送；不合并、不发Release。

## Current Phase / Step
ACCEPTANCE / PASS：本轮范围、实现、自查和需求验收完成，进入提交推送交付。用户已解除旧优惠经营汇总澄清阻塞，无需重复询问；本轮goal可在交付核对后标记complete。

## Confirmed Scope
- 14业务菜单：工作台、开单、单据、客户、物料、出入库、清点、记录、收款、账户、业绩、基础资料、人员、备份。
- 退货/作废合并单据筛选并保留逐笔历史金额，旧#/returns兼容。收款/账户/业绩定位财务同页分区，无二级tab。规范不进入业务菜单，版本在关于。
- 自定义角色/模块与动作权限，管理员保护、旧账号迁移；业务员用于业绩归属，开单人独立，无登录账号绑定。
- 多物料逐行添加/更换/删除，出库零库存禁选及即时超库存提示；必填红星、标题/底部操作常显、表单分区及下拉底部弹窗新增。
- 单据原例：10050抹50，应收10000，实收5000、欠5000；库存与资金整单事务。单据修订/退货留历史，打印欠款签字，最多两张可选凭证照片。
- 用户最新“you call，客户确实没提的不需要”：不增加优惠经营汇总、成本/库存均价或销售目标。原单据折扣、抹零、欠款、退货分摊和部门业务员归属保留。先前“待确认优惠汇总/blocked”历史已覆盖，决策见decisions.md末节。

## Current Changes
已刷新官方Web Interface Guidelines；审查共享控件、导航、工作台及14业务页面。
1. 主导航/更多/工作台原生链接：复用原HomeLink为PageLink，保留未保存保护、权限和财务同页定位；useSyncExternalStore订阅URL查询变化，原生新标签保留最新筛选。
2. skip link直接聚焦main且保留URL，避免#main被路由误认工作台。
3. 字典键盘滚动跟随、单一aria-selected、组合输入中的Enter不误选；候选滚动不传递给父容器。
4. 凭证移除复用确认弹窗，取消恢复焦点、确认才发请求；图片240×160占位/延迟加载，窄屏可收缩。
5. 物料新增仅精细指针设备自动聚焦输入；装饰图标aria-hidden、表单控件可理解name及零散选择控件name。
没有修改后端业务、权限、数据库结构或会计规则；原有测试只将导航按钮定位改为链接，普通操作和单据记录筛选保持按钮，手机验证4链接+更多按钮，业务断言未削弱。

## Current Verification
- 旧4280只读复现：18候选按Down12次，选中项y779–823而菜单y290–530、scrollTop=0；skip link跳#main且误显工作台。/tmp/erp-guidelines-before.log。
- 前端→后端构建PASS：/tmp/erp-guidelines-{build,backend}.log。E2E类型、修改TS格式及git diff --check PASS；cargo=/Users/apple/.cargo/bin/cargo。
- 新增4专项全部实际通过：字典/触屏/凭证见/tmp/erp-guidelines-targeted-final.log中的3 PASS；最终新标签/skip见/tmp/erp-guidelines-navigation-targeted.log的1 PASS。后续全量会一起验证。
- 首轮新增测试准备问题：凭证误用post命令（现有API是confirm）已修正。Chromium修饰键新标签实际已加载正确业务页，但toHaveURL等待hash导航超时；改为业务区加载后轮询实际URL，保留筛选和原页不变断言，已PASS。没有为测试修改产品或削弱断言。
- 14页×4宽×2主题×3字号336显示组合PASS：/tmp/erp-guidelines-visual.log。tmp/guidelines-14-*.png与guidelines-audit-contact.png已人工查看。另14页面当前可见控件名称与装饰图标检查无发现；不宣称全站无障碍认证/像素完美。
- Chromium首轮136 PASS/7 FAIL（16.5分钟）：/tmp/erp-guidelines-chromium.log。6项测试共用菜单定位未同步、1项新标签等待断言；修正导航helper及动态收发入口后最终navigation/workflows 13 PASS（1.1分钟），/tmp/erp-guidelines-final-navigation-workflows.log，覆盖原7项失败。首次补测11 PASS/1 FAIL的记录也保留（剩余动态入口随后修正），不声称首轮143全绿。
- 原生新标签只读诊断：实际URL/业务区正确、document.readyState=complete，Playwright locator断言却等待hash导航；最终同时轮询实际可见性、URL、筛选值，5次诊断及两浏览器导航用例均通过；不保留猜测性路由改动。诊断tmp/guidelines-popup-*.mjs，首轮失败tmp/guidelines-first-chromium。
- WebKit navigation/ui/catalog/sales/workflows 共59项，首轮58 PASS/1 FAIL（6.9分钟），/tmp/erp-guidelines-webkit.log。Safari默认鼠标点击按钮不聚焦，取消移除凭证时焦点未归还；已在开确认窗前显式聚焦该按钮。修复后完整凭证专项WebKit1 PASS/Chromium1 PASS，/tmp/erp-guidelines-{webkit,chromium}-focus.log。首轮trace保留tmp/guidelines-first-webkit，不声称首轮59全绿。
- 最终前端→后端构建及类型/格式通过，日志/tmp/erp-guidelines-{build,backend}-final.log。编码/条码spellcheck=false已在最终嵌入界面展开验证。Safari焦点修复后的预览再次备份更新。

## Existing Implementation / Historical Evidence
完整逐项需求、14菜单证据矩阵和实施方案不变量见docs/客户需求/20261009-需求复核.md；历史细节保留该文档及decisions.md，不重做已完成工作。
最新旧产品提交6560988（财务账龄/客户账册/账户净收比例），后续9712276/0737a92/0aa549d仅文档；旧产品完整云端run38076087635 SUCCESS，Chromium139/WebKit139，11个适用平台jobs通过。最新0aa549d文档run38077840898也SUCCESS。这些结果不用于冒充本次新改动验证。
历史本地前端→后端、Rust7/Node6，Chromium139+最终22、显示336+财务72通过。iOS真机/Release条件跳过，实体打印机/相机/手机软键盘未现场验证。

## Known Issues / Evidence Boundaries
此前本地WebKit一次记录搜索、旧云端239c5a2一次销售搜索，fill后输入框为空且未发出对应请求；根因未知，不宣称已修复。原用例5次、queries15次及140次带事件诊断全正常，最终旧产品云端139/139通过。保留tmp/finance-webkit-records-failure、tmp/ci-239c5a2-webkit/test-results、tmp/record-search-diagnostic.mjs及相关JSON，禁止机械重复相同140次检查或放宽断言。
旧诊断库tmp/record-search-large-data保留，4294服务已停止。没有已复现的待修产品问题；若再次发生应读trace/事件定位。

## Preview / Constraints
- 每条回复以✅ CLAUDE.md loaded 🎉开始。直接执行，无subagent。CLAUDE旧Go/monorepo命令不用于本项目。
- 前端构建后再构建Rust嵌入。保留数据库、tmp、既有预览；显式stage，禁止git add . / -A；无合并/Release。
- Vite5173代理4280。预览4280已备份更新：PID50112/session45129，target/debug/easy-erp-server --data-dir /tmp/erp-live --bind 127.0.0.1:4280。账号admin / Aa123456!。
- 更新前备份backup-20261011-011319-930e3650.zip，/tmp/erp-guidelines-preview-delivery-backup.json。14路由及菜单/工作台跳转PASS，13个已加载嵌入资源与dist字节一致：/tmp/erp-guidelines-preview-delivery.log。
- 保留5500、4290、8912，勿关闭用户其他服务。caffeinate随测试结束。
- PR #1 https://github.com/7link-team/easy-erp/pull/1 保持OPEN/DRAFT；本次提交用于交付本轮复审；提交/推送状态以实际Git远端为准。

## Self-Review / Acceptance
PASS：严格按原需求及最新取舍，无成本/目标/优惠汇总扩展；复用导航、共享Field/Modal/确认逻辑，无后端/数据库/权限/会计规则变化；实际浏览器、336显示、最终修复专项均有证据。首轮失败及修正原因完整记录，不以局部复测冒充首轮全绿。仅交付源代码、回归测试、需求和状态文档，不提交tmp/产物。

## Next Action
1. 产品实现与本地验收无剩余待办。提交推送本批并核对origin/feat/sales-and-receivables；若Git已一致，无需重复提交。
2. 同步PR #1描述，保留OPEN/DRAFT、不合并不发布。云端CI自动执行，如有失败以实际日志/trace处理，勿为轮询不断追加文档提交。
3. 交付核对后mark goal complete；无需用户进一步决定。实际打印机、相机、手机软键盘的现场验收不在本次浏览器证明范围。

## Last Checkpoint
2026-10-11：范围收口、规范复审和具体修复验收PASS。Chromium首轮136/143+最终相关13 PASS；WebKit首轮58/59，Safari焦点修复后双浏览器各1 PASS；336显示及最终构建/预览资源核对。原失败证据保留，无新增业务阻塞。
