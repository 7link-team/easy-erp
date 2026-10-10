# Task State

## Objective / Phase
Active goal：全部做到位啊。以 docs/客户需求/20261009.md、会话确认及v2原型为准；整体尚未完成，不标记complete。
当前阶段ACCEPTANCE：客户/基础资料批量维护已实现、最终验证和两轮审查通过，准备提交推送。Direct，无subagent；共享保存核心/预览事务/页面入口紧密关联。
上一轮为progress：221f1ff提交推送，HEAD=origin，开始本轮时工作区干净。分支feat/sales-and-receivables；用户已授权全部提交推送，不合并、不发Release。

## Delivered
- 2211f46：自定义角色/模块权限、逐行选料、固定标题/操作栏、财务同页、基础资料左清单右表格。
- d3fd9c0：欠款/部分/全额收款，同事务库存和资金；欠款签字打印、两张照片、必填星号、关联单据计数。
- e743d14 / 86ec3eb：列表筛选及导出、客户ID账款/补收上下文、物料导入弹窗、手机内容滚动。
- c42d04f：退货作废历史金额汇总、晚响应/取消修复；Chromium93/WebKit93通过。
- 4b4d416：真实工作台、15项业务菜单、财务三个入口同页定位、关于在菜单外；尾列操作与独立单据类型列，手机带标签。Chromium102+最终19/WebKit102通过。
- 221f1ff：全局物料/单据/客户搜索、权限隔离、精确ID定位/导出、dirty guard；修复WebKit无变化URL重复写入。最终Chromium44/WebKit44、72显示组合通过。

## Current implementation
- transfer.rs八类资料模式：customer/type/account/department/salesperson/spec/kind/unit，CSV/XLSX模板、预览、确认、导出。公司信息仍单条维护。
- sales::save_catalog_record和options::save_record由原表单/导入共用，options INSERT使用显式列。无schema变更。
- 新资料预览在回滚事务中执行同一保存核心，每行savepoint，成功行参与后续去重但全部回滚；错误按行提示。确认重新校验，失败全批回滚；requests沿用幂等键。取得写锁后重新鉴权，防止等待时权限撤销。
- 模块create授权导入，read授权导出；停用数据需update。旧物料/期初模式仍限管理员。预览任务绑定用户/一小时有效期。
- 同名不覆盖，业务员在所属部门内去重，按已有启用部门完整名称关联；预览记录部门ID，确认防止改名后其他部门复用旧名称造成错误归属，变化时整批回滚要求重预览。旧业务员预览缺ID也须重预览，其他模式兼容。模板明确计款/状态/排序；候选不修改库存或历史。
- 客户页/字典页导入与CSV/Excel导出按钮；导入复用TableImport/Modal固定类型，保留预览/取消/底部常显。客户导出遵循查询或精确ID定位。提交中禁用文件/类型更改避免预览错配。
- success/error Notice和删除描边文字用既有ink令牌，改善浅色对比度。
- 测试修正：queries原先写死管理员姓名，改为/api/me的当前管理员（共享DB可能由inventory以王厂长初始化）；catalog模糊“搜索物料”命中全局按钮，改searchbox+精确名称。业务断言未减弱。

## Verification / Actual Evidence
- 专项reference-transfer6 PASS（24秒）/tmp/erp-reference-focused-final.log，覆盖八模式、模板、预览不保存、失败、冲突回滚、幂等、权限撤销、CSV/Excel、手机弹窗和筛选导出。初始fixture/断言错误已按既有接口纠正，不改产品迎合测试。
- 最终前端→后端构建PASS /tmp/erp-reference-delivery-{frontend,backend}.log。Rust7 PASS /tmp/erp-reference-unit.log；随后仅CSS/测试变更，无Rust逻辑变更。typecheck:e2e/prettier/cargo fmt/diff-check PASS。
- 首轮相关Chromium65 PASS/1 FAIL（9.6m）/tmp/erp-reference-chromium.log：失败为上述管理员姓名测试，trace在tmp/reference-chromium-failures。
- 最终构建Chromium补测31 PASS/1 FAIL（3.8m）/tmp/erp-reference-delivery-chromium.log，覆盖inventory/queries/reference-transfer/catalog/roles；唯一失败为上述模糊搜索定位，trace在tmp/reference-catalog-failures。随后catalog全部5 PASS /tmp/erp-reference-catalog-final.log。
- WebKit相关77 PASS（11.5m）/tmp/erp-reference-delivery-webkit.log。最后部门ID校验新增回归后重新构建后端，Rust7/typecheck PASS；最终reference-transfer Chromium7 PASS（19.7秒）/WebKit7 PASS（21.4秒），/tmp/erp-reference-identity-{backend,unit,chromium,webkit}.log。所有测试会话已结束，4289释放；仅注释文字之后修正，无语义变化。
- 216显示组合PASS /tmp/erp-reference-visual-complete.log（客户/类型/单位×1280/800/390/320×浅深×三字号×页面/成功/错误）；桌面与320截图人工查看。
- 最终嵌入预览36组合PASS /tmp/erp-reference-embedded.log，页面/成功/错误、浅深/桌面手机及常显操作。tmp/reference-page-customers-320.png确认新增入口布局，无横向溢出。
- 视觉最初脚本缺baseURL与未等待主题过渡导致工具误报，已修正；实际成功文字3.53:1问题已修复。渐变对比度由人工检查，未声明全站无障碍/像素一致。

## Constraints / Preview
- 成本与业绩目标暂停：原需求无目标、成本口径未确认。历史快照不随现值重算。单位精度物料级，最多3位；不要改成字典全局精度。
- 每条回复以✅ CLAUDE.md loaded 🎉开头；遵循CLAUDE.md、已应用web-design-guidelines，规则/tmp/erp-web-interface-guidelines.md。
- 显式stage，保留tmp、数据库、服务，排除生成物；前端先构建再后端嵌入。用户授权提交推送。
- Vite5173代理4280；最终预览4280 session61333，/tmp/erp-live，admin / Aa123456!。保留5500、4290、8912。
- 实体打印机/相机/手机软键盘未测；PDF/签字/上传/照片备份恢复已验证。

## Remaining Overall Scope
1. 本批自查/需求验收PASS，显式提交推送并核验HEAD=origin。
2. material_options状态/排序/说明/引用数/最近使用/来源；兼容迁移与备份，未知旧来源/时间保持未知；候选删改不回写物料/历史。
3. 字典拖拽排序及键盘/触控替代；其余页面按原型逐项复核。
4. 新确认差异：基础资料收款账户“类型”（银行/现金等）原型有，ConfigForm/CatalogEntry尚无；后续补可维护展示字段，勿影响历史资金。
5. 成本/目标保持暂停；其他已授权工作不重复询问。

## Next Batch Research (Not Implemented)
- material_options_v1迁移调用运行期options::ensure种子化候选。未来ensure若依赖新增列，会破坏从零/旧库升级；必须保留旧列初始化路径或冻结原迁移种子逻辑为等价实现。本批已将位置式INSERT改显式列。
- inventory更新对未改变spec/kind/unit跳过ensure，可保留旧停用值；新建/改变值才应用新启停规则。来源仅记录未来实际操作，旧值未知。
- backup.rs schemas排除session_idle_v1后按名称排序；known legacy集合要新增兼容，先在临时副本迁移验证再恢复。不要放宽未知schema恢复。
- 候选模板升级须兼容本批单列模板。删除仍按已确认“只删候选不改业务”，不要用原型泛化文案擅自逆转。

## Self-Review / Acceptance
本批PASS：范围对应原型资料批量维护；复用保存核心/权限/事务/解析/Modal，无新依赖或schema；原子性、幂等、并发关联ID、预览取消、权限撤销已测。现有物料/字典/开单/退款/打印/备份恢复/角色回归通过。入口、真实导出数据、手机固定操作/错误状态与文字对比度通过；无生成物应提交。总体仍有上述原型差异，不标记全部完成。

## Next Action / Checkpoint
2026-10-10：本批最终结果已验证，显式stage/commit/push并核验HEAD=origin；交付版本以Git为准。交付后下一步实现material_options元数据与兼容迁移/备份（先处理旧迁移调用ensure的依赖），然后字典排序与账户类型、其余原型审查。成本/目标暂停，无需重复询问已授权工作。
