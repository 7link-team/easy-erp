# Task State

## Objective / Phase
Active goal：全部做到位啊。依据docs/客户需求/20261009.md、用户后续确认及v2原型；整体active，未标记complete。
当前ACCEPTANCE：财务客户账册/账龄、账户占比与合计已实现并验收。完整Chromium139及最终界面22 PASS；最终WebKit首轮138 PASS/1 FAIL，原失败用例5次及queries15复验PASS，偶发输入为空尚无稳定复现。Direct，无subagent。财务本批已完成独立工作并以6560988提交推送，已核对远端一致和工作区干净；全目标仍有优惠汇总澄清及已记录的偶发测试问题。
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

- fbd3c67：物料明细按ID定位历史、逐物料导出/完整原单、权限/停用/分页/返回/手机；Chromium54+最终10/WebKit54、Rust7和48显示组合通过。

## Pending Clarification
原型“抹零/折扣让利”汇总没有定义退货后口径，原需求未要求该指标。已用request_user_input_async询问：推荐本轮不加该汇总、保留单据优惠明细；备选为统计退货后剩余货款对应优惠。尚未收到回复，不视为批准删减原型范围，不实施未确认会计口径；其他独立工作继续。

## Delivered Design — 财务账册
- 复用finance读取事务、balances和主机本地日历，客户增加有效单据数、最早未结清业务日期和天数；结清/作废/全部退货不贡献账龄，未来日期按0天。现有应收/净实收/欠款算法不变。
- 客户仍为有效单据往来集合，默认全部往来兼容原行为；有欠款筛选、按名称搜索、稳定排序/每页50户、筛选合计及全部筛选结果CSV。复用CustomerLedger和原权限；同名按ID分账，导出带ID。
- 账户净收占比=账户净收/筛选净收合计。合计>0才计算；负数及超过100%的比例如实显示数字、不画截断进度条；其他比例配原型横条；合计<=0说明不计算。账户合计与流水日期/账户条件相同，保持既有现金规则。
- UI复用TableScroll/filter-chip/Button和现有响应账册布局，客户/账户尾列明确操作，手机金额不用横滑；应用web-design-guidelines。无新schema/权限/依赖/会计规则。
- 验收：原型字段/筛选/导出、账龄结清/退货/作废/未来日期/同名、日期与权限、0/负/超100%占比、分页刷新、手机/深浅/字号；构建前端→后端，专项→全量双浏览器，再做14菜单/需求矩阵完成性审计。

## Previous Material Implementation
- 物料尾列增加“明细”原生链接，进入现有出入库页面；按物料ID查询，同名/改名不混账，停用物料保留入口。复用导航、Records、document_filter和现有CSV导出。
- Filter新增item_id。服务端筛选包含物料的单据并按单据分页；前端只展示该物料行；原单弹窗仍有全部物料行；导出额外约束行ID，不导出同单其他物料。
- 当前名称/规格仅在items.read下返回；records.read/all和管理员导出权限沿用。页面说明当前物料/本人范围，提供清除筛选；空数据和失败可恢复，失败隐藏旧表。
- URL保存筛选/页码，入口清理旧记录条件；刷新/返回/新标签复现。复用现有控件、筛选提示与响应布局，暗色说明对比度和桌面类型列/按钮排列已修正。无新schema、依赖、权限或库存事务。

## Finance Batch Verification
- 前端→后端构建、E2E类型、prettier、Rust7、cargo fmt、diff-check PASS。日志/tmp/erp-finance-ledgers-{build,backend,rust}.log。
- 新增Chromium4 PASS（16.6s）：/tmp/erp-finance-ledgers-targeted.log；涵盖账龄边界/同名/期间独立、筛选导出和权限、51户分页/清零页码、负/超100%/0占比。
- 14菜单336显示检查PASS：/tmp/erp-acceptance-14-visual.log，截图tmp/acceptance-14-*.png。桌面14页总览与专项手机客户/账户截图已人工查看。原型对照后顶部汇总改连续账册，增加真实有效单据/已收比例/欠款户数；最终财务72组和所有已加载嵌入资源字节一致PASS：/tmp/erp-finance-ledgers-visual-final.log。
- 预览4280已备份后更新至财务构建，session94755；备份backup-20261010-175637-4fc1d863.zip，/tmp/erp-finance-ledgers-preview-backup.json。
- 既有销售对账E2E增加先搜索客户，以支持新50户分页，不删除业务断言。完整Chromium139项PASS（11.1m）：/tmp/erp-finance-final-all-chromium.log，session67537正常退出。该轮为汇总带改动前构建；后端业务一致，最终汇总带相关Chromium22补测PASS（1.7m），/tmp/erp-finance-final-chromium-supplement.log。最终WebKit终态138 PASS/1 FAIL（14.4m）：/tmp/erp-finance-final-all-webkit.log，session80545结束。失败为queries.spec.ts:305记录搜索后仍50行；trace显示输入框为空且仅发起q=空请求，未看到筛选请求，原因尚未确定。证据已保留tmp/finance-webkit-records-failure。原用例未修改，WebKit连续5次通过（34.2s）：/tmp/erp-finance-record-search-repro.log；完整queries15项通过（1.4m）：/tmp/erp-finance-final-queries-webkit.log。尚未确定偶发输入为空的原因，不能宣称已修复。

## Previous Material Batch Verification
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
- Vite5173代理4280；4280 session94755、PID28007，数据/tmp/erp-live，admin / Aa123456!；已加载最终构建。保留5500、4290、8912。
- 更新前备份backup-20261010-173355-43c7d3ba.zip，/tmp/erp-material-history-preview-backup.json。
- 当前财务最终嵌入资源已与dist字节一致验证；日志/tmp/erp-finance-ledgers-visual-final.log。
- 本批caffeinate随测试结束；不要关闭预览。实体打印机/相机/手机软键盘未测；未打包发布。

## Whole-goal Audit / Remaining
原需求和实施方案第12节不变量已对照源与测试，需求复核有14菜单证据矩阵。物料明细缺口本批已关闭。
FinancePanel客户欠款/全部筛选、逐列账册/账龄、账户占比及合计已实现并验收；验证详情及偶发测试失败已记录。不得将未确认的优惠经营指标或成本/目标规则宣称完成。
当前完整测试清单139项/23文件。完整Chromium139 PASS，最终汇总栏相关22 PASS；WebKit首轮138 PASS/1 FAIL，原用例重复5次及queries15全部通过；14菜单336显示及最终财务72组合已通过。完整验收结果与单次失败边界见上，不用历史局部通过冒充无条件全绿。

## Self-Review / Batch Acceptance
财务本批PASS：客户ID分账、未结清日期/未来日期/结清与退货账龄、筛选/分页/CSV、只读权限、账户日期和净收比例、0/负/超100%与移动布局均有实际断言。复用finance事务、balances、CustomerLedger、共享控件及URL筛选；无schema、权限、依赖或资金写入规则变化。修改范围web-design-guidelines复核完成，截图与嵌入资源已核对。完整原需求、后续确认及方案第12节不变量已写入需求复核证据矩阵。
完整WebKit首轮的单次记录搜索失败不隐藏：trace显示输入为空且无筛选请求，原代码和断言连续5次及完整queries15均通过，原因尚未确定；不宣称已修复或首轮全绿。财务新增和本次菜单功能在两浏览器通过。实体硬件未测。全目标仍active，优惠汇总口径未确认。

## Next Action
1. 等用户回复原型优惠经营汇总的取舍/退货后口径；建议本轮不增加该汇总，保留现有单据优惠明细。未收到回复不实施或宣称差异关闭。
2. 若记录搜索再次发生输入为空，使用保留trace继续定位；当前复现5次及完整相关15均通过，无证据时不臆测改产品代码。

## Last Checkpoint
2026-10-11：财务批最终Chromium22 PASS（1.7m），/tmp/erp-finance-final-chromium-supplement.log。本轮测试进程均已结束，4289不保留；4280/5173等预览服务保持。财务批6560988已提交推送并核验远端一致与工作区干净；本次仅补充交付checkpoint。菜单合并已在cc2569c推送，不重复修改。全目标active。
