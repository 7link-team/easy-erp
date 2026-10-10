# Task State

## Objective / Phase
Active goal：全部做到位啊。依据 docs/客户需求/20261009.md、会话确认与 v2 原型；整体尚未完成，不标记 complete。
当前阶段：ACCEPTANCE；全局搜索和 WebKit URL 写入修复已完成最终回归、自查与本批验收。Direct，无 subagent；前端导航/查询相互依赖，直接实现降低集成风险。
分支 feat/sales-and-receivables，已推送上一批4b4d416；用户授权全部提交推送，不合并、不发 Release。

## Delivered
- 2211f46：自定义角色/模块权限、逐行选料、固定标题/操作栏、财务同页、基础资料左清单右表格。
- d3fd9c0：欠款/部分/全额收款，同事务扣库存入账；欠款签字打印、两张照片、必填星号及关联单据数。
- e743d14：物料/单据/记录筛选与同条件导出、手机内容区滚动。
- 86ec3eb：客户ID账款/补收上下文、单据完整筛选导出、物料导入弹窗。
- c42d04f：退货作废历史金额汇总、取消/过期请求修复；Chromium93/WebKit93 PASS。
- 4b4d416：真实工作台汇总、15项原型业务菜单、财务三入口同页定位、关于在业务菜单外；单据尾列显式操作、独立单据类型列（手机单独带标签）。Chromium102+最终19、WebKit102 PASS，类型显示18组合/菜单90组合/嵌入预览通过。

## Current implementation
- GlobalSearch.tsx：顶栏与Ctrl/⌘ K，共享Modal、api/useResource、权限和dirty guard；分组查询在用物料/销售单据/客户，无权限模块不请求；6项预览、真实总数、查看全部；空查询/空结果/晚响应隔离/错误重试。
- 原生结果链接支持新标签；同页和跨页跳转先确认未保存内容，取消保留URL/表单；桌面方向键/Enter/Esc、桌面输入聚焦、结果滚动时搜索框sticky。
- inventory_item 复用后端ids筛选及CSV导出；customer_focus按ID定位，customer_q匹配名称/联系人/电话；有清除定位操作。单据复用sale_open。
- pageAddress跨模块清理精确定位；Inventory及非财务Sales用navigationIndex重建同页深链状态；财务保持稳定组件。
- sales::catalog新增可选kind/q、搜索total，q请求最多50条；默认调用仍完整返回。权限先检查，现有引用数/部门成员计算保持。
- useQueryValue仅当目标URL不同才replaceState，避免挂载时大量无效写入触发WebKit限制，history.state/返回行为保持。六视口UI场景新增pageerror断言。

## Verification
- 初版搜索专项5 PASS /tmp/erp-search-focused-fixed.log；最初2项失败是角色漏依赖权限/快捷键早于登录完成，已修正测试设置且保留业务断言。
- 最终首次相关回归Chromium71 PASS，WebKit64 PASS/7 FAIL，日志 /tmp/erp-search-{chromium,webkit}.log。六视口trace明确历史API10秒超过100次，已修复无变化URL写入；第七个普通开单人场景在部门下拉等待稳定时中断，无pageerror；最终双浏览器均以原断言通过，未改业务或放宽测试。旧trace在tmp/search-webkit-failures。
- 最终前端→Rust后端构建、typecheck:e2e/cargo fmt/diff-check PASS /tmp/erp-search-final-{frontend,backend}.log；Rust7 PASS /tmp/erp-search-unit.log，之后后端无变化。
- 最终WebKit44 PASS（4.8m），含此前全部7个失败场景和强化搜索断言；日志 /tmp/erp-search-final-webkit.log。最终Chromium44 PASS（3.3m），日志 /tmp/erp-search-final-chromium.log；4289测试进程已结束。
- 最终显示72组合PASS /tmp/erp-search-visual-final.log（宽1600/1280/1024/800/390/320×浅深×三字号×顶栏/弹窗）；1280/320截图已人工查看。渐变背景对比度不在脚本覆盖范围，不宣称全站无障碍完成。
- 最终嵌入预览桌面/手机搜索、ID精确定位、无溢出/运行错误PASS /tmp/erp-search-embedded.log。
- 本轮已复读 .claude/skills/web-design-guidelines/SKILL.md，最新规则 /tmp/erp-web-interface-guidelines.md；新增搜索入口、原生链接、键盘/焦点、表单标签、浅深/窄屏已复核。既有菜单按钮语义等全站差异未宣称完成。

## Constraints / Preview
- 成本与目标暂停：原需求没有销售目标，成本算法未确认。历史快照不随资料现值重算，精度最多3位。
- 每条回复以✅ CLAUDE.md loaded 🎉开头。显式 staging；保留tmp、数据库和预览，排除生成物。前端先构建，后端嵌入dist再构建。
- Vite5173 → backend4280 session99411，最新最终构建已重启；数据/tmp/erp-live，admin / Aa123456!。保留5500、4290、8912。测试用caffeinate -i防休眠，随测试退出；额外session32238是2400秒临时防休眠，可停止。
- 欠款PDF/签字/上传/照片备份恢复已测；实体打印机/相机/手机软键盘未测。

## Remaining overall scope
1. 当前批已验证/验收，显式提交推送并核验远端。
2. 客户/基础资料/物料候选导入导出，复用transfer解析/预览/事务和重复不覆盖规则。
3. material_options缺状态/排序/说明/引用/最近使用/来源；兼容迁移/备份，不回写物料/历史，未知旧来源/时间保持未知。
4. 字典拖拽排序及键盘/触控替代；剩余页面逐项对照原型复核。
5. 成本/目标等待明确语义，其他已授权工作不重复询问。

## Next batch research (not implemented)
transfer.rs现有items/opening两模式、100行/5MB，preview与commit都做权限/重复校验；TableImport可复用。销售资料save_catalog需提取可在现有事务内复用的验证/保存核心，避免逐行独立提交。options.rs两处位置式INSERT必须在metadata迁移前改显式列，migration.rs material_options_v1现5列，backup.rs迁移集合检查须兼容。

## Next Action / Checkpoint
2026-10-10：最终Chromium44/WebKit44 PASS；前后端构建、Rust7、类型/格式检查通过。自查PASS：授权原型搜索范围、复用现有接口/权限/Modal/导航、无新依赖或迁移、失败/取消/并发及浏览器回归。需求验收PASS：搜索入口、分组/真实总数、权限隔离、ID定位/同条件导出、未保存保护、新标签/刷新/后退、键盘/手机。仅格式化Sales.tsx长行不改变构建语义。本批可交付，整体尚未完成。下一步显式stage/commit/push并核验HEAD=origin；后续按上方资料导入/字典metadata研究推进，成本/目标继续暂停。
