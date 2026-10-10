# Task State
## Goal / Objective
用户 active goal：“全部做到位啊”。以 docs/客户需求/20261009.md 原始业务需求 + 会话确认事项为准，补齐功能并按 design-system/v2/prototype.html 做完整视觉对齐。用户已授权全部提交推送；不合并、不发 Release。
## Phase / Execution
REVIEW 已验证批次；随后 ANALYSIS/IMPLEMENTATION 功能与细节补齐。Direct，尚未使用 subagent。当前基线 c6ebd7c；下列第一批代码尚待单独提交。
## Verified first batch
- 共享 ItemPicker/document.css；开单与收发逐行添加、更换、删除，预选物料直接显示，标题/最终操作固定。入库允许零库存，出库/销售禁选，物料列表零库存出库快捷按钮也禁用。
- 超库存即时提示/拦截确认但可存草稿；修订可开量考虑原单。
- 更正流水仅列未冲销原流水，无记录禁用并说明。财务同页客户欠款/账户流水/部门业绩，不用二级 tab。
- 自定义角色与模块动作权限已完整接入前后端；受保护管理员，旧 worker/viewer 16 组合迁移，成员会话撤销，备份/旧备份迁移。角色矩阵与嵌套新建保留父表单。
- 基础资料初步恢复 208px 左清单 + 16px 间距 + 右表格 + 底部新增；客户/单据改表格，物料/人员去双边框留白；手机账册全宽、字段16px；登录白底修正。
## Latest steering / scope correction
用户指出初步视觉仍不到位、原型功能缺失，要求全部做到位。
曾在选择题选择“本轮也增加成本与业绩目标管理”；随后对移动加权算法稳定性提出质疑，并指出原始需求无销售额目标。已重新阅读全文并答复：原文只有部门/业务员业绩归属，未要求成本核算或目标。成本和目标扩展暂停，尚未写任何相关代码；不能从原型“完成度”推导考核功能。成本算法没有获得确认。其他已有业务范围继续实现。
## Next implementation boundary
1. 补基础资料真实维护：当前只有弹窗新增/编辑，缺原型行内启停/计款操作、真实引用统计、排序与说明等。先复用 sales_catalog data 和现有事务、审计、版本检查；不要更改历史快照/候选删除语义。评估导入导出需按现有机制做预览/事务，不能假按钮。
2. 补库存/单据筛选和相关查询入口。当前物料只有搜索/分类/低库存，没有零库存/停用列表；销售只有搜索/分页，缺状态筛选。客户需可查询对应实际账款（按财务权限）；退货查询目前藏详情。
3. 逐页结构/密度/字段/行内操作视觉对照；保留用户最新确认的交互，不盲目复刻原型样例数据。工作台假趋势、均价/目标等无来源指标不许显示。
4. 原始客户闭环全部重新验收（多品类开单→库存→折扣/抹零/欠款→补收/退款/更正→部门业务员→照片/打印→权限/审计/备份）。
## Constraints
- 先功能契约后代码；不自行新增会计规则。应收≠实收，历史不可随当前字典修改，数量最多3位小数。
- 保留 tmp/ 数据库、预览服务器与截图。显式 staging，排除本地测试产物。
- 每条用户可见回复必须以“✅ CLAUDE.md loaded 🎉”开头。
- User明确要求 .claude/skills/web-design-guidelines；已读取/应用，最新规则在 /tmp/erp-web-interface-guidelines.md。静态及视觉审核不等于全站无障碍认证。
## Verification
- 最新 npm build / server build / e2e typecheck / cargo fmt PASS。
- Rust 7 passed（/tmp/erp-final-unit.log）。
- 前批全量 Chromium 76 个不同场景已通过；最新原型相关 Chromium 47 passed /tmp/erp-prototype-chromium.log。
- 最新全量 WebKit **76 passed (14.6m)** /tmp/erp-prototype-webkit.log。
- 零库存快捷出库新增断言已在WebKit通过；Chromium补测正运行 /tmp/erp-zero-final.log。
- 表单18显示组合PASS /tmp/erp-form-aligned-audit.log；五个账册页面90显示组合无纯色对比度/溢出发现 /tmp/erp-ledger-audit.log。渐变人工检查，实体手机软键盘/打印机未测。
## Preview
Vite http://127.0.0.1:5173 → backend 4280，数据 /tmp/erp-live，PID **68970**（已重启最新已验证binary）。admin / Aa123456!。5500用户原型、4290与8912预览保留。
截图 tmp/reference-basedata.png、reference-mobile-basedata.png；最新实装 tmp/aligned-{catalog,customers,sales,inventory,users}-{1280,390,320}-{light,dark}.png。
## Next Action
确认零库存 Chromium 补测成功，审查显式 stage 并提交/推送已验证批次。随后实施基础资料功能及精细原型对齐，不把第一批提交当作整个 active goal 完成。
