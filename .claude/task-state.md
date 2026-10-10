# Task State

## Objective / Phase
Active goal：全部做到位啊。依据docs/客户需求/20261009.md、已确认需求及v2原型；整体未完成，不标记complete。
当前ANALYSIS：财务期间、业务员筛选、资料月度统计和部门负责人已交付；继续清点/备份原型差异复核。上一批Direct，无subagent；共享快照/报表/界面紧密关联。
分支feat/sales-and-receivables，功能提交31e6f0e已提交推送，已核验HEAD=origin和干净工作区；本文件为交付后checkpoint，后续HEAD可能为状态记录提交。用户已授权全部提交推送，不合并、不发Release。显式stage，保留数据库、tmp与预览服务。

## Delivered
- 2211f46：自定义角色/模块权限、逐行选料、固定标题/操作栏、财务同页、基础资料左清单右表格。
- d3fd9c0：欠款/部分/全额收款、事务扣库存与记账、欠款签字打印/两张照片、必填星号、关联单据计数。
- e743d14 / 86ec3eb：筛选导出、客户ID账款/补收上下文、物料导入弹窗、手机滚动。
- c42d04f：退货作废历史金额汇总、请求取消/过期响应修复；Chromium93/WebKit93。
- 4b4d416：真实工作台、15业务菜单、财务三个入口同页定位、关于菜单外；尾列操作、独立单据类型列与手机类型标签；Chromium102+最终19/WebKit102。类型问题已解决，勿重复实现。
- 221f1ff：按权限全局搜索、精确ID定位/导出、dirty guard；WebKit重复URL写入修复；最终Chromium44/WebKit44、72显示组合。
- 2f8902d：八类资料CSV/XLSX原子导入导出、预览回滚/确认重验/幂等/部门ID防错绑；共享保存核心和Modal；双浏览器分批及最终专项、Rust7、216显示/36嵌入组合通过。
- 2d6d4a7：字典元数据、启停/引用/来源/使用时间、原子拖拽/按钮排序、账户类型、旧模板/API/备份兼容；Chromium71/WebKit71、最终Chromium29/WebKit6、Rust7及显示检查通过。0da6570为交付状态checkpoint。

## Current Implementation / Scope
- sales::finance新增可选performance_period（all/month/quarter/year，默认all兼容）。月/季/年按主机本地日历截至今日；按单据业务日期取当前应收/净实收/欠款，客户总账不跟随业绩期间。
- performance_choices包含历史归属组合及当前无单据业务员；前端按部门/业务员ID筛选与合计，URL保持。全部部门候选附部门名称，同一人多历史部门确定排序合并；同名不同人不混账。
- 用户澄清业务员用于区分/查看个人业绩；不实现原型账号绑定，开单人继续独立。无新账号/权限规则，成本与目标仍暂停。
- 财务响应附monthly：账户按收退款业务日期，部门/业务员按单据日期当前应收。分类按新增SaleLine.kind可选快照及已分摊净额减实际退货；新单记录类别，修订保留原快照，旧单未知不倒填，已消失分类/未分类金额独立列示。
- 部门负责人复用data.contact，旧API省略时保留。新五列模板/导出兼容旧四列及旧预览。无schema或依赖新增。
- 账户汇总/流水/CSV使用相同账户/日期条件，本月快捷、零流水账户可查、URL保持；起始晚于结束提示且隐藏误导金额。“查看流水”筛账户并滚动/聚焦标题。
- 基础资料金额遵守finance.read；加载/失败不显示零。业绩标题允许窄屏整行换行。
- 新finance-periods.spec.ts 7项；reference-transfer仅部门模板适配、sales仅账户表名定位变化，原业务金额断言保留。

## Verification / Actual Evidence
- 首轮finance-periods+reference-transfer：11 PASS/1 FAIL，新fixture误用draft命令，改为既有save；补测finance-periods5 PASS，/tmp/erp-reference-metrics-focused-final.log。
- 首轮相关Chromium89 PASS（9.9m），/tmp/erp-reference-metrics-chromium.log。
- 最终前端→后端构建PASS，/tmp/erp-reference-metrics-final-{frontend,backend}.log；Rust7 PASS /tmp/erp-reference-metrics-final-unit.log；typecheck:e2e、cargo fmt、prettier、diff-check通过。
- 最终Chromium finance-periods+ui 25 PASS（3.5m），/tmp/erp-reference-metrics-final-chromium.log；包含同名业务员/调任/零业绩/权限/现金日期/退货/旧快照/分类改名/模板/日期范围/手机刷新。
- 首次视觉240组合有业务员1280/light/sm一组对比度异常；等待主题动画稳定后最终240页面/弹窗组合PASS /tmp/erp-reference-metrics-visual-final.log。已人工查看部门/类别/业绩/账户桌面及320深浅截图；金融表格保留局部横滑。
- 最终嵌入预览财务48显示组合PASS /tmp/erp-reference-metrics-preview-final.log；4280实际JS/CSS字节与dist一致。
- 最终WebKit相关90 PASS（9.5m），日志/tmp/erp-reference-metrics-final-webkit.log，session80835已结束，4289测试服务已退出。测试覆盖finance-periods/sales/dashboard/catalog/roles/queries/ui/navigation/reference-transfer/dictionary-management。

## Constraints / Preview
- 每条回复以✅ CLAUDE.md loaded 🎉开头。已应用.claude/skills/web-design-guidelines/SKILL.md，刷新规则/tmp/erp-web-interface-guidelines.md；本批UI检查标签、状态、焦点、URL、移动布局与对比度。
- 先前端构建再后端嵌入；cargo路径/Users/apple/.cargo/bin/cargo。不要按CLAUDE过时的Go/monorepo目录执行命令。
- 成本与目标暂停（需求无销售目标，成本口径未确认）；单位精度保留物料级最多3位；字典改删不改物料和历史。
- Vite5173代理4280，预览数据/tmp/erp-live，admin / Aa123456!。升级前备份backup-20261010-153452-aa9ff033.zip（/tmp/erp-metrics-preview-backup.json）。
- 当前4280 session52345为最终嵌入构建，原78675已正常关闭。保留5500、4290、8912。
- 实体打印机/相机/手机软键盘未测；不以浏览器仿真冒充物理测试，不宣称全站无障碍或像素一致。

## Remaining / Next Action
1. 本批源码自查与原需求验收PASS：业务员按ID查询/历史归属/期间口径，财务权限与金额加载错误处理，类别快照不倒填，旧API/模板/备份兼容，手机和双浏览器已验证；复用既有余额/表单/事务，未加依赖或无关业务。
2. 31e6f0e已显式stage、自查、提交推送并核验HEAD=origin；生成物/tmp/数据库均排除。
3. 整体原型逐页收尾仍待继续：已初步核对Stocktakes.tsx选择物料只有名称/编码搜索，原型描述按分类分批；Settings.tsx备份列表只有时间/大小/下载/恢复，原型另有方式/凭证数量/存放位置。下一批先核对现有API与备份ZIP清单可复用字段，再判断需补项；每小时备份/保留天数是既定规则，不抄原型每日/每周演示策略。本批不据原型演示值引入新业务规则。成本/目标/账号绑定不重启。

## Last Checkpoint
2026-10-11：最终Chromium25、WebKit90、Rust7、240显示与48嵌入显示通过。本批源码与文档自查/验收PASS，31e6f0e已推送并核验。下一步核对清点分类筛选、备份真实元数据与原型差异，先读现有API和备份ZIP清单。
