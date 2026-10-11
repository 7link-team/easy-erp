# Task State

## Task / Objective
用户要求检查重复功能，去掉单据中的“收款与欠款”等重复页面入口。Direct，无subagent；延续全部提交推送授权，不合并、不发Release。

## Current Phase / Step
ACCEPTANCE / PASS：实现、针对性回归、自查与需求验收完成。交付以包含本文件的最新提交为准。

## Decisions / Scope
- 单据仅保留单据/退货记录/作废记录筛选；财务汇总统一从收款/账户/业绩进入。单据自身应收、实收、欠款、补收、签字打印保留。
- 出入库集中展示库存流水，记录集中展示人员操作审计，移除重复页签。工作台库存链接指向出入库，显式旧records_tab=documents链接迁移筛选到movement。
- 基础资料收款账户是建档维护，财务账户是流水对账；客户账册及新建/入库快捷入口是上下文操作，继续复用原流程。
- 沿用14菜单及原权限、API和业务事务。删除无效外层Tabs语义，保留基础资料字典页签与表单固定布局。
- 按.claude/skills/web-design-guidelines刷新官方规则，审查本次去重及相关语义/布局；不宣称本轮重新全站审计。

## Verification
- 前端→Rust构建PASS，/tmp/erp-dedupe-{build,backend}.log；最终E2E类型、修改文件格式及git diff --check PASS。
- Chromium17/17 PASS（3.5分钟），/tmp/erp-dedupe-chromium.log。
- WebKit首轮16 PASS/1 FAIL（4.7分钟），/tmp/erp-dedupe-webkit.log。8种收发长流程含初始化触及45秒总时限，trace内业务断言正常；仅对该用例设90秒，保留全部断言，最终WebKit同用例PASS（56.1秒），/tmp/erp-dedupe-webkit-flow-final.log。失败证据tmp/dedupe-webkit-results；不将首轮称为全绿。
- 桌面单据、手机详情及操作历史截图已人工查看；无重复栏目/遗留页签空白。业务回归覆盖财务定位、单据操作、补收返回、库存/审计查询导出及权限、旧链接、固定按钮和欠款打印。
- 本地预览14路由、菜单/卡片跳转及13个嵌入资源与dist字节一致PASS，/tmp/erp-dedupe-preview.log。硬件打印机/相机不以浏览器测试代替现场验收。
- 自查范围/复用/架构/复杂度/回归/状态/提交卫生PASS；原请求验收PASS。

## Workspace / Preview
分支feat/sales-and-receivables，起点36bb612。两个根目录导出txt出现外部删除，不恢复、不纳入本轮提交。
5173代理4280；已核实停止旧PID50112后更新，新PID60787/session81435。更新前备份backup-20261011-053936-1389e54c.zip，/tmp/erp-dedupe-preview-backup.json。其他服务未改动。

## Next Action
本轮没有剩余实现或待用户澄清项。恢复时先核对包含本文件的提交与origin/feat/sales-and-receivables一致；一致则已交付，不再扩展改动。PR#1保持草稿，正文已准备于/tmp/erp-dedupe-pr-body.md，交付时同步。两个外部txt删除仍由原操作者处理。
