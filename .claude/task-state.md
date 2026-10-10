# Task State
## Objective / Phase
Active goal：全部做到位啊。以 docs/客户需求/20261009.md、会话确认事项与 v2 原型为准；整体尚未完成，不标记 complete。Direct，无 subagent。用户已授权全部提交推送，不合并、不发 Release。
当前阶段：REVIEW → 客户往来/销售导出/物料导入批次验收完成，待提交推送。
## Delivered
- 2211f46：自定义角色及模块权限、逐行物料、固定标题/操作栏、财务同页分区、基础资料左清单右表格。
- d3fd9c0：开单全部欠款/部分或全额收款，事务确认；欠款签字打印、两张凭证照片、红色必填星号、真实关联单据计数。PDF和上传已测。
- e743d14：库存/单据/记录筛选及同条件导出、手机内容区滚动；ac24432为已推送检查点。
## Current verified batch
- 客户账册按ID展示应收/净实收/欠款；复用财务接口和CustomerLedger。URL保存客户上下文，进入单据补收后返回原客户。手机对账各金额直接可见。
- finance.read控制金额，sales.read控制明细，sales.all控制所有人/本人范围；没有扩大权限。
- 销售CSV/Excel导出复用列表谓词及余额，导出全部匹配数据最多50000，原单金额与当前应收分列；整数分精确转换。保持admin-only。
- TableImport从Settings提取，Inventory增加入口；模板/预览/确认沿用原事务，取消不写入。
- WebKit暴露物料搜索200ms防抖期间旧行可点击、刷新吞掉编辑点击：search != debounced时隐藏旧操作行。原workflow断言不变，新增暂停计时器复现测试。
## Verification
- 原查询批次：Chromium52/WebKit52、布局补测10、Rust7和构建/类型/格式通过，54种显示组合通过。
- 当前批次：Chromium相关60通过，最后导入补测2通过；初轮WebKit59过1失败，定位并修复搜索竞争。
- 修复后WebKit原失败场景与搜索专项2通过，受影响套件36通过。Chromium受影响套件35过1（测试clock安装过迟），将clock移到导航前后该专项1通过。不声称同一次全绿61项。
- 最后手机对账修改：Chromium2/WebKit2通过；/tmp/erp-customer-mobile-{chromium,webkit}.log。
- 前端及嵌入式后端build、Rust7通过；最终npm run typecheck:e2e、cargo fmt --all --check、git diff --check通过。
- 18种客户屏宽/主题/字号组合与对账/导入弹窗无页面溢出和运行时错误，截图人工查看，实际Excel解包读表通过。/tmp/erp-customer-visual.log。
- 本批自查和验收：范围/复用/权限/金额/导入不覆盖/手机布局 PASS。整体原型仍未完成。
## Constraints
- 成本与销售目标扩展暂停：客户原文没有目标，成本算法未确认；不要实施或从样例反推会计规则。
- 历史快照不随资料现值重算；应收/实收/退款分别表达；物料精度最多3位。
- 已应用.claude/skills/web-design-guidelines/SKILL.md，规则/tmp/erp-web-interface-guidelines.md。
- 每条回复以✅ CLAUDE.md loaded 🎉开头。保留tmp、数据库与预览；显式staging，排除生成物。
## Preview / Artifacts
- Vite5173 → backend4280，最新PID82163，数据/tmp/erp-live，admin / Aa123456!；保留5500原型、4290和8912预览。
- E2E4289隔离库；当前测试结束，不与新测试并行占端口。
- tmp/latest-debt-print.pdf、tmp/latest-debt-pdf-render.png；tmp/customer-ledger-*.png、tmp/customer-ledger-dialog-mobile.png、tmp/import-dialog-*.png、tmp/customer-sales-export.xlsx。
- 实体打印机/相机/手机软键盘未测；PDF与文件上传已测。
## Remaining work
1. 退货与作废汇总入口：原型prototype.html:914；sales_revisions.data含command.action、before/after的due/paid与经办/时间，可取历史差额，不能用当前金额重算；sales.read/sales.all范围，复用详情操作。sales_returns无独立业务单号，不造编号。
2. 客户/基础资料/物料候选导入导出仍缺，复用transfer解析/预览/事务及重复不覆盖规则。
3. material_options仅id/field/name/key/version，原型还需状态/排序/说明/引用/最近使用/来源；迁移须兼容旧库、显式INSERT列、备份验证。旧数据来源/时间无证据保持未知；候选不回写物料及历史。基础资料拖拽排序须有键盘/触控替代。
4. Home尚缺真实经营概况/今日销售/每日金额/清点进度；明确期间与口径，不添加成本和目标。
5. 原型全局物料/单号/客户搜索缺失；沿用dirty guard，确认离开之前不能改URL。
6. 按原型逐页复核导航和布局，保留用户明确的逐行选料、财务同页、自定义角色覆盖。
## Next Action
显式暂存本批源文件/测试/文档，审查暂存diff后提交并推送feat/sales-and-receivables。随后读取退货原型、sales_revisions写入和路由/权限，设计并实现汇总查询入口。
## Checkpoint
2026-10-10：最后手机对账双浏览器各2通过，最新预览已启动，客户批次待提交。
