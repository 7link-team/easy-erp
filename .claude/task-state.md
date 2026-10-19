# Task State

## Task / Objective
用户 /goal：「客户需求全部实现，菜单问题也优化掉，弄好了做一次评审和bug修复，最后确保没问题后全部提交推送发版」
客户需求出自 `docs/客户需求/20261019.md`（已脱敏纳管）。

## Current Phase
ACCEPTANCE — 客户需求全部实现；评审 6 条发现全部验证并修复；跑最终全量门禁。

## Current Step
等最终全量 chromium（b44638sbw）→ webkit 全量 → 分组提交推送 → 打标签 → publish-verified。

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
- [ ] 全量 e2e（chromium 跑中 / webkit 待跑）
- [ ] 评审发现修复 → 提交推送发版

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
- 本地领先远端 6 个提交未推送（含数据目录改可见名）。

## Verification
server: cargo test 11 集成 + 单测 PASS；手工 API 实测 PASS。
前端 / e2e / 桌面：本轮尚未跑。

## Next Action
前端加小组选择与汇总页；随后补 e2e 覆盖汇总接口；再做菜单拆分。
