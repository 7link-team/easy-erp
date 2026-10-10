# Task State

## Objective / Phase
Active goal：全部做到位啊。依据docs/客户需求/20261009.md、用户后续确认及v2原型；整体active，未标记complete。
当前ACCEPTANCE：物料“明细”批验收/自查通过，待显式提交推送。Direct，无subagent。本轮有实际实现与新验证，为progress。
分支feat/sales-and-receivables；用户授权全部提交推送，不合并、不发Release。保留数据库、tmp和预览服务；仅显式stage。

## Delivered / Historical Evidence
- 2211f46：自定义角色/模块权限、逐行选料、固定标题/操作栏、财务同页、基础资料左清单右表格。
- d3fd9c0：欠款/部分/全额收款、事务扣库存与记账、欠款签字打印/两张照片、必填星号、关联单据计数。
- e743d14 / 86ec3eb：筛选导出、客户ID账款/补收上下文、物料导入弹窗、手机滚动。
- c42d04f：退货作废历史金额汇总、请求取消/过期响应修复；Chromium93/WebKit93。
- 4b4d416：真实工作台、原15业务菜单、财务同页定位、关于；尾列操作、独立单据类型/手机标签；Chromium102+19/WebKit102。类型问题已解决。15菜单约定已被最新14菜单决定覆盖。
- 221f1ff：按权限全局搜索、ID定位/导出、dirty guard；WebKit重复URL写入修复；Chromium44/WebKit44、72显示组合。
- 2f8902d：八类资料CSV/XLSX原子导入导出、回滚/重验/幂等/部门ID防错绑；双浏览器及Rust7、216显示/36嵌入组合。
- 2d6d4a7：字典元数据、启停/引用/来源/使用时间、原子排序、账户类型、旧模板/API/备份兼容；Chromium71/WebKit71及补测、Rust7和显示检查通过。
- 31e6f0e：业务员/部门/期间筛选、真实月度资料统计、负责人、账户同条件对账；分类快照不倒填、无账号绑定。Chromium89+25/WebKit90、Rust7、240显示/48嵌入组合。
- f0ee74e / checkpoint8815cba：清点实际分类/跨页勾选/失败恢复，备份真实来源/图片数/快照/位置、旧清单兼容、手机固定区。相关双浏览器、Rust7/桌面控制1、96显示组合与最后文案双浏览器各1通过。详见需求复核及对应日志。

- cc2569c：退货菜单合并单据记录筛选，14菜单、历史逐笔金额、分页/筛选/返回/旧链接、普通单据深链清理；Chromium65+15/WebKit66和72显示组合通过。

## Current Implementation / Design
- 物料尾列增加“明细”原生链接，进入现有出入库页面；按物料ID查询，同名/改名不混账，停用物料保留入口。复用导航、Records、document_filter和现有CSV导出。
- Filter新增item_id。服务端筛选包含物料的单据并按单据分页；前端只展示该物料行；原单弹窗仍有全部物料行；导出额外约束行ID，不导出同单其他物料。
- 当前名称/规格仅在items.read下返回；records.read/all和管理员导出权限沿用。页面说明当前物料/本人范围，提供清除筛选；空数据和失败可恢复，失败隐藏旧表。
- URL保存筛选/页码，入口清理旧记录条件；刷新/返回/新标签复现。复用现有控件、筛选提示与响应布局，暗色说明对比度和桌面类型列/按钮排列已修正。无新schema、依赖、权限或库存事务。

## Current Batch Verification
- npm run build→cargo build -p easy-erp-server PASS：/tmp/erp-material-history-{build,backend}-final.log。
- E2E类型/prettier/cargo fmt/diff-check PASS；cargo test --locked -p easy-erp-server：Rust7 PASS，/tmp/erp-material-history-rust.log。
- 新增Chromium3 PASS：/tmp/erp-material-history-targeted-final.log。最初测试准备错误（新增API仅返回ID、入库权限依赖、角色version），按现有接口修正，未削弱业务断言。
- Chromium相关54 PASS（4.5m）：/tmp/erp-material-history-chromium.log。最后仅CSS调整后，Chromium物料明细/六尺寸页面/手机库存10 PASS（1.1m）：/tmp/erp-material-history-chromium-final.log。
- 最终WebKit同范围54 PASS（6.1m）：/tmp/erp-material-history-webkit.log。inventory/workflows/queries/navigation/ui/roles均实际执行。
- 最终物料/明细2页×4宽×2主题×3字号48显示组合PASS：/tmp/erp-material-history-visual-final.log；实际桌面/320深浅截图已检查（tmp/material-history-*.png）。首轮暗色对比度4.38已修正并复验。
- 手机明细按钮完整位于导航上方、真实点击定位及嵌入资源字节一致PASS：/tmp/erp-material-history-mobile.log；截图tmp/material-history-mobile-action.png。
- 预览重启后首次视觉脚本早于服务就绪连接失败；确认/api/status就绪后原脚本通过，无业务修改。
- 所有E2E/视觉进程已正常结束，4289不保留；预览服务保留。最后构建后未再改业务代码。

## Constraints / Live Preview
- 每条回复以✅ CLAUDE.md loaded 🎉开头；直接执行，无subagent。已应用.claude/skills/web-design-guidelines/SKILL.md并刷新/tmp/erp-web-interface-guidelines.md；只声明实际范围，不宣称全站无障碍/像素完美。
- 先前端后后端嵌入；cargo=/Users/apple/.cargo/bin/cargo。CLAUDE旧Go/monorepo命令不用于本仓库。
- 成本/目标暂停；业务员用于业绩，无登录账号绑定，开单人独立。数量物料级最多3位；候选改删不重写物料/历史。14业务菜单，无退货；财务收款/账户/业绩三个入口定位同页、无二级tab。规范不进菜单，版本在关于；最多两张照片，不强制上传。
- Vite5173代理4280；4280 session39164、PID26077，数据/tmp/erp-live，admin / Aa123456!；已加载最终构建。保留5500、4290、8912。
- 更新前备份backup-20261010-173355-43c7d3ba.zip，/tmp/erp-material-history-preview-backup.json。
- 最终嵌入/assets/index-DTi2vcEn.js与/assets/index-Du9Ec6k0.css已与dist字节一致验证。
- 本批caffeinate随测试结束；不要关闭预览。实体打印机/相机/手机软键盘未测；未打包发布。

## Whole-goal Audit / Remaining
原需求和实施方案第12节不变量已对照源与测试，需求复核有14菜单证据矩阵。物料明细缺口本批已关闭。
FinancePanel仍缺原型客户欠款/全部筛选、逐列账册/账龄及账户占比，不得声称全目标完成。不要从演示值新增会计/授权规则。
当前测试清单135项/23文件（仅list，不是全量执行）。前次完整Chromium菜单变更时主动中止：26PASS/1 interrupted/104未跑，/tmp/erp-final-acceptance-chromium.log。最终全目标还需完整双浏览器与当前14菜单实际页面核验；以最终代码与明确例外为准，不用历史局部通过替代全目标验收。

## Self-Review / Batch Acceptance
本批PASS：入口、ID隔离、历史快照、完整原单、同条件导出/分页、停用/空状态/失败恢复、权限、返回/刷新/新标签和手机操作均有实际验证。复用既有组件/API/筛选/权限；无无关重构、schema或业务规则变更。变更只含实现、回归和状态/需求文档，日志、数据库、构建物和tmp不提交。Web guidelines修改范围的原生导航、focus、状态提示、文字折行、深浅对比度和布局已复核。全目标未完成。

## Next Action
1. 本批显式stage→staged diff检查→commit/push→核对远端一致及工作区干净，再更新交付checkpoint。
2. 接续FinancePanel：补齐欠款筛选/逐列客户账册/账龄、账户占比及合计。客户集合仍为有有效单据往来客户，避免声称全部客户档案；账龄沿用dashboard从最早未结清单据业务日期到主机今日（不当合同逾期），复用balances、不改收款与历史。当前原型条形是相对最大净收对比，实施前明确真实展示公式和退款/零合计处理。
3. 财务差异关闭后完成全目标验收：完整Chromium/WebKit、14菜单真实页面与原需求/方案/后续要求逐项证据矩阵；全部明确范围通过后才能update_goal complete。

## Last Checkpoint
2026-10-11：物料明细批双浏览器与最终显示验收通过；已更新预览及需求复核，待提交推送。下一批为财务剩余差异。
