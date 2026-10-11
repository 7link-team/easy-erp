# Task State

## Task / Objective
用户要求最后核对客户需求，Claude CLI也检查一次，问题修复后全部提交推送，并完成GitHub Actions测试。

## Current Phase / Step
ACCEPTANCE：本地验证与独立复核通过，bb0ba22已全部提交推送；查询测试输入方式修正后准备补交；必须跟进最终提交的完整GitHub Actions至成功，不能只触发就结束。

## Completed / Verification
- 原需求及1.jpg/2.jpg与销售事务、整数金额、权限、照片和打印直接核对，13项软件需求均有实现/回归。客户不要求的成本、均价、目标和优惠经营汇总不加入。
- Claude CLI2.1.296首轮发现F1优惠鉴权缺陷；旧构建实测403。最小修复prepare：原样保留既有优惠可保存/确认/修订，改变、清除、新增优惠仍要求sales.discount。新UI/API回归验证金额/库存/版本不被拒绝请求改变。
- 第二轮Claude限定复核PASS，无阻断缺陷；仅静态审查，运行由主代理执行。报告/tmp/erp-final-claude-report.md和/tmp/erp-final-claude-followup.md；F2–F9主审裁定见需求复核末节，无新会计规则。
- npm run build → cargo build --locked -p easy-erp-server PASS；cargo test服务器7 PASS；cargo fmt、E2E类型、修改测试Prettier和diff检查PASS。
- Chromium销售/角色28 PASS（4.7分钟），WebKit角色7 PASS（2.1分钟）；库存完整串行Chromium3/WebKit3均PASS。日志/tmp/erp-final-{sales-roles-chromium,roles-webkit,inventory-chromium,inventory-webkit}.log。
- 预览已备份backup-20261011-065659-ce398890.zip并更新最终构建；14路由和13嵌入资源一致PASS，/tmp/erp-final-preview.log。

## Prior CI / Known Boundaries
原HEAD5e8f71b的Actions38116121160失败：两浏览器各141 PASS/1 FAIL/2未运行；旧库存用例仍从记录找库存，已改为出入库且双浏览器闭环通过。macOS ARM构建成功，GitHub ArtifactService上传5次网络超时；其他8个适用jobs成功。不要以此前云端结果冒充最终提交成功，若仅网络失败重跑对应job。
实体打印机/相机/手机软键盘及iOS真机未实测，浏览器自动化不替代现场验收。

## Confirmed Constraints / Workspace
分支feat/sales-and-receivables，当前HEAD/origin为bb0ba22。用户本轮全部提交包含两个已有根目录导出txt删除，已核对旧会话导出/无引用；显式逐文件stage。无生成报告/数据库/构建产物入库。
Direct执行，另调用用户点名的Claude CLI只读审查，无子代理。PR#1保持草稿，不合并、不发Release。14菜单、财务同页定位、去重复入口沿用。所有回复以CLAUDE.md规定前缀开始。
5173代理4280；当前后端PID65294/session60101，data-dir /tmp/erp-live。保留其他5500/4290/8912服务和数据库。

## Remaining / Next Action
1. bb0ba22已完成全部提交（含txt删除）及PR更新。补交queries.spec.ts键盘输入与需求复核/task-state，再跟进新HEAD的整轮Actions。
2. 找到这次HEAD的完整Actions运行，跟进所有适用job至成功；如真实失败修复/重验/再推送，基础设施故障重跑失败job。
3. 最终报告提交、独立审查修复、CI实际结果/链接和现场设备边界。Git/CI与/tmp日志是提交后验收依据；避免仅为记录CI成功新增文档提交而留下未经验证的新HEAD。

## Last Checkpoint
2026-10-11：bb0ba22首轮云端10个job成功、Chromium145 PASS，WebKit144 PASS/1 FAIL：queries.spec.ts单据搜索fill返回成功但输入框为空/无筛选请求。截图trace在tmp/final-ci-webkit-evidence，日志/tmp/erp-final-ci-failed.log；原用例本地重复5 PASS，底层原因未确认，不声称产品搜索缺陷修复。该用例改为点击后pressSequentially并增加值保留断言，原业务断言均保留，无重试/加时。最终WebKit完整查询15 PASS（4.2分钟），Chrome同用例1 PASS（17.2秒）。类型/格式/diff通过；仅测试和文档变化，无产品构建变化。补交后必须验证新HEAD全套CI。
