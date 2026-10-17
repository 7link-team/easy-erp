# Task State

## Task / Objective
用户授权「全部提交推送 发版 打包镜像」。完成本轮功能，提交推送main，正式发布v0.2.3安装包及服务器amd64/arm64镜像，并实际验证公开下载、签名和数据持久化。

## Current Phase
COMPLETE。Direct执行；源码、发布产物与容器均对应ad6622cca250058fdb28bf48f34d9ae5acbcf611。发布记录提交独立于产物源，使用[skip ci]避免重复构建。

## Confirmed Requirements / Delivered
- 基础资料独立「开单与打印设置」，不再藏在公司信息；路径#/catalog/settings，目录分栏合理路由及面包屑，刷新/前进/后退和权限保护。
- 物料成本价仅用于库存余额估值；可选售价>0时选料带入销售单，手改和已保存单据价格保留；成本价不进入销售快照。存储精度10000，null/旧数据库-1为未设置。
- 库存总额覆盖所有筛选分页，金额精度及缺成本提示；SQLite/MySQL迁移、旧备份兼容、完整备份恢复。
- 客户打印使用部门/业务员等用语；金额和送货地址逐项可配置，默认空地址不打印、欠款及已收金额不打印、其他金额为0不打印。
- 用户特别确认只隐藏「已收金额」这一行，保留收款记录整块明细。默认结算全部收款；草稿保留原选择，无收款权限沿用保护规则。
- SQLite/MySQL首次初始化在服务器网页和桌面启动窗口均支持，MySQL提供连接表单。
- 修复连续保存配置遇到慢刷新时旧catalog覆盖新版本的问题；按较高version合并，避免误报版本冲突。

## Published
- 正式Latest：https://github.com/7link-team/easy-erp/releases/tag/v0.2.3
- 23个文件：Windows NSIS、macOS Intel/ARM64 dmg与更新包、Linux AppImage/deb、Android APK/AAB、iOS模拟器、各平台服务端、Web、更新签名/manifest/checksums。
- GHCR：ghcr.io/7link-team/easy-erp-server:v0.2.3；latest和sha-ad6622cca250058fdb28bf48f34d9ae5acbcf611追踪标签保留。
- 用户要求镜像只放GHCR，两个server-*镜像Release及其附件已删除；安装包v0.2.3保留并注明GHCR版本拉取命令。
- GHCR包当前private，拉取需要有包读取权限的GitHub账号登录。
- macOS为ad-hoc签名；未配置iOS真机分发签名，仅提供模拟器包。

## Verification — PASS
- Build and release 39033544303 SUCCESS，headSha=ad6622c，全部启用平台通过。
- Chromium180/180、WebKit180/180全量通过。
- Rust12单元/8恢复测试；云端SQLite和MySQL检查通过。
- 本地全新MySQL release_clean_20261017业务57/57，最终SQLite catalog/item-prices/sales34/34。
- 连续保存回归：强制GET返回旧快照，旧前端失败、修复前端通过，第二次保存及刷新持久化正常。
- Server container 39033546087 SUCCESS：两个原生架构初始化、保护令牌、内嵌前端、重启持久化均通过。
- Public server image archives 39034998225 SUCCESS：公开下载两架构及compose校验和通过；本机amd64 docker load、启动、初始化、登录、重启持久化PASS，revision标签匹配ad6622c。
- 下载全部23个v0.2.3文件，SHA256全部与清单/GitHub资产摘要一致；4平台Ed25519更新签名与trusted comment均验证通过。
- macOS Intel下载产物codesign --verify --deep --strict PASS；独立原生服务器0.2.3启动、内嵌Web、价格字段、登录及重启持久化PASS。
- Windows工作流升级/数据保留与原生更新测试PASS；iOS模拟器安装启动工作流PASS。
- 正式发布后匿名latest/download/latest.json与已验证manifest一致；GitHub latest明确v0.2.3，draft=false/prerelease=false。
- TS/e2e TS、git diff --check PASS；自审与原始需求验收PASS。

## Test Corrections / Resolved Issues
- 默认full改变后，原先假设unpaid的销售/价格测试显式选择unpaid，保留原断言与产品默认行为。
- 早期本地全量178/180中一处临时盘SQLITE_FULL，后续测试数据目录移到项目盘；最终云端全量和本地相关场景全部通过。
- MySQL曾尝试4294并行，旧测试额外context硬编码4289导致环境失败；另一次复用中断测试库造成汇总/行数污染。最终使用4289和全新库57/57通过。不得把这些中间失败当成未解决产品问题。
- 未发布v0.2.3标签在修复时使用精确lease更新，旧运行已取消；正式发布后未改tag、未覆盖旧版本。

## Live Service / Data Preservation
- 用户服务：http://127.0.0.1:4291/，原数据目录build-artifacts/tmp/desktop-v0.2.1-test，库存数据库inventory.sqlite。
- 原服务session7467：target/debug/easy-erp-server --data-dir .../desktop-v0.2.1-test --bind 0.0.0.0:4291 --web-dir .../dist。运行二进制仍报告0.2.2，包含功能变更；没有为了发版中断用户服务。
- dist已同步build-artifacts/tmp/v0.2.3-verified-web，保留旧assets；最新设置修复可刷新使用。
- 原有数据1用户/5物料/10库存单据/5销售单；升级比对原列完全一致。备份build-artifacts/tmp/before-item-prices-20261017-191941.sqlite。
- 当前公司配置default_settlement=full、print_settings.amounts.paid=never。未对用户数据运行任何业务测试。
- 本次原生4296与容器冒烟已停止并清理测试容器/卷；本地MySQL验证容器easy-erp-mysql-check为既有隔离测试环境。

## Evidence
ignored build-artifacts/tmp/v0.2.3-{mysql-clean,sqlite-final,cloud-sqlite,cloud-webkit}.log。
v023-release-assets、v023-server-assets、v023-native-assets、v023-native-server、v023-native-app。
verify-v023-release.mjs（签名/hash），smoke-v023-native.mjs（原生启动/持久化）。
v0.2.3-release-notes.md，v023-public-latest.json。

## Remaining Work / Next Action
无功能、发布或镜像待办。提交推送本记录并确认工作区干净/与origin/main同步后交付链接。无需用户审批。

## Last Checkpoint
2026-10-17 21:20 SGT，v0.2.3正式发布与公开自动更新manifest核验完成。

## Disk cleanup — 2026-10-17
用户指出本地磁盘占用过高，并提醒已有GHCR。已清理283个可再生目录：性能测试合成数据、254个系统临时e2e库、Rust编译缓存和v0.2.3下载验收副本。约释放49GiB；项目盘可用59→104GiB，系统盘5.4→9.1GiB。发布包/镜像仍在GitHub/GHCR，以上本地大型产物证据路径已清除，文本日志与验证记录保留。
保留用户4291业务库、升级前备份、dist及正在运行的服务二进制；API状态检查正常。以后使用GitHub Actions/GHCR构建发布，本地只下载必要的验收产物，验收结束即清理；性能/e2e合成库和构建缓存不得长期堆积。其他项目及Docker虚拟机未清理。


## GHCR version tags / Release cleanup — 2026-10-17
用户确认使用版本tag，Release不存Docker镜像。已删除server-ad6622cca250、server-a10a9dedb0a1两条镜像Release及附件（Git标签保留），删除server-archives.yml避免再生成；README和发布文档改用GHCR。
server-image.yml新增release.published和手动release_tag入口，只给既有已验证多架构镜像加版本标签、不重建；按版本Git标签解析源SHA，检查两个平台和manifest一致，拒绝覆盖不同镜像。
实际云端任务39041655911 SUCCESS，v0.2.3对应manifest sha256:bbfc4ee7e0143ce5247fb47a293f1468652d7e5da34e5cf7e83aab0861575e70，含linux/amd64与linux/arm64；没有本地镜像下载或打包。
v0.2.3 Release说明已保存并回读确认短版本拉取命令、GHCR地址、Compose链接，移除旧归档链接。YAML解析/diff检查PASS。当前交付无待办。

## GHCR obsolete SHA cleanup — 2026-10-17
用户授权清理sha-*镜像。新增云端image_maintenance=audit/cleanup入口和scripts/cleanup-server-images.mjs：从全部非SHA标签递归保护manifest依赖，仅删除不被引用且所有标签均为SHA格式的旧版本，每次删除前重查，删除后复查保留标签及manifest。
审计39042847895成功；实际清理39042992641成功。删除旧a10a9de索引及amd64/arm64三个版本（1400562076、1400561521、1400559962）。保留当前ad6622c三条记录：v0.2.3/latest/SHA共用索引及两个架构manifest，不能直接删版本否则会破坏当前镜像。全程云端，无本地镜像下载。
用户询问刚发布的下载记录：验收中的云端拉取/归档及本机验证会产生访问统计；不能根据次数推断独立用户数或断言全部来自本次验收。

## System disk / Docker cleanup — 2026-10-17
用户明确授权尝试Docker清理。此前系统盘与项目盘不同；额外删除可再生Cargo下载源码缓存和Playwright浏览器后系统盘93%/12GiB空闲。
Docker接口卡死，正常desktop restart超时。TERM退出后仍残留卡住后端67999，结束该进程并重新open Docker后恢复查询。唯一既有容器easy-erp-mysql-check此前已Exited；无运行容器被中断。
执行docker builder prune -a -f和docker image prune -a -f，分别报告8.156GB/8.753GB回收；构建缓存归零，保留MySQL容器引用镜像。60个数据卷全部保留（包括其他项目数据库），未执行volume prune。
Docker虚拟磁盘实际占用28→15GiB；自动回收后系统盘最终83%/30GiB空闲（df现场验证）。4291库存服务状态正常、用户业务库/备份未改动。本机镜像验收副本已清理，后续以GitHub Actions/GHCR为主。无清理待办。
