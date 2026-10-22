# Task State

## Task / Objective
用户 /goal：「客户需求全部实现，菜单问题也优化掉，弄好了做一次评审和bug修复，最后确保没问题后全部提交推送发版」
客户需求出自 `docs/客户需求/20261019.md`（已脱敏纳管）。

## Current Phase
TESTING — v0.11.2 待发：下载已有操作提示，等用户决定是否发版。

## Current Step
下载提示已实现并反向验证（见下）。**阻塞镜像**：v0.11.1 没有 GHCR 镜像。

## 下载没有任何操作提示（用户 2026-10-22 反馈，已修）
v0.11.1 把备份下载改成取回再保存，**只在失败时**说话；成功静默。原先指望的横幅
（`App.tsx` 的 `DownloadNotice`）依赖外壳的 `erp:download-finished`，blob 保存不触发，
所以"能下载了"之后界面上什么都没有。报表那边更早一步：还是 `<a download>`，成功和失败都静默。
已修：`src/api.ts` 抽出 `saveFile(path, name)`（取回 → 失败显示服务端原文 → 保存 → 返回文件名），
备份与报表两处都用它，各自在页面上给一句「已下载 <文件名>。」。
**文案不提文件夹** —— 只有外壳知道真实路径，它自己会报。
反向验证：抽掉两处成功提示 → `workflows.spec.ts:388` 与 `report-schedule.spec.ts:221` 立刻红；
恢复后两条绿。报表下载顺带补了 403 原文可见的断言（它没有 local() 守卫，但权限 403 一样会有）。
其余导出链接（模板/导出 CSV/Excel，6 处 `<a download>`）**没动**：只有 backup.rs 的路由带
host-only 守卫，导出端点不会出现"看不见的 403"，浏览器和外壳各自会提示。

## v0.11.1 没有容器镜像：同一个坑第三次
根因还是教训 1：35d11c1 只改 `tests/**`，不在 `server-image.yml` 的 paths 过滤里，
**push 没有构建 `sha-35d11c1`**。release 事件下只跑 `version` 作业（它只给已有镜像打标签，
不构建），所以 `sha-35d11c1...: not found` 直接失败。
修法两步，**已补齐**：① `--ref v0.11.1` dispatch 构建 `sha-35d11c1`（run 39765477760 绿，
sqlite/mysql/s3 全过，delete-items 这次正常）；② `release_tag=v0.11.1` dispatch 打标签
（run 39769605214 绿）。`ghcr.io/7link-team/easy-erp-server:v0.11.1` 现在是双架构 manifest list。
**发版流程缺一道闸**：打标签前没有任何东西强制"该 SHA 必须已有镜像"，这坑是第三次。

## delete-items 是偶发，不是阻塞（已重新分类）
第一次 dispatch（39744936814）挂在 `delete-items.spec.ts:3`：删除后按 `q=<物料id>` 查审计
只返回「新增物料」。但 6196650 上同一作业**绿**，`delete_item` 的审计写在同一事务里
（inventory.rs:399）不是提交竞态。归入观察名单，同一位置再现才是信号。

## v0.10.0（2026-10-22 00:08Z，标签 72b0281）
周期汇总报告：日/周/月/季/年在期间最后一天按设定时刻生成 Excel 或 PDF，归档到与备份
同一套存储，并发送到企业微信群机器人。标签构建 39693496220 全绿，webkit 222 passed。
核验：23 资产、latest.json=0.10.0 含 4 平台、GHCR v0.10.0（amd64+arm64，复用 sha-72b0281）。

**真实链路由我亲自验过**（不是 worker 自述）：调度器在设定分钟自己触发 → 生成 PDF →
upload_media → 发摘要 → 发文件 → 库里标记 sent；幂等（后续 tick 不重发）；报告数字与
`/api/documents/summary` 逐项一致；webhook 存入后读回是 `****`；传 `****` 提交保留原值。

## 跨平台字体：这条尾巴的真实答案
给 CI 的 cargo test 加 `--nocapture` 后才看到实际结果 —— **测试 ok 并不代表找到了字体**
（那条只打印不断言）。真实情况：Windows=msyh.ttc ✅、macOS=Hiragino ✅、
**Linux=什么都没找到** ⚠️。而 Docker 镜像跑的就是 Linux，所以容器部署里 PDF 本来完全
不可用。已在 Dockerfile 装 `fonts-noto-cjk`，并**实际 docker run 验证**它落在候选表第一条
`/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`（不是靠包名猜）。镜像 +约 40MB。

## 下载为什么三次没修对（根因已确诊）
`backup::download` 有两道闸，**报同一句话**「当前账号没有此操作权限」：
`local(peer, server_mode)`（非回环→403）与 `admin()`（非管理员→403）。
而 e2e **只跑 localhost + 管理员**，是唯一两道都放行的组合 —— 测试断言是真的，
覆盖面有个洞，而那个洞正好是用户的使用方式。
雪上加霜：`<a download>` 碰到错误响应**不显示任何东西**，403 与"按钮坏了"在界面上一样。
已修：下载去掉 local() 只留 admin；两道闸文案区分；下载改成取回再保存并显示服务端原文。
**报表下载没有 local() 守卫**，所以打包应用里报表下载失败是**另一回事**，
靠 v0.11.1 的 `downloads.log` 定位（记 Requested/Finished 的地址、目标路径、成功与否）。

## 观察中的偶发（不要当新问题查）
`queries.spec.ts:1153 筛选取消读取响应正文或收到无效JSON` 在 macos-15-intel + webkit 上
跑满 90s 超时（等 window 上的异步钩子）。本地 webkit 6s 通过，8×CPU 负载下 5/5 通过，
复现不出来。同一位置再现才是信号。

## 两次重复踩的同一类坑（下次必查）
1. **标签必须落在 GHCR 有镜像的那个 SHA 上。**
   v0.4.0：标签落在只改 tests/** 的提交上，paths 过滤不覆盖 → 无镜像。
   v0.10.0：我 `--amend` 改了提交信息，**amend 生成新 SHA**，推到 main 的是 amend 前的，
   标签却指向 amend 后的 → `sha-xxx: not found`，已发布版本拉不到镜像。
   **打标签前必须 `git rev-parse v<tag>` 与 `origin/main` 对齐，并确认该 SHA 有镜像。**
2. **「检查通过」≠「东西是对的」，今天栽了四次**：grep 读二进制不加 `-a` 全返回 0；
   把 `tail` 的退出码当成 cargo 的；`grep` 无匹配 + `pipefail` 当成测试失败；
   cargo 默认吞掉 `eprintln!` 导致 ok 没有信息量。**先验证过滤器/输出本身。**
3. 测试脚手架的端口是「先占后放再交给子进程」，并发启动会撞车（完整 cargo test 约 1/4
   概率红）。已只对端口冲突重试；数据目录锁冲突仍立刻失败。


## Current Step
无。

## v0.9.0 已完成（均已独立验收，非 worker 自述）
- 存储可配置：storage.json（0600、不进备份、环境变量优先）、保存前真实往返探测、
  OSS/MinIO/AWS 预设与中文错配提示、子目录强制（纯空格/斜杠也算空）、留空密钥沿用已存值
- **逐对象私有化**：自签 SigV4 `PUT ?acl`，不引 OSS SDK（走 S3 兼容接口，三家都覆盖）。
  **在用户真桶上双向验证**：带 ACL 匿名读被拒；改成空操作后匿名读成功
- **公开桶拒绝保存**：匿名试读探测。用户生产桶 sevenlink 实测是公开可读的，已被挡住
- 备份带全量配置（含凭据，用户决定，见 decisions.md）、恢复前显示目标库/桶、
  **旧备份仍可恢复**（去掉 `#[serde(default)]` 反向验证过 —— 与上一版事故同一机制）
- 备份可降频/可关：1–168 小时或仅手动；间隔校验只在 automatic 为真时生效（根因侧）
- 启动器四步步骤器 + launcher.spec.ts（9 例）；替换 desktop-recovery 的 2 个旧用例，
  等价覆盖逐条核对后才删
- 清点真 bug：确认前先保存屏幕上的数量（反向验证过）
- restore_preview 不再整包预处理

## 血的教训（会再犯，记下来）
1. `with_default_headers` 加的头在**签名之后**，OSS 以 `HeadersNotSigned` 403。
   本地假端点不校验签名 → **任何测试都抓不到**。真桶验证救回一次会上线的事故。
2. 凭据门控的测试必须**显式打印跳过原因**，否则 CI 里永远 ok 却什么都没测。
3. 推送前要跑 `checks` 作业的**每一步**（`cargo fmt --check` / node 测试），不是只跑 cargo test。
4. 检查脚本本身会骗人，今天三次：`grep` 不加 `-a` 读二进制全 0；把 `tail` 的退出码当 cargo 的；
   `grep` 无匹配 + `pipefail` 被当成测试失败。**先验证过滤器**。
5. `page.request` 与页面共用 cookie 罐：用它登录别的账号会顶掉页面会话。

## 待用户决定（未获批不要做）
- **C 方案附件那半**：C″（已做：降频+可关）还是 C′（每小时但附件本地缓存）。默认停在 C″。
  注意：`validate_database` 拒收仍指向外部的归档，所以"小时包只备数据库"会不可恢复。
- **托盘切换主机加确认框**：我提过建议，用户未选，**不得自行实现**。
- 定时通知报告（调度 + PDF/Excel + 企业微信/钉钉 + 报告归档进备份）→ 已定拆 v0.10.0。

## 提醒用户的安全事项
用户在对话里贴过真实 OSS 生产密钥（已用于验证，未写入任何文件/夹具/提交/日志）。
**需轮换**；桶 sevenlink **需设为私有**（逐对象 ACL 只保护本应用写入的文件）。

## 更正：启动器并非零覆盖（我判断错过，已向用户更正）
`tests/e2e/desktop-recovery.spec.ts:11` 用 `page.route("http://desktop.test/**")` 加载
`desktop/ui/{index.html,app.js,style.css}`，339 行起有 3 个用例断言初始化路径的 DOM。
我两次说过「启动器零自动化覆盖」，是错的。步骤器会打破这 3 个用例 —— 处理方式：
launcher worker 先在 launcher.spec.ts 里补齐**等价行为**覆盖（不是旧 DOM id），
我逐条对照后**由我**删除 desktop-recovery.spec.ts 里那 3 个；少一条就不删对应的旧用例。
删测试这道闸归我，不外包。

## 契约缺口（我自己的，待 codex 交回后补）
首次运行时还没有管理员，用不了需要鉴权的 PUT /api/storage。存储配置必须照
`--configure-database` 的既有机制加一个 `--configure-storage`（服务端校验+探测+落盘）。
我给 codex 的任务里只写了 HTTP 接口，漏了这个。**不要并发改 crates/server**，等它交回我补。

**第二个缺口：对象 ACL 必须私有**（用户要求，备份也要能存 S3/OSS）。object_store 0.12 的
aws 后端不暴露 per-object ACL，但 `ClientOptions::with_default_headers`
（client/mod.rs:432）可以给所有请求挂 `x-amz-acl: private`，阿里云 OSS 同样认这个头。
另外在 PUT 的往返探测里加一步：对探针对象做一次**匿名** GET，若返回 200 说明桶是公开可读的，
必须拒绝并提示用户把桶改成私有 —— 单靠请求头保证不了一个本来就公开的桶。

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
2026-10-22 v0.10.0 已发布、镜像标签补齐并核验完成。

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
