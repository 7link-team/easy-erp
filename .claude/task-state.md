# Task State

## Task / Objective
修复 2026-10-18 代码/功能/e2e 评审确认的 28 项产品缺陷中的 27 项（C12 待用户决策），
并强化 5 项 e2e 测试弱点 + 升级 E2（反代限流）。完成后再做一次排查复核。
用户原话：「全部处理掉后再排查一次，主要是修真bug」。

## Current Phase
ACCEPTANCE — 修复与第二轮排查完成，等用户决定是否提交

## Current Step
全部完成。chromium 180/180、webkit 180/180（均为最终代码）。未提交。

## Branch
fix/review-findings-v024（基于 main @241aa68，工作树原本干净）

## Confirmed Constraints
- 只修真 bug，不做未授权的重构/美化/抽象。
- 禁止碰用户在用服务 :4291 及其数据库 build-artifacts/tmp/desktop-v0.2.1-test/inventory.sqlite。
- MySQL 实证用 docker 容器 easy-erp-mysql-check（root/Local-test-2026，宿主端口 43306），
  用完必须 DROP 临时库并把容器恢复 Exited 状态。
- 评审原始报告在 build-artifacts/tmp/review-{core,infra,web,desktop}.md（gitignore 内）。
- e2e 用隔离临时数据目录（playwright.config.ts 自动 mkdtemp），端口 4289。

## Important Decisions
- A2：三个 LIKE 列改 UPPER(col) LIKE UPPER(?)；barcode=? 保持精确匹配不加 UPPER
  （前导通配本就全表扫，加 UPPER 零代价；改 collation 会动到依赖 utf8mb4_bin 的唯一索引语义）。
- A3：改 schema 加宽（新迁移），不砍 app 500 字限制；并对账所有 clean(..., >255, ...) 与列类型。
  理由：砍限制只治症状，SQLite 存的长原因恢复进 MySQL 仍失败。
- D1：照 server-image.yml:62-96 的 MySQL job 模式，为 S3 加 moto 服务。
- E2：XFF 支持做成显式 opt-in，未配置时行为不变。
- C12（备份包真实性）：**暂缓，已向用户提问**。涉及 keyed MAC 或拒绝非本机归档，
  影响「异地恢复」工作流与现存备份可恢复性，属安全架构+兼容性决策，不自行选定。

## Remaining Work
1. Wave 1：A1（我）/ 前端 A4,A5,B7,C13,C14（子代理）/ 桌面 B2,B3,B4,B6,C10,C11（子代理）
2. Wave 2（我，server）：A2, A3 + clean() 对账
3. Wave 3（我，server）：B1, B5, B8, B9
4. Wave 4（我，server）：C1-C9（含 C7 compose、C8 UTC→local）
5. Wave 5：D2-D5 测试强化、D1 CI moto、E2 XFF opt-in
6. Wave 6：集成验证（cargo test/clippy/fmt、tsc、e2e 双浏览器、MySQL 实证回归）
7. Wave 7：再排查一次（复核本轮改动是否引入新问题 + 原 28 项逐条确认已修）

## Verification
Build: PASS(server+desktop) | server tests: PASS(17 unit + 11 integration)
desktop tests: PASS(18) | fmt: PASS(两个 workspace) | clippy: PASS(与基线一致 6/1/1，无新增)
MySQL 实证: PASS(A2 正反向) | S3 实证: PASS(moto 真实执行，首次) | e2e: RUNNING

## Known Issues / Risks
- A3 的迁移改动既有部署 schema（VARCHAR(255)→TEXT 是安全加宽，但需确认 MySQL 可重跑幂等）。
- C2（恢复后孤立附件）修复需小心：不能把恢复前的合法附件误删。
- C3 把符号链接从「报错」改成「跳过」时，不能放宽 recovery 的既有安全测试
  （clear_backups_never_follows_a_directory_symlink_outside_the_data_directory 必须继续通过）。
- 子代理改前端/桌面，与我改 server 文件无重叠；集成时仍要逐个 diff 复核。

## Completed (verified)
- A1 transfer.rs：MAX_CELLS 用量预检（流式 cells reader，不物化包围盒）+3 单元测试；
  已反向验证（临时放开常量 → 测试失败）。保留原「1–100 行」消息不被抢占。
- A2 inventory.rs：UPPER(col) LIKE UPPER(?)，barcode 保持精确索引匹配；
  MySQL 集成测试加大小写断言，已反向验证（还原修复 → 断言在 wl-case01 失败）。
- A3 sales.rs：操作原因/收退款备注 500→255 对齐 VARCHAR(255)。审计结论：
  仅此两处；documents.note/stocktakes.note 是 TEXT，material_options.note 限 200<255。
  **未做任何迁移、未改 schema。**
- B1 backup.rs：侧车写失败改为 warn 继续（归档已落盘），终止「每分钟一个全量备份且不清理」。
- B5 transfer.rs/recovery.rs：commit 后删除预览、preview 时清理超 1 小时陈旧预览、
  Reset 清空 imports/（经 directory_or_absent 防符号链接）。
- B8 stocktake.rs：取消路径也校验，note 写入 cleaned 值而非原始字段。
- B9 backup.rs：policy.json 损坏改为 warn 并回退默认，不再 400 锁死备份页。

## Wave 4/5 Completed (verified)
- C1 Content-Length、C2 孤立附件（**离线+在线两条路径**，评审只报了离线）、C3 符号链接改跳过
  （安全测试仍通过）、C4 只读列表不建目录、C5 tempdir 仅 s3、C6 README 分片 lifecycle、
  C7 compose session token、C8 单据号改本地时区、C9 登录时清理过期 session。
- E2 反代限流：ERP_TRUSTED_PROXY opt-in（默认行为不变）+ 单元测试（含伪造 XFF 不生效）。
- D1：S3 集成测试此前从未真正执行（缺变量即 return）。已用 moto 真实跑通；
  新增 require_integration()，CI 设 ERP_REQUIRE_INTEGRATION 时缺端点直接失败；
  按本地验证过的配方新增 s3 job（motoserver/moto:5.2.4），build 依赖 [sqlite,mysql,s3]。
- D2 仪表盘逐块金额断言、D3 并发重放去掉掷硬币+补败者重试、D4 zip 恢复回读业务行、
  D5 重复收款断言改读重复请求响应。
- 子代理成果已逐个 diff 复核通过；额外补修 bug4 漏掉的一半（折扣率/抹零同样会报
  不存在的收款字段）。

## Known Issue (需告知用户，已告知)
用户 :4291 服务当前未运行；数据完好（inventory.sqlite 536KB + backups/149 项），
SQLite 为干净关闭特征（wal 0 字节），最后写入 17:05。无法确定停止原因。
重要：target/debug/easy-erp-server 已被本分支重建，恢复该服务不要用当前 debug 产物。

## Wave 7 — 第二轮排查结果（共发现 12 个自引入缺陷，全部已处理）
我自己发现 1 个：ERP_REQUIRE_INTEGRATION 在 mysql job 是 job 级，而该 job 跑整个 test binary
→ S3 测试会在那里 panic 挂掉 mysql job。改为按后端 ERP_REQUIRE_MYSQL/ERP_REQUIRE_S3，三种
CI 场景逐一验证（mysql 场景 S3 正常跳过 / sqlite 场景全跳过 / 缺端点时大声失败）。

子代理 round2 发现 11 个，已逐条核实并修复：
- #1(高) s3 job 编译不过：dist/ 被 gitignore 且 rust-embed 编译期嵌入，两个兄弟 job 都先
  npm ci && npm run build，我的没有 → 且它 gate build，镜像永远构建不出。已补 node+build。
- #2(高) commit 后删除预览破坏重放：读文件(977)在 requests 重放查询(1026)之前，删除后重试
  得 500 而非已记录响应 → 操作员以为失败再导一遍 = 第二批数据。已移除删除，注释改为记录
  为什么不能删；无界增长仍由 1 小时 sweep 解决。**WebKit 全量套件实际捕获了这个回归**
  （reference-transfer「重复确认」报 文件操作失败），修复后该 spec 23/23 通过。
- #3(高) policy.json 损坏时我的回退会被 create() 写回并驱动 prune() → 不可逆删除真实备份。
  已区分 Absent(首次备份正常写入并清理) 与 Damaged(保留全部归档、不写回、不清理)。
- #6 撤回 C3：object_store 以 follow_links 列举，我的 pre-walk 是唯一屏障，改成 skip 反而让
  符号链接归档进入删除路径。恢复为报错，并把「为什么是故意报错」写进注释。原「影响面过大」
  属设计取舍，明确不改。
- #7 throttle_key 只读第一个 XFF 头 → 代理另起一行时客户端伪造值胜出。改 get_all().next_back()，
  并补「两个头」单元测试。
- #4/#5/#8/#10/#11/#9 均已修：离线恢复注释不再暗示有快照、MySQL 恢复路径也清理孤立附件、
  reset 的 imports 清理不再用裸 ? 误报可重试且容忍非目录、审计行改存 cleaned reason、
  撤回 C4（它引入 S3 标签错误而收益极小）、用量超限时优先给准确的「1–100 行」消息。

round2 对最危险改动（恢复后删除外置附件）裁决 SAFE，证据链与我自己的独立复核一致。
前端 5 项与桌面 6 项：round2 判定无缺陷（含确认无 .await 跨 std Mutex、install_update
不会出现「服务已停但无字节」）。

## Verification（Wave 7 后）
clippy 回到基线 6/1/1；17 单元 + 11 集成（MySQL+S3 真实启用）全过；
chromium 之前 180/180；webkit 178/180 → 2 个失败已定位（1 个是 #2 回归，1 个随之恢复），
修复后定向重跑 23/23；最终双浏览器全量套件顺序重跑中。

## Final Verification — PASS
- chromium 180/180 (11.1m)、webkit 180/180 (14.3m)，均跑在包含两轮全部修复的最终代码上。
- MySQL 后端 e2e 57/57；17 单元 + 11 集成（ERP_REQUIRE_MYSQL/S3 均置位，证明真实执行）。
- desktop 18 测试；两个 workspace fmt 干净；clippy 与基线一致 6/1/1，无新增。
- 关键守卫做了反向验证：A1 放开常量→测试失败；A2 还原→MySQL 断言失败；
  ERP_REQUIRE_S3 无端点→大声失败。

## Deliberately NOT changed（已向用户说明理由）
- C3 符号链接「影响面过大」：object_store 以 follow_links 列举，pre-walk 是唯一屏障，
  改 skip 反而让符号链接归档进入删除路径。保持报错，注释写明这是故意的。
- C4 只读列表创建目录：收益极小且引入 S3 标签错误，已撤回。
- C12 备份包真实性：不加 MAC（会使现存备份无法验证且需「旧包放行」后门），
  只在 README 写明信任边界。用户授权「你决定」。
- E 类子阈值 9 项中除 E2 外未动（非 bug）。

## Open items for the user
1. 是否提交（分支 fix/review-findings-v024，26 文件，未提交、未暂存）。
2. :4291 服务未运行（数据完好，17:05 干净关闭特征，原因不明）。
   重启勿用 target/debug/easy-erp-server（已是本分支开发构建）。
3. 本机 Playwright 浏览器：webkit 本次新装；安装 webkit 时 playwright 清掉了 chromium，
   已重装 chromium+webkit，现两者齐备。

## Last Checkpoint
2026-10-18 交付：27/28 项处理完毕 + 12 项自引入缺陷已修 + 双浏览器全绿。

## Last Checkpoint
2026-10-18 开工，分支已建，尚无代码改动。
