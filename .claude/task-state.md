# Task State

## Task / Objective
用户 /goal：「客户需求全部实现，菜单问题也优化掉，弄好了做一次评审和bug修复，最后确保没问题后全部提交推送发版」
客户需求出自 `docs/客户需求/20261019.md`（已脱敏纳管）。

## Current Phase
DONE — v0.8.0 已发布（2026-10-21 02:27Z，标签 db8dc24）。标签构建 39523373792 全绿，
webkit/chromium 各 191 passed（20.2m / 11.3m）。核验：23 资产、latest.json=0.8.0 含 4 平台、
GHCR v0.8.0 digest ef065766（amd64+arm64，不重建）。

## Current Step
无。

## v0.8.0 本轮（用户验收时报的）
1. **删除人员账号**（用户批准的规则）：仅无 documents/sales/stocktakes 记录的账号可删；
   有记录的拒绝并提示改用停用；管理员一律拒绝（与「不能停用管理员」同理，顺带使锁死不可能）。
   审计行保留（各自存有 actor_name，历史可追溯），删除本身进审计，会话随账号删除。
   **反向验证过**：撤掉业务记录守卫，新 e2e 立刻失败。
   注意 FK：库里**没有任何 FK 声明**且 foreign_keys=off，规则必须在应用层强制。
2. **清空全部数据 os error 33**：Windows 把已被占用报成 ERROR_LOCK_VIOLATION(33)/
   SHARING_VIOLATION(32)，Rust 不映射成 WouldBlock → 落兜底分支误报「无法检查本机数据锁」。
   这个检查恰恰在唯一需要它的平台上是坏的。已修 + 单测（desktop 29/29）。
3. **「local 附件位置」**：app.js 把 storage.kind 当文案渲染，改为本地文件/S3 对象存储/旧数据目录。
4. **删掉数据目录却直接进登录**：resume_last 在 Local 模式下若数据目录已不存在则显示启动器，
   不再静默新建空账。**此路径无自动化覆盖**（e2e 跑浏览器，碰不到 Tauri 启动器窗口）。
   只删 .sqlite 但留着目录的情况未处理（MySQL 部署本就没有该文件，不能拿它当判据）。

## 测试踩坑（会再犯，记下来）
`page.request` 与页面**共用 cookie 罐**：用它成功登录别的账号会顶掉页面的管理员会话，
页面随即显示「当前账号没有此操作权限」。需要别的身份就开 `browser.newContext()`。
按钮若有 aria-label，可及名来自 aria-label 而非文字（`删除` 匹配不到 `删除账号：张三`）。

## 本轮修复（用户验收时报的四件）
1. **入库小组消失** —— 条件是 `incoming && teams.length > 0`，一个小组都没建过时整个
   字段隐藏，等于功能在每个新部署上都看不见。改为入库时恒显示，并换成物料表单在用的
   ComboBox，直接输入新名字即登记（走 `options::ensure`，与 spec/kind/unit 同一条路）。
   长度上限 128→100 对齐选项表自身上限，否则 101–128 字会过前一道被后一道拒、且报错
   文案变成「选项名称」。**反向验证过**：撤掉后端那行，新 e2e 立刻失败。
2. **下载完整备份「没反应」** —— 文件一直下载成功，是零反馈。根因在 wry 源码：
   `SetHandled(true)`（WebView2）/ 宿主接管后 WKWebView 同理，引擎不再显示自己的下载
   提示，而应用没有自己的提示。已让壳在 Finished 时 eval 出 `erp:download-finished`，
   前端 DownloadNotice 横幅说明保存位置；失败同样会说话（原先也是静默）。
   **另修测试缺口**：备份包下载此前只断言 href（backup-pagination.spec.ts:72），从未真
   下载过；已在 workflows.spec.ts 补真下载断言 + 提示两个分支。
3. **人员账号找不到改密码/删除** —— 功能一直在，按钮名「修改权限」把它藏了（弹窗里本就
   有重置密码和停用登录）。改名「编辑账号」，弹窗标题「编辑人员账号」。
4. **滚动条** —— 全项目原先零样式，用系统默认。改为标准 scrollbar-width/color 跟随主题；
   刻意不直接写 ::-webkit-scrollbar（那会让 macOS 悬浮滚动条变成常驻占位槽），webkit
   兜底只在 @supports not 里给老引擎。

## 查明「不是 bug」、未改（需用户决定）
- **启动时看不到 MySQL**：启动器 `databaseForm.hidden = configured`（app.js:10），数据库
  表单只在尚未配置时显示，是首次运行专属选择。
- **看不到 S3**：启动器里一处都没有，只认 `ERP_S3_*` 环境变量 —— storage.rs 开头写明
  「凭据绝不进入业务数据和备份」。放进 UI 等于写进库再被备份带走。
- **删除账号**：后端只有 GET/POST /api/users 与 PUT /api/users/{id}，无 DELETE。账号挂着
  出入库与审计痕迹，有意只给停用。要做建议限制为「无业务记录才可删」。
- **Windows 托盘不见**：代码审完是好的 —— setup() 里无条件构建、无平台 cfg 门、
  tray.rgba 5184 字节正好 36×36×4 且自首次提交未变、近期提交未碰托盘。macOS 上无法
  复现 Windows 行为，等用户确认是否在托盘溢出区（`^`）、以及是自启后没有还是手动打开也没有。

## 评审发现（6 条，全部自验并修复）
1. **上一版备份全部不可恢复**（最严重，我自己没看到）：backup.rs 的 legacy 候选集合无一个
   去掉 document_teams_v1，上一版 manifest 匹配不上任何候选 → 报「备份数据库版本不同」。
   复算布尔：修复前 False、修复后 True；更早的备份同样受影响。已加第三个 toggle，
   并把 recovery.rs 的 legacy 用例改为同时剥掉 file_storage_v1 与 document_teams_v1。
   **反向验证过**：撤回修复后该测试以用户原话失败。
2. 成本价金额暴露给只有 records.read 的账号 → 汇总端点加要求 items.read，菜单与页面同步。
3. 我的 key 改动让财务面板在同页下钻时重挂 → 整个撤回，见 decisions.md。
4. 小组无创建入口，功能发出去看不见 → 加入 catalogSections / MaterialOptions labels /
   Sales.tsx 四处字段列表；补 e2e「从基础资料建小组」。
5. 只有 sales.read 的账号落在用不了的方向上 → 默认方向按权限取。
6. 导出 PNG 长名串列 → 每列宽度预算 + maxWidth；canvas 失败由静默改为提示。
另修测试假阳性：原「无方向+错日期→400」只需一个原因成立，已拆成两条分别断言。

## Overall Progress
- [x] documents.team 迁移（可移植 alter_table、VARCHAR、has_column+has_index 双幂等）
- [x] 4 处位置式 INSERT 改显式列名（否则加列会运行时炸）
- [x] Movement 入参 team + 仅入库可带小组的校验
- [x] 时间区间 from/to（本地日历日 → UTC 毫秒边界，含夏令时处理）
- [x] 关键词覆盖规格与小组名（客户要搜的 7.5×8.5 是规格）
- [x] GET /api/documents/summary：逐款数量+金额、合计总额、按小组分组、排除作废
- [x] period_bound 单测（含拒绝两位年）
- [x] 前端：入库小组选择（Movement.tsx，仅入库显示）
- [x] 汇总页 Summary.tsx + 独立菜单「汇总」（#/summary，归入库存分组）
- [x] 销售汇总 GET /api/sales/summary（按客户 + 合计，任意期间）
- [x] 导出图片（原生 canvas 自绘，零新依赖）
- [x] 库存逐款金额 —— **本就已有**（Inventory.tsx 的「库存金额（元）」列），未重复造
- [x] 菜单：三个财务菜单原共用一个挂载实例（key 都映射成 "finance"），已改为各自独立
- [x] 全量 e2e：chromium 全绿；webkit 188/189，唯一失败已定位并修复
- [x] 评审发现修复 → 提交推送
- [x] v0.6.0 标签构建全绿 → publish-verified 建草稿 → 发布 → 镜像挂 v0.6.0 标签

## 已实测（真服务端 + 真数据，非推演）
螺丝 2+3=5 × ¥10 → value 50.00；垫片 4 × ¥2.5 → 10.00；**total_value 60.00**
按小组：小组一 50.00 / 小组二 10.00；小组筛选、规格关键字 `7.5×8.5`、方向、
时间区间、非法日期报错 —— 全部符合预期。
作废排除：60 → 130（加小组三 70）→ 作废 → 回到 60，小组三消失。

## Important Decisions
- 数量和单价**绝不合计**（客户原话：品不一样，累加了没意思），只合计金额。
- 金额复用 `stock_value` + `optional_price`，与库存页同一口径，避免两屏数字不一致。
- 未定价物料不计入总额，单独报 `unpriced_items`（与库存页一致）。
- 列表与汇总共用 `document_filter` 一份，避免口径分叉。
- team 用 VARCHAR 不用 TEXT：MySQL 不允许 TEXT 带 DEFAULT，也不能无前缀长度建索引。
- 汇总的 API 行为测试放 Playwright e2e（项目既有归属），不另造 Rust 夹具。

## 一菜单一页面：做到哪、为何停在这
用户可观察的三件事：①每个菜单有独立地址 ✓（原本就有）②各自显示自己的内容 ✓（原本就有）
③切菜单不带上一个菜单的状态 —— **原来是坏的，已修**：`<Sales key>` 把 finance/accounts/
performance 都映射成 "finance"，三个菜单共用同一个挂载实例，筛选/展开面板会串台。
catalog 的固定 key **有意保留**：切换基础资料栏目是同菜单内导航，会让 navigationIndex 自增，
改成动态 key 会导致每次切栏目重挂、丢掉正在编辑的选项（这是我差点引入的回归）。
**未做**：把 FinancePanel 等 ~1100 行从 Sales.tsx 搬成独立文件。属纯重构、用户看不到变化，
且 CustomerLedger/TextField 被两边共用、函数之间还夹着类型定义；不宜在同时带新功能和
数据目录迁移的版本里承担这个回归风险。建议发版后单独做。

## Known Issues / Risks
- 库存总价值（客户需求之一）**早已实现**（inventory_value + unpriced_items），
  缺的是逐款明细的金额列。
- 销售汇总：`/api/sales/finance` 已有客户/业绩维度聚合，是否满足"销售汇总"需确认，
  不要重复造。
- webkit 在 macos-15-intel 上已出现两次单例不复现失败（本次 update.spec.ts:335 已定位
  为 `fill()` 注入竞态并修复；上一次 sales.spec.ts:1138「返回客户对账」仍未解释，
  9 次本地复现含负载全过）。同一位置再现才是信号，不要当噪声。
- 发版流程坑：标签落在只改 tests/** 或 .github/** 的提交上时，server-image.yml 的
  paths 不覆盖，GHCR 不会有该 SHA 的镜像，publish 后拉取报 `sha-...: not found`。
  打标签前必须确认或手动派发镜像构建（v0.4.0 已踩过一次）。

## Verification
Build: PASS（npm run typecheck、typecheck:e2e 均干净，无 tsc 散落产物）
Tests: 标签构建 39406369784 —— chromium e2e PASS；webkit 188/189（已修）；
       其余作业全部 PASS。修复后本地 webkit 该用例 5/5 PASS。
Other: cargo test 11 集成 + 单测 PASS；手工 API 实测 PASS。

## Last Checkpoint
2026-10-21 v0.8.0 已发布并逐项核验完成。

## Next Action
本轮无待办，工作树干净。等用户回两件：Windows 托盘的现场确认、删除账号要不要做。
未获批不要自行开工：拆 FinancePanel（纯重构，建议单独发版）、日期控件改
`--lang=zh-CN`（WebView2 启动参数，只能在 Windows 验，写错会导致 webview 起不来，
必须先出单项构建给用户试装）、kind=in 是否排除 opening（口径问题）。

## update.spec.ts:335 webkit 偶发失败 —— 已定位并修复
症状：点「刷新页面」后 `.service-update` 整个消失、断言 element not found。
排除：仍在登录态、仍在入库页（非掉线、非导航）；本地孤立 8/8、整文件 18/18、
10×CPU 负载 10/10 全过，共 36 次不复现。
定位方法（可复用）：解包 trace.zip，比对 `frame-snapshot` 条目是否含输入值 ——
通过的本地 trace 有 3 张含值，失败的 CI trace **0 张**（已用 `manager` 作对照
确认 Playwright 确实记录 textarea 实时值）。
结论：`fill()` 的单次程序化赋值被 React 受控输入回填吃掉，`setNote` 从未执行，
`hasChanges`/`dirty` 保持 false，守卫按它看到的「干净表单」正确放行 reload。
**产品无缺陷**；改为 `pressSequentially` 逐字输入 + 填入后立即断言值已落地。
单字符丢失不会让字段变空，所以仍能抓到真实的输入丢失缺陷。


## 2026-10-20 当前补充任务：汇总页排版
- 用户要求美化 `4292/#/summary`，金额按「入库、当前库存、出库、销售」排序。
- 直接执行，仅修改 Summary.tsx / style.css；保留已有未提交的后端及测试修改。
- 已拆分筛选、金额、明细区域，增加筛选标签、库存快照说明、小组金额独立排列。
- npm run build PASS。演示服务使用 debug-embed，需重编译并原参数重启才能查看新版。
- 完成：cargo build PASS；4292 已按原数据目录 /tmp/erp-demo 重启，新版原地址实测通过。
- 浏览器验收 PASS：1440px / 390px，无页面横向溢出；金额顺序、小组筛选、方向切换、空搜索、PNG 导出。
- 现有测试：npm run test:e2e -- tests/e2e/summary.spec.ts -g 期间汇总逐款，1 passed。
- 自评审与需求验收 PASS：复用控件及主题，无新增依赖，业务计算未改；本次任务无待办，未提交。
