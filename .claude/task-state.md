# Task State

## Task
可输入基础资料、直接配置入口、库存开单出库。

## Current Phase
TESTING

## Completed Work
- 物料候选字典表和共享可输入下拉；去空白/大小写去重，物料和 CSV 成功提交时事务新增。
- 候选改删只改变列表；单位库存记录保护、版本冲突、权限与审计。
- 客户与基础资料独立菜单；基础资料一层 Tab。
- 单据手输类型及明确计款选项；事务新增、重复复用、停用保护、历史快照。
- 库存行预填开单，提交/关闭后消耗预填。
- 字典纳入备份、两代旧备份恢复，升级前快照。

## Verification
- 最终 npm build、嵌入服务 cargo build、Rust 6项和Node 6项通过。
- Chromium全套59项通过；手机间距修正后的新业务3项通过。
- LAN真实演示浏览器验收通过（客户/基础资料直达、开单预填、手机无横溢）。
- 独立临时服务恢复字典模块以前的真实备份，原3张销售单与候选迁移正常；旧销售以前的备份已全套E2E验证。

## Remaining Work
1. 当前WebKit完整E2E（进程记录见工具会话）。
2. 推送现有草稿PR，等待本次Actions并复核结果。
3. 更新文档与状态为最终结果；反馈预览地址。

## Constraints
SeaORM；不发 Release/不合并；不改用户新加入的 AGENTS.md、CLAUDE.md、.agents、design-system/v2、skills-lock.json。单代理执行，当前各项紧密耦合，新增独立代理无必要。

## Next Action
推送已验证修改后，等待WebKit和云端Actions；失败则定位和修复，绿灯后完成验收记录。
