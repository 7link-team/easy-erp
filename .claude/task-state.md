# Task State

## Objective / Phase
Active goal：全部做到位啊。依据docs/客户需求/20261009.md、已确认需求及v2原型；整体未完成，不标记complete。
当前ANALYSIS：字典详细管理、原子排序、账户类型已交付，继续下一批原型差异复核。Direct，无subagent；本批共享迁移/保存核心/权限/交互紧密关联。
分支feat/sales-and-receivables，字典管理交付2d6d4a7已提交推送，已核验HEAD=origin且工作区干净。用户已授权全部提交推送，不合并、不发Release。

## Delivered
- 2211f46：自定义角色/模块权限、逐行选料、固定标题/操作栏、财务同页、基础资料左清单右表格。
- d3fd9c0：欠款/部分/全额收款、事务扣库存与记账、欠款签字打印/两张照片、必填星号、关联单据计数。
- e743d14 / 86ec3eb：筛选导出、客户ID账款/补收上下文、物料导入弹窗、手机滚动。
- c42d04f：退货作废历史金额汇总、晚响应/取消修复；Chromium93/WebKit93。
- 4b4d416：真实工作台、15业务菜单、财务三个入口同页定位、关于菜单外；尾列操作与独立单据类型列，手机类型标签；Chromium102+最终19/WebKit102。用户确认类型缺失已经解决，勿重复实现。
- 221f1ff：权限隔离全局搜索、精确ID定位/导出、dirty guard；WebKit相同URL写入频率修复。最终Chromium44/WebKit44、72显示组合。
- 2f8902d：八类资料CSV/XLSX原子导入导出、预览回滚/确认重验/幂等/部门ID防错绑、同权限保存核心和Modal。WebKit77+最终7、Chromium相关回归+catalog5+最终7；216显示/36嵌入组合；Rust7。详细历史见需求复核与decisions，不重做。

## Current Implementation / Design
- material_options_meta_v1增加active/sort/note/source/last_used_at；原v1迁移仅调用旧字段seed，运行期ensure补充停用校验和真实使用时间。旧值来源未知、时间空，不伪造。当前物料引用按规范化文字计数，含停用物料。
- options.save_record共享表单/导入，省略元数据保留旧值；manual/import/auto来源由服务端决定。停用拒绝新选用；物料未改字段允许保留。候选删除/改名不改物料或历史。items.read但无options.read只取id/field/name/version/active；引用数需两项read权限。
- /api/catalog-order支持spec/kind/unit/type/account/department/salesperson；各模块update授权，完整ID/version清单原子排序、版本递增和审计；重复/漏项/过期/跨类别拒绝且无部分更新。
- DictionaryOrder共用hook：拖拽+上下按钮、状态播报、键盘焦点恢复、提交/刷新busy控制。MaterialOptions完整字段/启停/编辑；Inventory过滤停用建议。销售配置行修改/启停/删除/计款在排序busy禁用。
- 候选新四列模板兼容旧单列及旧预览；账户新五列含账户类型，兼容旧四列及预览。账户类型保存在既有data，旧API缺省保留，显式空清除，无资金影响。
- backup.rs严格known legacy集合增加metadata前版本，临时副本迁移验证后恢复。
- 桌面候选合理最小列宽与短字段不换行，字典尾列固定；手机每条排序/内容/操作分区，上下按钮44px。复用现有样式、表单、TableScroll，不新增依赖。

## Verification / Actual Evidence
- 首轮专项Chromium13 PASS（30.9秒），/tmp/erp-dictionary-focused.log。
- 权限补测后的前端→后端构建PASS，/tmp/erp-dictionary-final-{frontend,backend}.log；typecheck:e2e PASS；Rust7 PASS /tmp/erp-dictionary-final-unit.log；cargo fmt/prettier/diff-check PASS。
- 相关Chromium71 PASS（5.1m），/tmp/erp-dictionary-final-chromium.log：dictionary-management/reference-transfer/catalog/inventory/sales/roles/ui/backup-policy/zip-backups/navigation。
- 初轮嵌入预览96页面+96编辑组合PASS /tmp/erp-dictionary-visual.log，人工发现桌面挤列/操作横滑后做上述最小CSS修正并为计款补busy保护。
- 最终UI改动后前端→后端构建PASS /tmp/erp-dictionary-delivery-{frontend,backend}.log。
- WebKit相关71 PASS（6.9m），/tmp/erp-dictionary-delivery-webkit.log。最终192显示组合及固定尾列几何断言PASS /tmp/erp-dictionary-delivery-visual.log；人工又发现账户类型短文字挤列，补100px最小列宽，Vite账户48组合PASS /tmp/erp-dictionary-account-visual.log；最终嵌入账户48组合也PASS /tmp/erp-dictionary-accepted-visual.log。最终前端→后端构建PASS /tmp/erp-dictionary-accepted-{frontend,backend}.log；最终Chromium dictionary-management/catalog/ui 29 PASS（2.3m），WebKit dictionary-management 6 PASS（21.7秒），/tmp/erp-dictionary-accepted-{chromium,webkit}.log；测试服务均已退出，4289释放。
- 实际桌面最终截图已查看，文字与操作列正常；Vite5173单据类型桌面1280/手机390实测为“销售单”，截图tmp/dictionary-final-document-type-*.png。

## Constraints / Preview
- 成本与业绩目标暂停，原需求无目标、成本口径未确认。历史快照不按现值重算。单位精度保持物料级最多3位，不改为字典全局精度。
- 每条回复以✅ CLAUDE.md loaded 🎉开头。已应用.claude/skills/web-design-guidelines/SKILL.md，最新规则/tmp/erp-web-interface-guidelines.md。
- 显式stage；保留tmp、数据库及服务；排除生成物。必须前端构建再后端嵌入。
- 预览Vite5173代理4280，数据/tmp/erp-live，admin / Aa123456!。升级前API备份backup-20261010-144857-addb16d7.zip，记录/tmp/erp-dictionary-preview-backup.json。
- 当前最终预览4280 session6145已运行最新嵌入构建（含账户类型100px最小宽度）。保留5500、4290、8912。
- 真实打印机/相机/手机软键盘未测；不得将浏览器仿真说成物理设备测试，不宣称全站无障碍或像素一致。

## Remaining / Next Action
1. 本批构建/测试/视觉/自查/验收已PASS，2d6d4a7已推送并核验。
2. 后续原型逐页差异复核。已确认还有基础资料账户“本月实际净收”、部门“负责人/本月业绩”、业务员“本月业绩/关联账号”、分类“本月出库额”等原型列需要对现有财务/用户数据评估，不能拿演示数填充。单位全局小数位仍属已确认例外，不实施。先对照prototype.html#basedata与Sales.tsx/finance接口核实真实缺项，遵循已确认scope。
3. 成本/目标保持暂停；其他已授权任务不重复询问。

## Self-Review / Acceptance
本批PASS：范围对应已授权字典管理与原型排序；复用原保存核心/事务/权限/表格/表单，无新依赖。完整清单原子排序、停用/旧值、权限隔离、新旧模板/API/备份及历史不回写实际通过。最终界面支持拖拽/键盘/触屏按钮、固定操作列和弹窗操作；按web-design-guidelines检查本批组件并修复挤列与触屏尺寸问题。生成物/tmp/数据库不提交。原始客户销售/库存/财务及角色回归通过；整体原型仍有后续差异，不标记全部完成。

## Last Checkpoint
2026-10-10：本批最终验收PASS，预览已更新；双浏览器相关各71及最后受影响补测Chromium29/WebKit6通过。2d6d4a7已提交推送并核验；下一步对照prototype.html#basedata与Sales.tsx/finance接口逐项核实月度统计和档案关联差异。此记录为交付后checkpoint，后续Git HEAD可能为状态记录提交。
