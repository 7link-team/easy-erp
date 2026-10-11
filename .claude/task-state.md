# Task State

## 交付检查点：全部提交推送及CI修正（2026-10-11）
用户已明确授权全部提交推送。Direct；feat/sales-and-receivables，PR #1。全部24文件已提交推送6e720be，原本工作区干净；GitHub Actions38148280292已运行。
该轮各平台构建/基础检查通过；Chromium148通过/1失败：dictionary-management旧五列备份fixture用新库删旧字段，漏删query_indexes_v1迁移和其16个索引，manifest含非业务迁移而被正确拒绝。WebKit同样148通过/1个相同fixture失败，无其他失败项。本地原用例同样复现失败，/tmp/erp-ci-legacy-before.log。
修正仅涉及旧备份测试构造：删除16个后加索引和query_indexes_v1记录，保持真实旧schema与清单一致；不改产品恢复校验或任何原断言。本地修正后Chromium旧五列+无索引旧备份2项、WebKit旧五列1项全部PASS；E2E类型/Prettier/diff检查通过，日志/tmp/erp-ci-legacy-after.log、/tmp/erp-ci-legacy-webkit.log。自查与本补丁验收PASS。下一步补交推送，检查最新提交的Actions。保留前轮性能限制和未测边界。

## 当前任务：工作台样式与无效筛选补审（已完成）
用户指出上轮漏掉今日单据仅有全部按钮。确认无条件渲染导致空数据也显示，且filter-chips无上padding贴标题线。本轮Direct：多类型才显示类型筛选；旧URL仍有筛选时保留明确清除入口；补筛选上间距。检查工作台完整区块与空/单类型/多类型/失效筛选/错误状态，相关E2E及实际截图验证。保留全部未提交改动，不提交推送。
已实现上述显示条件与16px上间距；原型与完整工作台源码/桌面截图已核对。Chromium dashboard全6项PASS，含新状态回归与3宽度间距截图；npm build、cargo build、Prettier、git diff --check PASS。WebKit新状态回归1项PASS，日志/tmp/erp-home-review-webkit.log，320px截图已复核。Self-review与本轮Acceptance PASS；下一步交付，本轮无待执行修复，无提交推送。改动为HomeOverview.tsx、theme.css一条规则、dashboard.spec.ts新增状态测试及原有设计文档追加，未改其他产品行为。

## 前轮：UI guideline 样式审查（四项局部修复已验证）
用户要求按 web-design-guidelines 扫样式，后续明确重点“内容边距、对齐和表格”。Direct执行，技能和最新规则已读取，未派子代理。
本轮只改 src/pages/Sales.tsx 的物料行样式类和财务数字列、src/theme.css 两处布局；更新 docs/桌面与移动界面设计.md。保留下文上一轮性能全部未提交改动，无业务/权限/API改动，无提交推送。
已修复：1.销售行旧子元素类无CSS，复用document-line标题/动作/金额/删除样式；2.320px角色说明180px超出157px容器与按钮重叠，修复标题组换行及内文收缩；3.财务期间按钮多余内边距和底边线；4.业绩/流水数字表头明细合计统一numeric。
验证：336页面初扫无页面溢出/纯色对比度告警，截图人工复核发现上述局部问题。5173连旧4280缺cash接口，独立/tmp/erp-style-*数据库副本4288+Vite5174复验，原服务及数据库未改。Chromium/WebKit角色+开单共96组合PASS；最终财务72组合PASS无错误提示。相关Chromium6+最终财务2、WebKit4项E2E全部PASS。最终npm build、cargo build -p easy-erp-server、Sales.tsx Prettier、git diff --check PASS。
一次补充截图在并行构建时等登录5秒超时，非通过证据；后续双浏览器布局和财务脚本完成。证据/tmp/erp-style-*.log及tmp/style-layout-*、tmp/style-finance-after-*。模拟视口非真实软键盘验收，不宣称覆盖全部业务状态。
Self-review与本轮Acceptance PASS：局部修复、复用现有样式、保留前轮改动、验证已执行。已停止本轮自有4288/5174；下一步交付四项发现/修正与验证范围，本轮无待执行修复。后文性能遗留限制仍有效。

## Task / Objective
用户要求根据10万/30万压测出优化方案，评审没问题直接执行。本轮方案已实施、代码评审通过、完整复测结束；全部性能目标仍有缺口，不能宣称大库全站达标。本轮未提交推送。

## Current Phase
DELIVERY：实现和验证收尾完成。性能总体不能标全部PASS：财务浏览器首屏10万3.097s/30万3.962s，超过方案3秒目标；完整管理历史引用和全文搜索仍慢。
执行Direct，不派子代理；Claude CLI只读评审。方案、基线和复测报告分别为docs/性能优化方案-20261011.md、性能测试-20261011.md、性能优化复测-20261011.md。

## Implemented
- query_indexes_v1索引迁移、sales_reporting覆盖索引、退货/收款/排序索引；列表与审计动态条件、先分页ID。
- 业务catalog?options=true不扫历史；管理完整引用统计，删除事务内按ID早停检查，部门成员一次映射。
- LEDGER_CTE批量收款/退货行credit聚合；财务和工作台保留整数金额与历史快照，今日所有状态计数、完整单只取6张。
- /sales/cash服务端50条分页、完整筛选总额和导出、finance.read鉴权；旧finance默认全量entries兼容，页面显式entries=false。
- 备份分批校验、流式下载、16GiB安全上限/ZIP64/空间预检；恢复安全备份/事务/注销会话保留；旧备份兼容；空/NULL单据ID拒绝。
- desktop启动等待10分钟，升级前备份HTTP总等待30分钟、连接5秒；日志写stderr恢复离线CLI纯JSON契约。
- performance.py/browser脚本及性能回归E2E，真实恢复/下载hash/16表指纹/资源采样。

## Constraints
保持SQLite、金额/退货/历史/权限、每小时备份和保留天数；不新增成本或业绩目标、不删历史、不用过期金额缓存。
只有独立tmp/performance-*合成库被写；原4280/4290/5173/5500/8912业务服务不动。自有4297/4298/4289均无监听。
规模为销售单数量，每单3行，固定1万物料/1000客户，无照片。不得外推十万物料、持续多用户或生产SLA。
Cargo绝对路径/Users/apple/.cargo/bin/cargo。每条用户可见回复遵守CLAUDE.md加载标记。

## Reviews / Tests
Claude主实现最终静态PASS：/tmp/erp-perf-final-review.json；补充最终PASS：/tmp/erp-perf-supplement-recheck.json；最终日志修正静态PASS：/tmp/erp-perf-logfix-review.json。
首轮B1–B11阻断已修正；补充NOT READY的默认超时/windowsHide已修，权限/命名/旧索引等推测据完整源码撤回，详见方案。
前端build/TS PASS；Rust服务端7 PASS；最新desktop/lib13 PASS；最终WebKit finance-periods+performance-regressions14 PASS。
Chromium首轮20/19、第二组51/49、后续14/13，分别因fixture缺reason、嵌入旧前端、旧schema夹具残留新索引、CSV全引号兼容而失败；修正后相关复验通过，保留原始日志，不声称首轮全绿。
追加升级控制Node测试首次FAIL：新增日志污染--backup-only stdout，产品日志改stderr后原断言1 PASS（/tmp/erp-perf-desktop-control-recheck.log）。
最后debug/release构建PASS（/tmp/erp-perf-debug-logfix.log、/tmp/erp-perf-release-logfix.log），最后release1000完整恢复烟测及直接CLI纯JSON检查PASS，证据tmp/performance-tljlvndp。
Rustfmt两workspace、Prettier、Python/Node语法及git diff --check通过。界面新增分页/加载/错误/空态/导出按web-design-guidelines专项自查通过。

## Capacity Evidence
原基线tmp/performance-1x8ofii5，HEAD8487721；保留原报告事实。10万/30万财务与工作台45秒超时，浏览器候选/财务45秒未出现；10万备份512MiB限制400，30万60秒上限未完成。
旧30万初始列表40–43秒与后续较快读波动根因未明，不能称42秒稳态。最初tmp/performance-i7s28356造数错误已作废禁止引用。
正式优化三档tmp/performance-322osdy5，主进程exit0，/tmp/erp-perf-optimized-final.log；无并行编译或负载测试。所有API预期状态、金额、并发开单、幂等/超卖、最终库存与完整性检查通过。
- 10万：首页36.78ms/末页38.38ms、候选26.20ms、工作台661.39ms、财务954.68ms；备份24.70s、恢复78.61s。
- 30万：首页77.62ms/末页89.70ms、候选24.37ms、工作台1880.33ms、财务2901.51ms（最大3106.95ms）；完整管理引用26.08s、全文搜索3.33s。
- 30万备份586.34s/ZIP3047522819字节；恢复951.14s、16表fingerprints一致、下载hash正确、会话注销/标记消失；integrity ok、库存差异0、负库存0；RSS峰62.70MiB、目录采样峰14.36GiB。
- 30万混合8并发全部200但最大8.86s，两个并行财务约4.69s，前台开单129.58ms；非持续吞吐。
浏览器10万1.064s/1.405s/3.097s，30万0.961s/1.257s/3.962s（列表/客户候选/财务），无JS异常，截图核对正常。财务首屏目标未达。
旧30万APFS副本升级tmp/performance-upgrade-7fisl2oy：53.946s启动，16表前后hash完全一致、新索引存在、integrity ok。不是完整桌面GUI升级演练。
三档和迁移二进制a109c8c9369f9a425b582d9593f0253cb013c2de930caab1fe3b4962f4b9a5f9；最终二进制4135928f12f3bb306dcc35057e0a8185fe6d79fac263b125f8c6e0f4b9546154，唯一后续服务端差异是日志stdout改stderr，最终1000恢复/CLI烟测PASS，不篡改原容量证据。

## Remaining Limits / Next Action
本轮已授权实施与验证均已执行，无后台测试待收；交付如实说明性能目标部分未达，不标总体容量PASS。
剩余瓶颈为财务首屏及完整历史扫描。只读探针cash关联子查询仅约0.2s收益、双关联更慢；32MiB缓存/temp_store MEMORY无稳定收益，未改产品，证据/tmp/erp-perf-ledger-probe.json、/tmp/erp-perf-temp-probe.json。
16GiB仅安全上限，实测约3GiB；30万现有7天小时备份约477GiB，加工作库和安全余量，本机120GiB空闲不够生产保留。不改既有备份删除策略。
未测照片大库、持续多会话、断电/真实磁盘写满、完整GUI升级或向旧版降级恢复。此轮未提交/推送/跑Actions。上一任务8487721与Actions38121838963成功不能替代本轮验证。

## Last Checkpoint
2026-10-11：最终release和恢复/CLI烟测通过，准备提交用户结果；保留未达性能目标与未提交状态。
