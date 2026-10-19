# Task State

## Task / Objective
评审 Codex 的改动，按用户指示撤掉危险操作密码要求，保留其余四项，然后发版。
用户原话：「刚刚让codex 做了一些优化，你评审下没问题就提交推送发版？」→ 评审发现问题 →
「那就不要输入密码吧？」→ 选择「全部撤掉」。

## Current Phase
IMPLEMENTATION — 已分组提交，待版本号与推送发版。

## 评审结论（为何不能原样发）
- 全量 e2e 2 失败 → CI 的 sqlite job 会挂 → build 被 gate → 出不了镜像。
  Codex 只跑了聚焦子集（自述 65/67 与 10/10），没跑过全量 189。
- 一个安全测试变成不可能失败：recovery.rs 的符号链接测试 fixture 是假库，
  认证前置后卡在认证、走不到守卫。**产品守卫没坏**（我用真库+正确凭据实测：
  exit=1「不是普通目录，已停止维护」，外部文件完好），只是测试空转。
- 账号库损坏时离线维护连 reset 都执行不了，而离线维护的用途正是救坏库（实测确认）。
- 可逆的「停用」被当成删除：弹「即将执行删除或覆盖操作」并要求密码，而反向的「启用」免密。
- 两项安全声明无测试：非管理员不能覆盖恢复、429 限流。
- ERP_STORAGE_LOCAL_DIR 指向不存在目录会让桌面端起不来（服务端容错，桌面端致命）。

## 评审中查实为良好的部分（撤销时予以保留或承认）
- 7 个危险端点在 api.ts 集中拦截，无漏网调用点（穷举：5 个 DELETE + 1 个 restore，
  api() 外无 fetch）。设计比逐点加 header 稳。
- macOS 迁移不可能丢数据：renamex_np(RENAME_EXCL) + 持旧目录 server.lock 独占锁，
  无 copy / 无 plain-rename 回退；跨卷与符号链接一律干净拒绝。
- 没有凭据泄漏（diagnostics 白名单）、密码不进日志、客户端兼容性无风险
  （客户端加载服务端下发的 UI，外壳自身不调 DELETE）。
- 12 个被改 spec 无一处放宽断言；角色 fixture 送的是各自账号密码，实际更强。

## Delivered（本轮）
撤掉：protect_destructive/verify_password 中间件、CLI authenticate 与
--verify-recovery-password、maintenance_database、前端密码弹窗与 api.ts 拦截、
启动器密码表单、destructive-auth.spec.ts、以及 9 个纯密码 spec 改动。
保留：system-info（含非管理员 403 测试）、macOS ~/.EasyERP 与原子迁移、
路径排版、维护关闭返回导航，以及强提醒 + 确认短语 + 二次目标复核（默认停在取消）。
顺带：收掉 Codex 引入的 1 条 desktop clippy；补回被我回退时带走的 system-info 403 断言。
完整密码方案保存在分支 codex/destructive-auth-full (f0562bd)，可随时取回。

## Verification
- server：fmt 干净、clippy 基线 8、17 单元 + 11 集成。
- desktop：fmt 干净、clippy 基线 1、25 测试（含 5 个 macOS 迁移用例）。
- 前端：tsc、e2e tsc、构建通过。
- e2e：chromium **186/186**。
- WebKit 1 条失败（workflows.spec.ts:399，点击 45s 超时）：**本批未改动该文件**，
  且在已发布基线 972b884 上同样失败（实测），当时负载 5.42 且有多个遗留预览进程在跑。
  判定为环境/既有，非本批引入；CI 干净 runner 为权威门禁（v0.2.5 上该 job 为绿）。

## Next Action
版本号 v0.3.0（macOS 数据目录默认位置变更 + 自动迁移属行为变更，不宜叫 patch），
推送 main → 等两条流水线 → 给同一 SHA 打标签 → publish-verified 生成草稿。

## Last Checkpoint
2026-10-19 密码要求已全部撤销并分组提交，待发版。
