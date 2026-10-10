# Task State

## Objective / Phase
Active goal：全部做到位啊。按docs/客户需求/20261009.md、已确认交互与v2原型。当前批次已验收，整体完成尚待最终审计，不标记complete。
当前ANALYSIS：清点分类、备份记录字段与手机布局已交付，进入全目标最终完成性审计。Direct，无subagent；复用既有查询、快照、恢复和表格，不加新schema/依赖。
分支feat/sales-and-receivables，本批功能提交f0ee74e已推送，已核验HEAD=origin及干净工作区；本文件为交付后checkpoint，后续HEAD可能为状态记录提交。用户授权全部提交推送，不合并、不发Release；显式stage，保留数据库、tmp与预览服务。

## Delivered
- 2211f46：自定义角色/模块权限、逐行选料、固定标题/操作栏、财务同页、基础资料左清单右表格。
- d3fd9c0：欠款/部分/全额收款、事务扣库存与记账、欠款签字打印/两张照片、必填星号、关联单据计数。
- e743d14 / 86ec3eb：筛选导出、客户ID账款/补收上下文、物料导入弹窗、手机滚动。
- c42d04f：退货作废历史金额汇总、请求取消/过期响应修复；Chromium93/WebKit93。
- 4b4d416：真实工作台、15业务菜单、财务三个入口同页定位、关于菜单外；尾列操作、独立单据类型列与手机类型标签；Chromium102+最终19/WebKit102。类型问题已解决，勿重复实现。
- 221f1ff：按权限全局搜索、精确ID定位/导出、dirty guard；WebKit重复URL写入修复；最终Chromium44/WebKit44、72显示组合。
- 2f8902d：八类资料CSV/XLSX原子导入导出、预览回滚/确认重验/幂等/部门ID防错绑；共享保存核心和Modal；双浏览器分批及最终专项、Rust7、216显示/36嵌入组合通过。
- 2d6d4a7：字典元数据、启停/引用/来源/使用时间、原子拖拽/按钮排序、账户类型、旧模板/API/备份兼容；Chromium71/WebKit71、最终Chromium29/WebKit6、Rust7及显示检查通过。0da6570为交付状态checkpoint。

- 31e6f0e：业务员/部门/期间筛选、真实月度资料统计、部门负责人、账户同条件对账；旧分类快照不倒填，账号绑定不实施。Chromium89+最终25/WebKit90、Rust7、240显示及48嵌入组合通过。ad67a05为状态checkpoint。

## Current Implementation / Scope
- Stocktakes分类来自material-options实际在用物料kinds，复用items.kind；候选改删仍可查旧分类，跨页/分类保留勾选，排除清点锁、沿用1–100上限。搜索等待禁止操作旧候选、查询失败隐藏旧候选但保留勾选；恢复后继续。表单与库存事务不改。
- Manifest新增可选source/photo_count。来源内部调用显式记录manual/automatic/restore/upgrade/shutdown/maintenance，桌面prepare-update也用于退出，显示退出或升级前。数量从已完成的SQLite快照计算全部凭证（含历史），旧库无附件表为0；旧备份缺失字段为未知。
- BackupInfo增加snapshot_at/source/photo_count/path/metadata_error；原created_at仍是文件mtime用于原保留规则。列表仅读64KB以内清单，不解压数据库；坏清单或无效日期单条标记，不影响其他条目。恢复复用read_manifest，完整校验/事务与本机限制不变。无新schema/依赖，不改每小时备份/按天保留。
- Settings账册列展示真实字段，桌面尾列固定，手机分区/长路径换行/操作独立。未知生成时间的恢复提示明确是文件修改时间。清点候选增加行间距与分隔线。
- 手机workspace position:relative约束绝对定位隐藏控件，修复长列表撑高根页面和底栏移出视口；实际高度11402→800，回归断言根高度及导航可见。仅screen媒体，不影响打印。
- 新stocktake-backup-details.spec.ts 4项；desktop-control.test.mjs补真实来源/零图片断言。原业务测试断言未弱化。

## Verification / Actual Evidence
- 首轮专项5：3PASS/2FAIL，fixture删候选漏version、手机td固定高度挡住按钮；已分别修正。相关Chromium60：59PASS/1FAIL，fixture误以名称顺序分页；按接口实际候选身份修正。
- 修正后Chromium专项+ui21 PASS（3.5m），/tmp/erp-backup-count-delivery-chromium.log；追加查询失败修正及来源Map后专项4 PASS（1.2m），/tmp/erp-backup-count-accepted-chromium.log。
- 最终相关WebKit61 PASS（9.4m），/tmp/erp-backup-count-webkit.log：stocktake-backup-details/zip-backups/backup-policy/workflows/ui/sales/lifecycle/roles/inventory。
- 最后未知生成时间的恢复提示：最终前端→后端构建PASS /tmp/erp-backup-count-final-copy-{frontend,backend}.log；专项第2项Chromium/WebKit各1 PASS，/tmp/erp-backup-count-final-copy-{chromium,webkit}.log。测试服务已结束，4289释放。
- Rust7 PASS /tmp/erp-backup-count-unit.log；desktop-control1 PASS /tmp/erp-backup-count-desktop-control.log（真实关闭/离线备份/迁移/保留策略）；typecheck:e2e、prettier、cargo fmt、diff-check通过。
- 初次96显示组合仅自动检查通过；人工发现方式列挤字/候选过密/根页面变高并修正。最终嵌入96组合PASS /tmp/erp-backup-count-visual-accepted.log，桌面与320深浅截图tmp/backup-count-*.png已人工复核。最后文字补测手机弹窗常显通过；最终嵌入JS/CSS字节与dist一致。

## Constraints / Preview
- 每条回复以✅ CLAUDE.md loaded 🎉开头。已按.claude/skills/web-design-guidelines/SKILL.md复核本批UI，最新规则/tmp/erp-web-interface-guidelines.md；检查语义表格/按钮/标签、焦点/固定区/深浅可读与手机滚动，不宣称全站无障碍。
- 先前端构建再后端嵌入；cargo /Users/apple/.cargo/bin/cargo。CLAUDE中的Go/monorepo目录为过时约定，不用于此仓库。
- 成本/目标暂停，原需求无目标且成本口径未确认。业务员用于业绩而非登录绑定；开单人独立。单位精度为物料级最多3位；候选改删不重写物料/历史。
- Vite5173代理4280，数据/tmp/erp-live，admin / Aa123456!。当前预览4280 session22192为最终嵌入构建，旧38290已正常关闭。保留5500、4290、8912。
- 升级前备份backup-20261010-161720-9225b252.zip，/tmp/erp-backup-count-preview-backup.json；新版本实际手动备份backup-20261010-163404-7ecfd319.zip确认来源manual/图片0，/tmp/erp-backup-count-preview-current.json。
- 实体打印机/相机/手机软键盘未测试；不能用浏览器仿真声称已测实体设备。本轮不打包、不发布。

## Self-Review / Acceptance
本批PASS：新分类查询/跨页与失败恢复、真实快照与来源/旧备份兼容/坏文件隔离、原保留策略、角色鉴权、真实恢复和手机操作均有实际证据。复用原查询/保存/快照/恢复/UI，无无关重构或新依赖。生成物/tmp/数据库均排除提交。完整目标仍待下一步完成性审计，不能以本批通过代替全部完成。

## Remaining / Next Action
1. f0ee74e已显式stage、自查staged diff、提交推送，核验HEAD=origin与工作区干净完成。
2. 对原客户需求与用户已确认事项、prototype.html的15个业务菜单建立最终逐项完成性核对，检查当前代码/实际页面/测试覆盖。不要默认继续添加功能；仅针对有证据的明确缺项修复。
3. 审计范围包括完整业务流程、导航/显式操作/表单sticky、字典与查询、业绩、清点、备份、角色；保留已明确的成本/目标/单位精度/账号绑定/财务同页例外。收齐全目标证据后才update_goal complete；目前仍active。

## Last Checkpoint
2026-10-11：清点/备份批次自查及验收PASS，双浏览器/原生控制/静态与显示检查完成，预览最终代码一致。f0ee74e已提交推送并核验；下一步原始需求、用户确认事项与全15个业务菜单的最终审计，先建立证据矩阵再判断完成或明确缺项。
