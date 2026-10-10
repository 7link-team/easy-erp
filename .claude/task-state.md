# Task State

## Task / Objective
2026-10-10：改进开单逐行选料、超库存即时反馈、可维护下拉弹窗新增及表单固定操作区。用户已授权此前工作全部提交推送；本轮承接其连续反馈。

## Current Phase
ACCEPTANCE — PASS

## Execution Mode
Direct：共享控件和销售表单紧密关联，无子代理。

## Completed Work
- 明细末尾“添加一行”，新行搜索选择物料，带出规格/单位/库存，自动聚焦数量；保留前面已填行，禁止重复选入与清点锁定物料。
- 超库存即时行内提示；确认前聚焦并拦截，允许草稿；已确认单修订按当前库存加原单数量计算可开上限。items 支持最多 50 个 ids 查询，旧单按批加载库存。
- 客户/部门/业务员/账户下拉末项采用分隔线、浅色底、统一 + 图标；复用 ConfigForm 弹窗新增，成功自动选择，父表单保持；沿用权限，移除独立快速新增客户按钮。
- 最终表单操作使用 form-footer，分页保持普通布局；开单标题/返回及底部操作固定，仅字段区滚动；清点表单合并最终操作区。
- 修复嵌套弹窗冒泡提交父表单，以及 Radix 新选项注册导致账户值清空；恢复原必填校验 alert 语义，新增库存即时提示使用 polite。

## Important Decisions / Constraints
- 用户最终确认列表底部逐行添加；不采用固定页脚添加物料或独立批量选料弹窗。
- 字典仍可手输；固定业务枚举与纯筛选不增加创建入口；新增部门、业务员、账户限管理员。
- 保留 tmp/ 演示数据库与独立预览；不合并、不发 Release，不提交报告/截图/缓存。
- .claude/skills/web-design-guidelines 已读取，最新远端规则已抓取；审核本次变更，不宣称旧应用全面无障碍达标。

## Verification
- 最终 npm run build、cargo build --locked -p easy-erp-server、npm run typecheck:e2e：PASS。
- Rust 6 项、Node 6 项：PASS。
- Chromium：ui / sales / workflows 相关回归 39 项 PASS，清点搜索等待修正后独立补测 1 项 PASS，全部 40 个场景通过。
- WebKit：最终 ui / sales / workflows 40 项 PASS（4.6m）。覆盖 11 行继续添加、库存超额/草稿/修订、嵌套新增、角色权限、长弹窗及窄屏。
- 18 组屏宽 × 主题 × 字号的表单/创建下拉对比度与溢出抽查：0 发现；最终桌面/手机截图已查看，自动检查跳过渐变背景。
- 最新预览实际浏览器登录、ids 查询存在/不存在物料：PASS；git diff --check 与暂存检查：PASS。
- 初轮必填错误 role 回归已修复；清点分页测试原先在搜索刷新时点击，trace 证实未发第 2 页请求，现等待目标响应，保留所有业务断言，双浏览器补验通过。

## Self-Review / Acceptance
PASS：范围、既有控件复用、架构、复杂度、相关回归、交付文件卫生与需求验收。
用户要求逐行就地填写、超库存可见提示、相关资料弹窗新增保留输入、统一下拉新增视觉、最终操作常显均已验证。
Guidelines 变更审查：src/pages/Sales.tsx、src/ui.tsx、src/components.tsx、src/controls.css、src/sales.css 的新增交互通过标签、错误关联、键盘焦点、标题层级、主题与布局检查；不宣称全站无障碍认证。
真实 iOS 软键盘未做实体设备验证，沿用现有 visualViewport 适配。

## Preview
5173 Vite → 4280，数据 /tmp/erp-live；4280 已重启载入新构建，PID 52351。
4290 数据 tmp/demo-sales-tk87dgiu、8912 原型保留。

## Delivery / Next Action
实现、测试与验收无剩余事项。交付文件显式暂存，排除 tmp、数据、报告和截图；与本状态一起提交推送 feat/sales-and-receivables，提交号及远端同步以 Git 为准。
用户刷新 5173 即可体验；不需要新的产品决策或确认。SSH 22 不通时使用 ssh.github.com:443 + HostKeyAlias=github.com。

## Last Checkpoint
2026-10-10：双浏览器相关场景全部通过，最新本地预览登录及库存查询验证完成，自审与验收 PASS。
