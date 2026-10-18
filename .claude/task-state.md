# Task State

## Task / Objective
对 v0.2.4 现有功能做代码/功能/e2e 评审，修掉真 bug，再排查一次，然后发版。
用户原话：「对现有功能做一次代码、功能和e2e 评审，看下有没有bug」→「全部处理掉后再排查一次，
主要是修真bug」→「合并到主分支 提交推送」→「发个 v0.2.5」→「直接发正式版」。

## Current Phase
COMPLETE — v0.2.5 已正式发布并核验。

## Delivered
- 两轮评审：28 项产品缺陷 + 5 项 e2e 弱点。25 项修复，3 项有理由地不改（见下）。
- 第二轮查出 12 项**自引入**缺陷，全部修掉。其中 3 项会出事：
  s3 job 缺 npm build 导致编译不过且 gate 住 build（镜像永远构建不出）；
  删除导入预览破坏 commit 重放（重试得 500 → 操作员重导 = 第二批数据）；
  policy.json 损坏时回退默认 7 天会被写回并驱动 prune（不可逆删除真实备份）。
- 用户自报的安装问题：更新安装与服务退出竞态（Windows 文件占用），已修（等停止应答 + 重试 3 次）。
- 既有并发缺陷：create() 的活库写入未走 writes 锁，后台备份可让用户保存失败（517
  SQLITE_BUSY_SNAPSHOT，busy_timeout 不重试）。已修并经 CI 实证。
- S3 存储后端此前**从未真正测过**（缺环境变量即 return，永远报绿）。现有真实 CI 覆盖，
  且 ERP_REQUIRE_MYSQL/ERP_REQUIRE_S3 使缺端点时大声失败而非静默跳过。

## Deliberately NOT changed（已向用户说明理由）
- C3 符号链接「影响面过大」：object_store 以 follow_links 列举，pre-walk 是唯一屏障；
  改 skip 反而让符号链接归档进入删除路径。保持报错，注释写明是故意的。
- C4 只读列表创建目录：收益极小且引入 S3 标签错误，已撤回。
- C12 备份包真实性（SHA 与数据库同在一个 ZIP；校验链放行 role='admin'）：不加 MAC
  （会让现存备份无法验证且需「旧包放行」后门），只在 README 写明信任边界。
  **共享 S3 prefix / 网络盘 / 云同步目录下这是真实风险，需单独决策。**
- E 类子阈值 9 项中除 E2（反代限流，已做成 ERP_TRUSTED_PROXY opt-in）外未动。

## Published
- origin/main = 06d9c70。
- Release v0.2.5 正式发布（draft=false, prerelease=false），GitHub latest = v0.2.5。
  23 个资产；SHA256SUMS 22 条与 GitHub 侧 digest 逐条比对 22/22 一致（须用 release ID 查，
  草稿按 tag 查会 404 —— 第一次比对因此空转，已更正重做）。
  公开匿名 releases/latest/download/latest.json：version=0.2.5、四平台齐全、签名齐全。
- 镜像：release 事件触发 version job（39145143736）成功，「只加标签不重新构建」，
  已验证的 06d9c70 SHA 镜像被标为 v0.2.5；其余 job 正确 skipped。
- 标签触发的重复构建 39143932574 已取消（避免重复打包且不复用已验证产物）。

## Verification
- Build and release 39141553318 SUCCESS：四平台桌面产物 / android / ios-sim / web /
  checks(windows+ubuntu) / e2e chromium / e2e webkit。
- Server container 39141553224 SUCCESS：sqlite / s3 / mysql / 双架构 build / publish。
- sqlite job 日志中 code: 517 与 database is locked **0 次**，e2e 180 passed
  （修复前一轮为 179/1 且日志有 517）。
- 本地：chromium 180/180、webkit 180/180、MySQL e2e 57/57、17 单元 + 11 集成
  （ERP_REQUIRE_* 置位证明 MySQL/S3 真实执行）、desktop 18、fmt 干净、clippy 与基线一致 6/1/1。
- 关键守卫做过反向验证（放开修复 → 测试必须失败）：A1 用量预检、A2 大小写、ERP_REQUIRE_S3。

## Known Issues / 未验证
- **安装修复未经实机验证**：macOS 复现不了 Windows 文件占用；更新类 e2e 在 JS 层打桩
  invoke("install_update")，不进 Rust。需用户在 Windows 实装 v0.2.5 确认。仍报错时要安装器错误原文。
- S3 实测为 moto 兼容端点，非真实 AWS/MinIO。
- 桌面层运行时行为（代理挂起、UAC 安装包替换、浏览器选择框、窗口 label 竞态）无自动化覆盖。
- webkit 的 update.spec.ts:60 在 08acbdf 上抖动过一次（179/180），06d9c70 上通过；
  若再次出现应按真问题查，不要靠重跑。

## 用户环境（本会话产生，需知悉）
- :4291 服务：现由 build-artifacts/service/easy-erp-server（从 main 编的 release 0.2.5）运行。
  数据目录 build-artifacts/tmp/desktop-v0.2.1-test，启动已应用 file_storage_v1 迁移。
  启动前的安全副本：build-artifacts/tmp/desktop-v0.2.1-test.pre-0.2.4-20261018-212919（67M，可回滚）。
  **backups/policy.json 当前 keep_days=7；最老归档 10-12，次日起会被自动清理。**
  要保留须在备份页改天数（页面会同时写文件+数据库+审计）。
- Playwright：本次新装 webkit；安装 webkit 时 playwright 清掉了 chromium，已重装，现两者齐备。
- 一个 10-10 起运行的 vite 进程占着 5173（非本会话启动，未动）。
- MySQL 测试容器 easy-erp-mysql-check 已恢复 Exited；moto 容器已删除；临时库已 DROP。

## Next Action
无代码待办。等用户在 Windows 实装 v0.2.5 验证安装修复。
若 C12 需要处理（共享存储场景），作为独立任务单独设计。

## Last Checkpoint
2026-10-18 v0.2.5 正式发布、公开清单及 GHCR 版本镜像均核验完成。
