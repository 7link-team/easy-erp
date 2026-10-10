# Task State
## Goal / Objective
用户 active goal：“全部做到位啊”。以 docs/客户需求/20261009.md 原始业务需求 + 会话确认事项为准，补齐功能并按 design-system/v2/prototype.html 做完整视觉对齐。用户已授权全部提交推送；不合并、不发 Release。
## Phase / Execution
DELIVERED 本批（开单结算/欠款打印/红色必填/关联统计/字典维护）已验收并提交推送 d3fd9c0。Direct，未使用 subagent。第一批已提交并推送 2211f46（基于 c6ebd7c）。整体原型对齐 goal 尚未完成。
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
- 零库存快捷出库新增断言已在WebKit通过；Chromium补测1 passed /tmp/erp-zero-final.log。
- 表单18显示组合PASS /tmp/erp-form-aligned-audit.log；五个账册页面90显示组合无纯色对比度/溢出发现 /tmp/erp-ledger-audit.log。渐变人工检查，实体手机软键盘/打印机未测。
## Preview
Vite http://127.0.0.1:5173 → backend 4280，数据 /tmp/erp-live，PID **73441**（已重启最新已验证binary）。admin / Aa123456!。5500用户原型、4290与8912预览保留。
截图 tmp/reference-basedata.png、reference-mobile-basedata.png；最新实装 tmp/aligned-{catalog,customers,sales,inventory,users}-{1280,390,320}-{light,dark}.png。
## Current work: 新建单据欠款
用户发现新建单据缺少欠款选项。已确认当前只有确认后单独收款；实施金额结算选择全部欠款/部分收款/全额收款、账户及欠款预览。复用现有 prepare/cash/command 事务及 sales.pay 权限；草稿仅保存待登记收款，确认时实际入账，修订不重复收款。无数据库 schema 变更，旧 JSON 默认无收款。
第二批字典排序/说明、行内计款与启停、引用数、未使用删除已实现；已修正历史 before/after 快照引用路径，历史引用删除保护测试通过。
## Latest additions (verified)
- 新单全部欠款/部分收款/全额收款；SaleInput.initial_payment 及草稿JSON保留，确认时与库存同事务写入流水；不改 schema。旧请求无该字段时序列化省略以保持幂等 fingerprint 兼容。
- 用户追加：全站必填红色 *（Field 统一，隐藏“必填”保留可访问名）；客户关联单据一直 —（原运行旧后端未返回新统计，现已重启验证显示真实 3 单；修正历史快照 before/after 引用路径并去重）；欠款打印给客户签字并拍照上传（打印原已有金额，现增加签字区明确欠款确认及详情指引，复用现有最多两张上传）。
- 新增 E2E 验证客户原例、草稿/收款幂等/失败回滚/权限、打印及上传、客户历史关联统计。全部通过。
## Current batch verification and review
- Build: npm run build + cargo build -p easy-erp-server PASS；npm run typecheck:e2e / cargo fmt --all --check / git diff --check PASS。
- Rust 7 passed /tmp/erp-settlement-unit.log。
- sales/catalog/roles Chromium **31 passed** /tmp/erp-settlement-chromium.log；WebKit **31 passed** /tmp/erp-settlement-webkit.log。
- 实际 PDF 发现纸纹层使打印变灰；打印时禁用 body::after 已修复并查看 A4 单页渲染。最终打印/权限/开单补测 Chromium **3 passed** /tmp/erp-print-final-chromium.log；WebKit **3 passed** /tmp/erp-print-final-webkit.log。
- Live visual 1280/390/320 × light/dark 客户/字典无页面溢出；统计实际返回并显示 3 单；金额结算/红星/手机版固定页脚已查看；/tmp/erp-settlement-visual.log PASS。
- PDF / screenshot: tmp/latest-debt-print.pdf、tmp/latest-debt-pdf-render.png、tmp/latest-settlement-mobile.png、tmp/latest-{customers,catalog}-{width}-{theme}.png。
- Self-review PASS: 范围/复用现有事务与cash/不新增schema/旧请求指纹兼容/旧账号权限不扩大/历史关联去重/无测试产物 staging。
- 本批用户要求 acceptance PASS；全站原型对齐尚未宣称完成；实体打印机、手机相机硬件未测，浏览器 PDF/图片上传已测。
## Next Action
本批业务代码已推送 d3fd9c0，远端核对一致。后续继续“Next implementation boundary”的库存/单据查询与原型差异核对；成本和目标扩展保持暂停，不将本批完成标为整体 goal complete。
