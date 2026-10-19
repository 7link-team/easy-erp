# Task State

## Task / Objective
发正式 v0.3.0 前清掉两个阻塞项。用户原话：
「那不行 要修一下，不能一直这样， 处理好发正式0。3」（e2e 抖动）
「打包本地应用运行的时候 下载备份包没反应， 不知道还有没有其他类似问题 排查下」
已确认排期（用户「可以 youcall」）：0.3 = ①抖动 ②下载；0.4 = 一菜单一页面 + 客户新需求。

## Current Phase
REVIEW — 两项修复已落地并通过双浏览器全量回归，待提交推送发版。

## Current Step
按两组提交（playwright 余量 / 桌面下载）并推 main。

## Overall Progress
- [x] ① e2e 抖动根因定位 + 修复
- [x] ② 桌面下载根因定位 + 修复 + 单元测试
- [x] 双浏览器 e2e 回归（在含前端改动的重建产物上跑）
- [ ] 提交推送 → 两条流水线 → 打标签 → publish-verified 发正式 0.3.0

## ① e2e 抖动：根因与修复
**不是产品 bug，是套件时序临界。** 实测证据：
- 单测 ×3 unloaded 全过，耗时 10.9–15.4s；
- 人为加压（load avg 27，24 路 yes）再跑 ×4 全过，但耗时涨到 **32.1s**，上限只有 45s。
- CI 的 `queries.spec.ts` 报 `toHaveCount(3)` 实收 **50**（正好整页）= 断言 5s 预算
  用尽时页面还停在筛选前状态；`workflows.spec.ts:399` 在**已发布基线 972b884 上同样失败**，
  佐证是环境而非代码回归。
排除项（均已实证，勿重查）：`useQueryValue` 的 erp:navigate 覆盖缺触发源（`address()`
保留 location.search）；`useResource` 按依赖中止且有 aborted 守卫，无响应乱序；
`Input` 是透传受控组件；审计列表 `ORDER BY created_at DESC,id` + 配套索引，排序确定。
**修复**：playwright.config.ts 给出真实余量 —— timeout 45s→90s、
新增 expect.timeout 20s（原为 Playwright 默认 5s）、webServer.timeout 30s→120s。
未加 retries（会掩盖真 bug，且共享 SQLite 下重试脏库）。抬等待不改变任何断言强度。

## ② 桌面下载：根因与修复
**根因在 wry 源码层证实**：`wry-0.57.0/src/wkwebview/navigation.rs:96-101` —
未注册 download handler 时，`canShowMIMEType()` 为 false 的响应（zip/xlsx）直接走
`Allow`，WKWebView 允许一个自己渲染不了的导航 → 界面上毫无反应。
desktop/src/desktop.rs 全仓只有**一个** WebviewWindowBuilder（:220），一处修复覆盖
7 个下载入口（备份 1 + 导出 5 + 模板 1，均为同窗 `<a href>`，无 target/download 属性）。
**修复**：挂 `.on_download`，保留平台已解析好的目标（下载文件夹 + 服务端
Content-Disposition 给的权威文件名，支持中文），只补 wry 缺的那道防线 ——
`download_destination()`：目标父目录不是下载目录时降级为末段文件名，重名编号不覆盖。
（wry `push(&suggested_filename)` 无任何清洗，这是信任边界。）

## Known Issues / Risks
- ~~第 8 个入口~~ **已修**：销售附件预览改为页面内浮层（用户选择应用内，不走外部浏览器）。
  见 decisions.md「销售附件改为应用内预览」。`on_new_window` 加固未动。
- `delete-items.spec.ts:44`（审计 page-1 断言）**未复现、无根因，且抬超时救不了它**
  （断言的是 API 返回，不是 UI）。已逐条排除，勿重查：
  ①排序并列 —— `now()` 是毫秒精度，`ORDER BY created_at DESC,id` 且有配套索引；
  ②乐观 UI —— Inventory 删除是 `await send()` 之后才 refresh，不提前移除行；
  ③审计写入竞态 —— `inventory.rs:395` 审计与 DELETE 同事务，响应返回前已提交。
  因此该审计行必然是最新行、必然在 page 1。只出现一次，若 CI 再现需要 trace 与
  实际报错文本（上次 artifact 只有页面快照），而不是继续猜。
- `desktop/src/desktop.rs:924` 一条既有 clippy collapsible_if（新版 clippy 1.99 收紧，
  非本批引入）。CI 不跑 clippy（只有 cargo test），不影响发版。
- `on_download` 实际触发只在源码层证实，**未在打包 GUI 中人工点击验证**（无头环境做不到）。

## Verification
- desktop：fmt 干净、`cargo test` **26 PASS**（含新增 download_destination 用例）。
- 前端：`typecheck` / `typecheck:e2e` / `vite build` / `prettier --check` 全 PASS。
- e2e chromium：**186/186 PASS**（16.6m）
- e2e webkit：**186/186 PASS**（25.8m）
  两者均在 `vite build` + 重编服务端之后跑，验的是含前端 `download` 属性的最终产物。
- 服务端：本批未改动任何 server 源文件，未跑（如实记录，非遗漏）。
- **局限**：本地绿只是必要条件。抬余量是基于实测耗时的推断修复，
  抖动是否真的消除以 CI 干净 runner 为权威判据。
  `on_download` 只在 wry 源码层证实，**未在打包 GUI 中人工点击验证**（无头环境做不到）。

## Next Action
分三组提交（playwright 余量 / 桌面下载 / 本状态文件），推 main，等 Build and release 与
Server container 两条流水线，对同一 SHA 打 v0.3.0 标签，由 publish-verified 出正式版。
版本号无需再改：b7ccecb 已是 chore(release): v0.3.0，尚未打标签。

## Last Checkpoint
2026-10-19 两项修复完成，双浏览器全量 e2e 各 186/186，待提交推送发 0.3.0。

## 0.4 待办（用户已确认排期）
③ 一菜单一页面拆分：invoice/sales/finance/accounts/performance/returns/customers/catalog
   目前全部经 salesView 开关渲染同一个 Sales 组件。
④ 客户新需求 `docs/客户需求/20261019.md`（已脱敏并纳管）：库存总价值汇总
   （注意 Inventory.tsx:408 已有总价值）、按期间的库存/销售汇总与合计、入库加「小组」
   字段（需迁移）、关键词+日期区间+方向筛选、导出为图片、云备份（v0.2.4 的 S3 已实现）。
⑤ 可选：e2e 并行化（需每 worker 独立服务端与库，否则重现脏库事故）。
