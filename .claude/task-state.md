# Task State

## Task / Objective
完成独立开单与打印设置入口、物料成本价/售价与库存金额、客户打印用语、面包屑和合理路由；更新用户当前本地服务并保留原数据。

## Current Phase
ACCEPTANCE — 实现、测试、真实服务升级与只读验收完成。

## Completed Work
- 基础资料独立「开单与打印设置」，直接编辑，复用原公司记录存储/权限；公司信息只维护联系资料。
- 物料cost_price/sale_price：4位小数整数存储，数据库-1/API null代表未设置；旧客户端不传字段更新时保留价格。
- 当前筛选全部分页库存金额，逐物料按存量×当前成本价四舍五入到分后合计，i128避免乘积溢出，金额以字符串输出；有库存但未填成本的物料单独提示。
- 售价>0仅在选料/库存开单时带入；空/0不填，手改及历史/草稿保持原价；成本不参与销售快照。
- SQLite/MySQL迁移item_prices_v1，历史备份临时副本升级兼容；MySQL完整备份/恢复/重启保留两种价格。
- 客户打印「部门」「业务员」「日期」「商品名称/规格」「应收金额」「已收金额」「已撤销」，内部业绩用语不变。
- 全站面包屑；基础资料#/catalog/{section}独立地址、刷新/浏览器前后退/键盘切换；直达仍检查原查看权限。编辑页保留固定按钮，不被面包屑挤出屏幕。

## Live Service / Data Preservation
- 正确地址：http://127.0.0.1:4291/；原数据目录build-artifacts/tmp/desktop-v0.2.1-test。
- 新server运行session7467：target/debug/easy-erp-server --data-dir "$PWD/build-artifacts/tmp/desktop-v0.2.1-test" --bind 0.0.0.0:4291 --web-dir "$PWD/dist"。
- 最新前端源build-artifacts/tmp/item-prices-webkit-web，已复制dist并保留旧assets。刷新页面可用；原demo账号不变。
- 升级前安全备份build-artifacts/tmp/before-item-prices-20261017-191941.sqlite。
- 原数据1用户/5物料/10库存单据/5销售单。升级后逐列逐行比对items/documents/sales完全相同；新增价格均未设置。
- 真实4291只读验收：价格表单打开后取消、独立设置路由与面包屑、客户打印用语PASS。未执行业务测试写入。

## Verification
- TS / e2e TS / Rust fmt / diff check PASS；Python性能fixture语法PASS。
- Rust12单元PASS；recovery8/8含真实隔离MySQL PASS（ERP_MYSQL_TEST_URL设置），价格备份恢复及重启已覆盖。
- 定向Chromium库存/字典旧备份/新功能11/11 PASS。
- 初轮全量Chromium178项：167通过；11项发现编辑页布局、导航测试重名及新增末尾tab问题。修正后相关24项全部PASS，涵盖所有11项失败。
- 最终新功能Chromium4/4 PASS；WebKit新功能、打印、键盘导航、编辑页按钮10/10 PASS。
- 桌面/手机实际截图核对PASS，无横向溢出；库存开单直接带入8.1234元只在隔离4293验证。
- 自审：范围、权限、价格精度、旧数据/备份、销售快照、路由/焦点、屏幕布局PASS。最终需求验收PASS。

## Evidence / Test Environment
- build-artifacts/tmp/item-prices-{full-e2e,final-regression,webkit,chromium-final}.log；prices-inventory-{desktop,mobile}.png；prices-invoice-{desktop,mobile}.png，均ignored。
- 隔离视觉库build-artifacts/tmp/item-prices-visual（4293）；MySQL验证容器easy-erp-mysql-check:43306、price_test_20261017库。均非用户业务库。

## Prior Release Context
- 上一轮SQLite/MySQL首次初始化（服务器网页/桌面启动器）、打印配置/默认结算已完成并发布。
- GHCR ghcr.io/7link-team/easy-erp-server:latest / sha-a10a9dedb0a1fec092a3fa4f24259c7d62ed436c，包默认private。
- 可匿名下载的上一版镜像：https://github.com/7link-team/easy-erp/releases/tag/server-a10a9dedb0a1，amd64/arm64 tar.gz、compose、DEPLOY.md、SHA256SUMS已实际验证。
- 当前这轮新增功能只更新本地服务；未重新发布GitHub镜像或桌面安装包。不要声称旧Release含本轮功能。

## Remaining Work / Next Action
本轮实现与验收无待办。整理本地提交后交付刷新入口；GitHub镜像及桌面安装包未更新。

## Last Checkpoint
2026-10-17 19:25 SGT，原服务升级与数据比对、最新Chromium4/4和WebKit10/10完成。

## Follow-up — 默认全部收款与已收金额打印（2026-10-17 19:52 SGT）
- 用户明确：默认结算为全部收款；只隐藏右下角已收金额这一行，不隐藏整块收款记录，并可配置开启。
- 程序无配置时默认full，当前4291公司配置已保存full；草稿和无sales.pay权限仍按原规则处理。
- paid默认打印规则never（与debt一致）；打印设置名称改为「已收金额」「应收金额」以匹配打印。当前4291已保存paid=never；收款记录明细不变。
- TS/e2e TS PASS；Chromium打印规则/默认结算/有实际收款时已收默认隐藏并可开启3/3 PASS。
- 前端build-artifacts/tmp/default-full-print-web已更新dist；当前服务实际验证设置full、paid=never、新开单full PASS，无单据业务写入。

## Active Release — 2026-10-17
用户明确授权「全部提交推送 发版 打包镜像」。Direct执行，复用现有build/server-image/server-archives工作流；发布v0.2.3，完整安装包与服务器amd64/arm64镜像及公开下载归档。同步所有版本/锁文件，推送main及新tag。构建检查与产物验收通过后发布正式Release；不得覆盖既有v0.2.2。当前阶段RELEASE PREPARATION，待push、Actions验收、产物下载验证、正式发布。

## Release checkpoint
v0.2.3发布源71c760ecdd5c0c68718dd984fd061333766db4a1，main与tag已推送。正式包工作流39031346278（tag）；服务器镜像39031346192（main）。重复main构建39031346185已主动取消，避免重复消耗。发布说明build-artifacts/tmp/v0.2.3-release-notes.md。后续等待两条流水线并修复失败，验收draft产物后正式发布；镜像成功后dispatch server-archives(source_sha=发布源SHA)并验证公开下载。

## Release validation correction
发布前销售全量测试发现3个旧场景隐含默认unpaid；已显式选择unpaid以覆盖后续收款/库存验证/部分收款，保留全部原断言，产品默认full不变。修正后sales.spec Chromium25/25 PASS，e2e TS PASS。旧包/镜像构建取消，v0.2.3尚未创建Release；将仅更新本轮未发布tag到修正提交，再以同一SHA构建全部产物。
