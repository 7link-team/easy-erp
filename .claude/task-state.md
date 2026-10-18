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

## Active task — 2026-10-18 File storage local/S3
用户要求增加本地目录/S3可选文件存储；已确认范围覆盖附件、签字图片和完整备份。当前阶段DESIGN/IMPLEMENTATION，Direct执行（涉及存储/备份/恢复强耦合）。
源码核对：现有sales_attachments.data是数据库BLOB，备份ZIP在data/backups；之前关于图片在/data的回答已向用户纠正。
按当前Compose部署语境通过环境变量配置；默认本地，支持S3兼容endpoint/bucket/region/access-key/secret/prefix/path-style。旧BLOB读取保留，新上传外置；备份将引用图片嵌入临时数据库再打包，使恢复不依赖原Bucket。复用现有鉴权、事务、完整备份校验、保留策略；不自动搬迁历史文件。需兼容本地旧备份及SQLite/MySQL。
计划新增storage.rs和附件文件定位迁移，接入sales/backup/state/main，更新Compose示例和README，隔离本地与S3兼容服务测试成功/失败/恢复。禁止改动用户4291数据；构建放项目盘、禁增量/调试信息并完成后清理下载/测试缓存。当前尚未实现。

### 2026-10-18 storage implementation checkpoint
用户补充：目录隔离、备份按日期、清空业务后仍发现备份、超期自动清理。采用attachments/与backups/YYYY/MM/DD/；每ZIP有.json元数据，文件列举为准而非全局索引，policy.json独立保留策略，ZIP内部清单与hash仍为恢复依据。保留最新一份、成功备份后才清理。
已接入初版storage模块、附件外置/旧BLOB读取、备份内嵌外部图片、流式S3读写、独立策略和递归清单、清空备份路径。尚未编译通过/验证，正在首次cargo check；下一步修复编译、更新恢复测试和Compose文档，验证本地及S3完整闭环。用户4291库与服务未动。

### Storage verification checkpoint
实现阶段已进入TESTING：本地/S3存储、附件外置、完整备份嵌图、日期目录/侧车/独立保留策略、清空数据保留备份及清理外置附件、在线与离线S3恢复已接入；Compose示例及README更新，旧路径假设的测试已调整。
已实际通过12单元测试，本地完整恢复/重置/旧扩展名、目录隔离、侧车丢失回读、过期清理、备份失败不清理、SQLite与MySQL（含图片）恢复；S3小文件实际闭环通过，服务使用项目盘临时Moto S3兼容HTTP端点（非真实AWS/MinIO）。MinIO两仓库镜像拉取被拒，未更改鉴权，改用Moto；最终会清理环境。
补测10MiB分片及离线S3恢复发现下载source.zip残留在恢复journal staging导致Directory not empty，已修复为校验后删除临时归档，正在重跑S3。旧BLOB无file_storage_v1迁移备份兼容和恶意外部引用拒绝测试正在运行。
编译产物build-artifacts/storage-target约1.1GiB。临时Python环境storage-python约200MiB，Moto session39933端口43900；MySQL容器easy-erp-mysql-check已启动，新增仅测试库storage_test_20261018/storage_test_final_20261018；结束需删除这两库并停回容器。用户4291服务及业务数据未动。
待办：确认补测通过、运行桌面维护与API E2E相关检查、检查Compose和diff、自审验收、清理本次缓存/测试服务；不发布新版，当前请求无新的发布指令。


### Storage final acceptance — 2026-10-18 08:24 SGT
Phase: ACCEPTANCE / PASS. Direct执行，无子代理。用户要求的本地/S3覆盖附件/签字/完整备份、目录隔离、UTC日期目录、独立发现/元数据/保留策略和过期清理均已实现。复用原鉴权/事务/恢复验证与定时任务。
最终验证：
- `cargo test -p easy-erp-server -- --test-threads=1`：12单元+11集成全部PASS，同时明确配置ERP_MYSQL_TEST_URL与ERP_S3_TEST_ENDPOINT，未跳过对应两类测试。日志storage-acceptance-tests.log。
- SQLite与真实隔离MySQL包括图片的完整恢复；S3使用Moto HTTP兼容端点（非实际AWS或MinIO），10MiB归档触发真实分片请求，在线/离线恢复、清空DB后列表/保留天数、删除原对象后本地恢复通过。
- 旧BLOB无file_storage_v1备份恢复PASS；外部路径引用备份被拒且原库逐字节不变。自定义本地目录、元数据丢失、失败备份不清理、过期归档/侧车同时删除及无关文件保留PASS。
- 桌面控制实际进程测试1/1 PASS；使用临时副本仅替换测试二进制路径，不改用户target/debug。ZIP下载/恢复与销售图片/金额/库存+升级前备份Chrome E2E2/2 PASS（使用已安装Chrome，无新增浏览器下载）。
- npm run typecheck:e2e、Compose普通/S3配置解析、git diff --check PASS。
发现并解决：S3离线恢复source.zip须在journal提交前移除；销售旧版测试丢弃sales表时须同时去除file_storage_v1标记（否则假旧库声称已执行不存在表的迁移）。上传COMMIT网络结果不明时保留对象，避免删除可能已提交的图片。
Self-review: Scope/Reuse/Architecture/Regression/Complexity/Durable State PASS；Final acceptance PASS。清单以存储为准，侧车非唯一索引；policy.json保留，清空备份不会删附件，清空业务会清理已配置附件但不删备份。
清理：已删除本次三个MySQL测试库并将既有测试容器停回；停止Moto并删除项目盘storage-target、storage-python及本次测试库/浏览器临时产物，约回收1.5GiB，保留文本日志。未动其他Docker卷/镜像或用户业务目录。
当前4291用户服务API状态正常，仍原0.2.2运行二进制，业务数据未修改。本次功能源码未提交、未推送、未发布新版本，未替换用户服务；当前请求为存储功能与备份机制，本轮没有新的发版指令。
Next Action: 本轮实现及验证无待办；后续发版时提交本次源码、按既有GHCR版本tag流程发布，勿构建/附带Release镜像归档。

## Active release — v0.2.4
用户明确要求提交、推送、发版。当前REVIEW/RELEASE，Direct执行。范围为已验收文件存储及独立备份机制，不包含建议中的锁定备份/失败提醒。
同步版本0.2.4，提交推送main后使用GitHub Actions全平台构建/全量回归与双架构镜像；成功产物生成Release草稿，核对清单与摘要后正式发布，附GHCR v0.2.4地址。不得附镜像归档、不得在本机下载全平台产物；不改4291业务数据。无需再次审批。
下一步：完成版本/发布说明检查并提交、推送，跟踪Build and release和Server container结果。

### v0.2.4 publication checkpoint
已提交推送15c9f77bb497e3201c7faebd725540d1386cc487（版本全部0.2.4），待创建tag，尚未创建Release。
Build and release run39099225831，Server container run39099225710。Linux checks、Chromium全量、Linux安装包、Android以及容器SQLite/MySQL回归均成功；其他构建仍运行。
Windows checks job117591866759：Rust测试/编译成功，Node desktop-control出现UND_ERR_SOCKET other side closed，无业务断言信息。完整日志build-artifacts/tmp/v024-windows-check.log；当前run未完，gh run rerun --job被拒。等整轮完成后先重跑失败job辨别是否暂态，若再失败补充服务日志定位，不能跳过该门禁。
发布计划：main全平台和镜像成功后，为相同已验证SHA创建v0.2.4 tag；复用publish-verified.yml(run_id/tag)生成草稿避免重复构建。发布说明docs/releases/v0.2.4.md；临时验证脚本build-artifacts/tmp/verify-v024-release.py仅下载latest.json与SHA256SUMS，用GitHub资产digest核对全部产物（不下载大文件）。给GHCR源SHA镜像打v0.2.4标签，验证后正式发布并核对匿名latest。最终提交任务状态[skip ci]且确认工作树干净。当前所有失败未解决前不发布，不需再次问用户。

Windows installer job117591866724失败已定位：脚本Get-ChildItem backups/*.zip只数根目录，与日期目录不符。改递归过滤ZIP，保留至少2份备份断言；desktop-control捕获失败时输出已收集服务日志，连接中断不加重试、不降低断言。需新提交重新运行云端检查。
