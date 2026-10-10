# Task State

## Objective / Phase
Active goal：全部做到位啊。以docs/客户需求/20261009.md、用户后续确认和v2原型为依据；整体仍active，未标记complete。
当前ACCEPTANCE：退货菜单合并单据筛选已实现并通过双浏览器验收和自查；即将显式提交推送。Direct，无subagent。
分支feat/sales-and-receivables，最近已推送8815cba；当前菜单合并及审计文档待最终验收后提交。用户授权全部提交推送，不合并、不发Release；显式stage，保留数据库、tmp和预览服务。

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

## Current Implementation
- 用户最新提出“退货菜单多余，单据列表增加过滤”。桌面/手机导航删除退货，管理员现14项；单据增加“单据 / 退货记录 / 作废记录”筛选，复用AdjustmentsLedger及API，按每次操作保留历史金额/原因/经办人/查看原单，不改变库存/资金/权限事务。
- sales_records保存视图，原单据状态/日期继续保留；记录搜索/分页沿用returns_q/returns_page，切换类型重置第一页，详情返回/刷新保留筛选。旧#/returns进入单据退货筛选，returns_action=void兼容作废；菜单与页头高亮/显示单据。
- 记录模式隐藏原单据导出。pageAddress对明确指向普通单据的全局搜索/工作台/新单保存链接清理记录筛选，浏览器返回恢复原状态，普通菜单往返保留选择。
- 复用filter-chip和Button/aria-pressed，无新依赖/schema/后台业务规则。tests调整14菜单、扩展双次退货+作废切换/刷新/原单返回/旧URL/51条分页重置/本人权限，新增普通单据链接退出记录筛选回归。

## Verification / Actual Results
- 前端→后端最终构建PASS：/tmp/erp-document-records-build-final.log、/tmp/erp-document-records-backend-final.log。E2E类型、prettier与diff-check PASS。
- 首轮专项3PASS/1FAIL：原权限用例默认退货筛选下查作废记录，改为通过新单据入口选择作废，保留原权限/金额断言。
- Chromium相关65 PASS（8.2m）：navigation/queries/roles/sales/search/ui，/tmp/erp-document-records-chromium.log。
- 最后普通单据跳转与旧页头修正后，Chromium导航/search/dashboard15 PASS（1.7m）：/tmp/erp-document-records-links-chromium.log，包含新增回归。
- 最终WebKit相关66 PASS（8.9m）：/tmp/erp-document-records-webkit.log；包括最后的导航清理、新增跳转回归和旧链接页头。测试进程已正常结束。
- 记录3视图×4宽×2主题×3字号72组合PASS：/tmp/erp-document-records-visual-embedded.log；实际记录桌面/320截图和深浅空状态已人工检查（tmp/returns-chromium-*.png、tmp/document-records-*.png）。
- 最终嵌入全局搜索/工作台/旧退货链接及JS/CSS字节一致PASS：/tmp/erp-document-record-links-embedded.log。首次脚本在服务未就绪时连接拒绝，待/api/status就绪后原脚本通过；无业务修复或数据变更。
- 本次审计执行Rust7/Node6、cargo fmt、E2E类型PASS：/tmp/erp-final-acceptance-{rust,node,format,typecheck}.log。后台源未变，无须重复。
- 菜单变更前完整Chromium因用户追加需求主动中止：26PASS/1 interrupted/104未跑，/tmp/erp-final-acceptance-chromium.log，不是全量PASS。
- 菜单变更前15页360显示组合PASS，/tmp/erp-final-acceptance-visual.log，桌面总览截图已检查；本次变动范围以上述最终专项验收为准。

## Constraints / Live Preview
- 每条回复必须以✅ CLAUDE.md loaded 🎉开头；直接执行，无subagent。已刷新并应用.claude/skills/web-design-guidelines/SKILL.md，规则/tmp/erp-web-interface-guidelines.md。只声明实际检查范围，不宣称全站无障碍/像素完美。
- 先前端再后端嵌入；cargo /Users/apple/.cargo/bin/cargo。CLAUDE过时Go/monorepo命令不用于此仓库。
- 成本/目标暂停；业务员用于业绩，开单人独立，无登录账号绑定。数量物料级最多3位；候选改删不重写物料/历史。财务收款/账户/业绩保持同页三入口，无二级财务tab；规范不进入业务菜单，版本在关于。照片可上传两张，不强制上传。
- Vite5173代理4280；4280 session76342、PID23231，数据/tmp/erp-live，admin / Aa123456!，已加载最终构建。保留5500、4290、8912。
- 本次更新前备份backup-20261010-170123-7dd31b85.zip，/tmp/erp-document-records-preview-backup.json。最终嵌入JS /assets/index-B7LYpt0Q.js、CSS /assets/index-BAVXT3QU.css与dist字节一致。
- 本轮防休眠进程21666将在交付前结束；不要关闭预览主机。实体打印机/相机/手机软键盘未测；本轮不打包发布。

## Whole-goal Audit / Remaining
原始需求与实施方案第12节的不变量已对照代码/实际测试断言。需求复核文档新增14菜单证据矩阵，用户业务员用途已实现。
明确不能声称全目标完成：FinancePanel仍缺原型客户欠款/全部筛选、逐列客户账册/账龄；账户占比尚未落地。物料“明细”直达历史入口也需继续核对（现Inventory无该入口，可在记录页查询）。不要因原型演示值自行加新会计/授权规则。

## Self-Review / Batch Acceptance
本批PASS：用户要求的退货菜单移除、单据内筛选、逐笔历史明细、筛选/分页/返回、旧链接与普通单据入口、手机操作和角色范围均有实际代码/浏览器证据。复用既有账册/API/导航清理/样式，无新权限、财务规则、schema、依赖或无关重构。构建、类型/格式与相关双浏览器通过；暂存只包含实现/回归/设计与状态文档，生成物、数据库、日志和tmp不提交。全目标仍待矩阵中的财务/物料差异闭环，不以本批PASS冒充全目标完成。

## Next Action
1. 显式stage本批11个文件，核对staged diff后提交推送并核验HEAD=origin/干净工作区；无需再问许可。
2. 交付后记录commit checkpoint。整体目标保持active；下一批继续FinancePanel欠款筛选/客户账册/账龄及账户占比、Inventory明细入口的差异核对，复用现有业务口径，不能从原型演示值另加会计规则。全部明确范围验收后再update_goal complete。

## Last Checkpoint
2026-10-11：菜单合并验收/自查PASS，Chromium65+最终15、WebKit66、72显示与最终嵌入跳转验证通过，预览已更新；准备提交推送。整体目标未完成，剩余项已逐一记录。
