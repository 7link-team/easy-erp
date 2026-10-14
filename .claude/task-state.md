# Task State

## 当前任务：v0.2.2备份分页、维护入口与正式发布（2026-10-14，已完成）
用户明确授权“弄好了就推送发版”。Direct执行，无子代理；使用ui-ux-pro-max沿用现有界面。实现提交db6b4f0、测试门禁修正99265f0均已推送；正式标签v0.2.2固定99265f09460f7fd889840eb91c55ccce5dd6e47b，不再移动。
正式Release：https://github.com/7link-team/easy-erp/releases/tag/v0.2.2 ，2026-10-14T13:39:03Z发布，Latest、非草稿、非预发布，23个资产共283837226字节。

### 已完成及验证
- 完整备份每页10条，显示总数/页数；边界按钮禁用、列表收缩钳制、新备份回首页，末页下载/恢复选择正确。
- 备份页新增本机维护入口；桌面调用只显示原launcher并发送open-recovery，业务窗口不具备执行维护权限。Web/移动版显示菜单与桌面指引，本机与远程数据范围明确。
- 修复开发启动页origin被trusted拒绝；仅debug接受配置dev_url精确origin，保留launcher标签限制。原数据仍在4291，未清空、迁移或恢复用户数据库。
- 确认关闭维护后可回启动页继续选择本机/远程，并可再次打开维护；维护执行期间仍禁止关闭。自动登录原因是开发可执行文件与打包App存储身份不同；已登录后的开发Cookie有效，未改变有效期或复制令牌。
- 本地typecheck/typecheck:e2e/隔离构建/格式检查、桌面18项、Node发布/权限5项PASS；Chromium相关专项和财务16项、WebKit相关13项及UTC原失败3项PASS。
- 最终tag Actions38568513174 SUCCESS，精确源99265f0；Chromium169/169、WebKit169/169，Windows/Linux检查、四桌面目标、Android正式包、iOS模拟器安装启动存活及release全部成功；iOS真机未配签名按规则跳过。
- 既有云端测试误差已最小修正：本地时间格式不写死时区；业绩历史行按业务员+部门定位，同时验证旧部门历史金额与新部门零金额；不修改产品财务规则、不削弱断言。初始重复与过时构建已取消。
- 实际下载23资产，大小/SHA256SUMS/GitHub digest全部一致，四平台更新签名使用v0.2.1既有公钥验证PASS，两架构macOS包内版本0.2.2。
- 正式发布后匿名latest/download/latest.json逐字节匹配验收资产，version0.2.2/channel stable；四平台固定tag更新URL均HTTP200。
- 证据：build-artifacts/releases/v0.2.2/（ci.json、release.json、published-release.json、assets/、public-latest.json、verify-assets.py），build-artifacts/logs/v0.2.2-{chromium,webkit}.log。产物均ignored，不提交。

### Review / Next Action
Self-review / 本轮需求Acceptance / 发布验收PASS。代码、测试、版本、发布说明均已推送，无待执行产品或发布操作。仅本发布记录待以[skip ci]提交推送；该记录不改变正式tag源码。提交后工作区应干净。
用户可在桌面检查更新；维护入口为“备份→本机数据维护”，或桌面顶部/托盘菜单。真实断电、磁盘满及所有系统人工GUI维护未全面实测，限制已如实列入docs/releases/v0.2.2.md。保留现有签名身份，不自动清空或迁移库存。

---
以下为历史任务记录，以本节当前状态和实际Git/发布资产为准。

## 当前任务：v0.2.1提交、测试与发布（2026-10-12，已完成）
用户已明确授权全部提交推送、测试通过后正式发版。Direct执行；复用原发布流程，无子代理、无签名身份更换。
已提交推送50ecfc5f7cded4868cf44069a89d43b9eac4d4f3及v0.2.1标签；包含a3ff4e3关于页入口和生成文件归拢。7个版本/锁文件同步0.2.1，无依赖升级。发布说明docs/releases/v0.2.1.md。
正式Release：https://github.com/7link-team/easy-erp/releases/tag/v0.2.1 ，2026-10-12T02:23:22Z发布，Latest、非草稿、非预发布。

## 当前版本验证
- 本地npm build、typecheck:e2e、发布清单4测试、Rust server/desktop check、版本一致性及格式检查全部PASS。
- 标签Actions38193789925 SUCCESS，exact SHA50ecfc5；Chromium149/149、WebKit149/149，Windows/Linux checks、四桌面平台、Android正式包、iOS模拟器和release全部通过。iOS真机未配置签名按规则跳过。重复main38193785510取消，完整tag验证保留。
- 新报告路径已在真实CI验证：取回Chromium HTML报告与71张截图；iOS模拟器新证据路径随完整任务通过。
- 实际下载全部23个资产（281732367字节），文件大小、SHA256SUMS与GitHub digest一致；四平台更新签名全部PASS，两架构macOS包内版本正确；与v0.2.0沿用同一更新key ID。
- 发布后匿名latest/download/latest.json与已验收文件逐字节一致，version0.2.1/channel stable；四平台固定tag下载URL均HTTP200，GitHub latest API确认正式版及23资产。
- 证据统一在build-artifacts/releases/v0.2.1/（ci.json、release.json、assets/、public-latest.json、验签工具入口等）及build-artifacts/logs/v0.2.1-*.log。旧/tmp验签二进制仅复用，不读取私钥。

## Review / Next Action
Self-review与Final Acceptance PASS：已提交推送、完整云端验证通过、正式发布和匿名下载/更新验收完成；未改库存数据和原有服务。仅此发布记录待提交推送，使用[skip ci]避免重复构建，发布标签固定50ecfc5。完成记录推送后无待执行工作。
已知限制沿用v0.2.0；关于页系统浏览器完整设备GUI场景未全面验收，前端桥接测试、原生单测及多平台构建通过，具体范围见下文。

---

## 当前任务：根目录生成文件归拢（2026-10-12）
用户确认范围：报告、截图、临时文件和缓存统一，保留dist/target等工具标准构建目录。Direct，复用现有build-artifacts/，不改产品行为、不删除业务数据。
已将根目录16份playwright-report*及test-results原样迁至build-artifacts/playwright/archive/，tmp迁至build-artifacts/tmp/，tsconfig.tsbuildinfo迁至build-artifacts/cache/；设计截图迁至build-artifacts/screenshots/archive/design-system-v2/。此前文档/检查点中的tmp/...证据现需到build-artifacts/tmp/...查找；保留历史报告的原始测量内容。
生成配置：Playwright按chromium/webkit分report与results；16处硬编码截图使用test.info().outputPath；TypeScript缓存固定到build-artifacts/cache/；截图/性能/iOS模拟器脚本及Actions附件路径同步，README和设计目录说明更新。node_modules、dist、target、desktop/target及标准发布产物位置保持。
验证：npm build、typecheck:e2e PASS；Chromium2/WebKit2既有用例PASS，各自HTML报告与3张截图均落新目录，根目录未再生成报告/截图/tsbuildinfo；1000单性能输出烟测PASS、integrity ok。Node/Python语法与CI生成/上传路径一致性检查PASS；性能浏览器3个页面输出烟测PASS，截图及结果均位于新建build-artifacts/tmp/performance-*目录。未运行完整云端CI或iOS模拟器，仅调整其证据路径并静态核对。
Self-review与本次范围Acceptance PASS：旧资料完整移动，生成器与CI使用统一路径，标准构建及业务服务未动。当前无待执行修复；已随50ecfc5提交推送并发布v0.2.1。

---

## 当前任务：关于页项目地址（2026-10-12，已实现验证）
用户要求关于页增加源码和Release地址。Direct；复用Updates页、现有native open_web_address及主题样式；package.json repository.url/homepage统一配置两个地址。
已增加两行项目链接、完整可复制URL、外链提示和图标；新标签页/系统浏览器打开，错误显示复制地址提示，320px自动换行，两个面板间20px。
桌面和移动端现有打开命令仅额外允许两个配置中的精确HTTPS地址；窗口/来源鉴权保留，不开放任意外链、不生成登录ticket。原库存打印/登录链接规则保持。
验证PASS：最终npm build和server build；desktop/lib14项（含外链白名单正反例）；iOS x86_64 cargo check；Chromium现有更新流程12项；Chromium/WebKit专项真实浏览器弹窗URL、native调用桥模拟/失败提示、键盘焦点、320/1440深浅色8组布局。最后间距修改后双浏览器8组布局再次通过并复核截图。Prettier/rustfmt/diff检查PASS。
证据/tmp/erp-about-{native-tests,mobile-check,ui-check,update-regression,final-build,final-layout}.log及/tmp/erp-about-*.png。系统浏览器实际唤起未做完整设备端GUI测试，native桥前端为模拟验证；iOS为编译检查，非真机运行。
Self-review与本次功能Acceptance PASS；仅6个交付文件及本记录改动，无依赖升级。用户随后明确授权提交推送；本提交交付关于页新增入口及原生打开支持。关于页a3ff4e3已提交推送且Actions38189163931通过；本次新增已随v0.2.1正式发布，未覆盖v0.2.0资产。

---

## Task / Objective
用户授权：合并已通过验证的工作、清理已合并分支，E2E通过后正式发版。Direct执行，无子代理。

## Current Phase / Step
ACCEPTANCE：v0.2.0已正式发布并设为Latest；发布检查与公开下载验证全部通过。

## Completed
- PR #1 exact head 9dcc84bc29b8762c92e12996144399e0ad08fd90，Actions38149881071全绿；以merge commit 47bc6ec合入main。
- 验证祖先关系后删除本地/远端feat/sales-and-receivables和fix/windows-install-scope；本地及远端只剩main，无未合并PR。
- 版本提交3004f826fa85215eb8d44d28ba03930eeb77fa05及v0.2.0标签已推送。同步7个版本/锁文件，无依赖升级；发布说明docs/releases/v0.2.0.md。
- 正式Release：https://github.com/7link-team/easy-erp/releases/tag/v0.2.0 ，2026-10-11T17:25:47Z发布，非draft/非prerelease、Latest。

## Verification
- 本地npm run build、发布清单Node测试4项、Rust server/desktop cargo check --offline、版本一致性及git diff --check PASS。
- 正式标签Actions38157363466 SUCCESS，exact SHA3004f82。Chromium149/149、WebKit149/149；Windows/Linux checks、四桌面平台、Android正式签名、iOS模拟器、release全部成功。iOS真机未配置签名，按规则跳过。
- Windows覆盖安装/原生更新/数据保留、iOS模拟器安装启动存活检查已在该CI通过。重复main构建38157169364/38157358487取消，由完整tag运行覆盖。
- 23个发布资产已全部实际下载（281647188字节），大小、SHA256SUMS和GitHub资产digest全部一致。
- 使用既有公开更新密钥与minisign-verify0.2.5验证四平台更新包签名全部PASS；与v0.1.4签名key ID一致，未换密钥。macOS两架构包内版本均0.2.0。
- 发布后匿名latest/download/latest.json与已验证文件逐字节一致，version0.2.0/channel stable；四平台固定tag下载URL均HTTP200。GitHub latest API确认23资产、draft=false、prerelease=false。
- 证据：/tmp/erp-v020-final-ci.json、erp-v020-chromium.log、erp-v020-webkit.log、erp-v020-actions-watch.log、erp-v020-assets/、erp-v020-public-latest.json。验收脚本/tmp/erp-v020-verify-assets.py（针对发布前草稿），验签工具/tmp/erp-v020-signature-check/。

## Reviews / Remaining Work / Next Action
Self-review PASS：复用发布流程；仅版本和发布记录改动，无产品行为/依赖/签名变更，发布说明如实保留大库限制。
Final acceptance PASS：合并、分支清理、E2E、多平台构建、正式发布、公开下载与更新入口均已完成。
业务和发布动作无剩余；本检查点提交推送后交付结果。记录提交仅文档，使用[skip ci]避免重跑已完成的正式版本构建；发布标签保持3004f82不移动。

## Constraints / Known Limits
不动真实库存数据库及原4280/4290/5173/5500服务。不换签名密钥。成本/库存均价与销售额目标不在交付范围。
自动workflow仅生成草稿；本轮依据用户明确授权已正式发布v0.2.0。
沿用既有发布脚本/流程，不弱化E2E或构建门禁。性能并非所有目标均达标，发布说明如实公开等待时间和备份容量。
真实软键盘、断电/磁盘满、照片大库、持续多用户、完整桌面GUI升级和降级未作完整验收。

## Previous Verification
性能、UI和客户需求实现已完成；Claude CLI只读评审通过，详情见docs/性能优化方案-20261011.md、docs/性能优化复测-20261011.md、docs/客户需求/20261009-需求复核.md和.claude/decisions.md。
首次云端旧备份fixture遗漏query_indexes_v1索引/迁移的问题由9dcc84b修正，保留原恢复校验和断言；最新双浏览器完整CI均通过。

## Capacity Evidence
原基线tmp/performance-1x8ofii5，HEAD8487721；保留原报告事实。10万/30万财务与工作台45秒超时，浏览器候选/财务45秒未出现；10万备份512MiB限制400，30万60秒上限未完成。
旧30万初始列表40–43秒与后续较快读波动根因未明，不能称42秒稳态。最初tmp/performance-i7s28356造数错误已作废禁止引用。
正式优化三档tmp/performance-322osdy5，主进程exit0，/tmp/erp-perf-optimized-final.log；无并行编译或负载测试。所有API预期状态、金额、并发开单、幂等/超卖、最终库存与完整性检查通过。
- 10万：首页36.78ms/末页38.38ms、候选26.20ms、工作台661.39ms、财务954.68ms；备份24.70s、恢复78.61s。
- 30万：首页77.62ms/末页89.70ms、候选24.37ms、工作台1880.33ms、财务2901.51ms（最大3106.95ms）；完整管理引用26.08s、全文搜索3.33s。
- 30万备份586.34s/ZIP3047522819字节；恢复951.14s、16表fingerprints一致、下载hash正确、会话注销/标记消失；integrity ok、库存差异0、负库存0；RSS峰62.70MiB、目录采样峰14.36GiB。
- 30万混合8并发全部200但最大8.86s，两个并行财务约4.69s，前台开单129.58ms；非持续吞吐。
浏览器10万1.064s/1.405s/3.097s，30万0.961s/1.257s/3.962s（列表/客户候选/财务），无JS异常，截图核对正常。财务首屏目标未达。
旧30万APFS副本升级tmp/performance-upgrade-7fisl2oy：53.946s启动，16表前后hash完全一致、新索引存在、integrity ok。不是完整桌面GUI升级演练。
三档和迁移二进制a109c8c9369f9a425b582d9593f0253cb013c2de930caab1fe3b4962f4b9a5f9；最终二进制4135928f12f3bb306dcc35057e0a8185fe6d79fac263b125f8c6e0f4b9546154，唯一后续服务端差异是日志stdout改stderr，最终1000恢复/CLI烟测PASS，不篡改原容量证据。

## Remaining Limits / Next Action
本轮已授权实施与验证均已执行，无后台测试待收；交付如实说明性能目标部分未达，不标总体容量PASS。
剩余瓶颈为财务首屏及完整历史扫描。只读探针cash关联子查询仅约0.2s收益、双关联更慢；32MiB缓存/temp_store MEMORY无稳定收益，未改产品，证据/tmp/erp-perf-ledger-probe.json、/tmp/erp-perf-temp-probe.json。
16GiB仅安全上限，实测约3GiB；30万现有7天小时备份约477GiB，加工作库和安全余量，本机120GiB空闲不够生产保留。不改既有备份删除策略。
未测照片大库、持续多会话、断电/真实磁盘写满、完整GUI升级或向旧版降级恢复。此轮未提交/推送/跑Actions。上一任务8487721与Actions38121838963成功不能替代本轮验证。

## Last Checkpoint
2026-10-12（Asia/Singapore）：v0.2.0正式发布及匿名更新入口验收完成。

## Active Task — 2026-10-12 导航返回、桌面打印与业绩
Phase: ACCEPTANCE / Direct；实现、自查与本轮需求验收 PASS，无子代理。
用户要求：连续跳转逐级返回；左侧菜单进入列表；桌面原生打印；零业绩部门/业务员显示并可排序；查明抹零记录、欠款修改权限及凭证备份。
完成：详情/编辑/对账纳入统一history，刷新保留索引；菜单按实时URL清理子页面并保留筛选，同URL不重复入栈；保存后替换历史并清dirty，保留未保存确认；入库完成返回来源。原生print_document验证窗口和服务origin，移动端沿用浏览器。业绩按现有档案/历史归属补零，六列升降序、URL保存、稳定排序。
权限与数据结论：原客户需求第23行明确单后抹零/欠款调整需独立高级权限。实际后端按对应操作权限+本人或sales.all范围校验；管理员可操作，开单人无自动越权。抹零保存在单据和修订前后快照；凭证为inventory.sqlite的sales_attachments BLOB，完整备份恢复包含历史照片。未引入授信额度/成本/目标或新权限。
Verification PASS：npm run build、npm run typecheck:e2e、Rust服务7项、桌面14项、桌面构建；Chromium扩大82/82和WebKit扩大82/82；最后实时菜单query及打印平台info时序调整后，双浏览器各10/10专项PASS。Prettier、两个cargo fmt --check及git diff --check PASS。无后台测试待收。
UI复核：本轮返回/排序/打印按web-design-guidelines核查，320/375/768/1024/1440×深浅色10组无顶栏/页面溢出，键盘排序和aria-sort PASS。报告build-artifacts/tmp/navigation-guidelines-review.md。
原生打印：macOS隔离smoke页实际调用正式命令并打开系统打印对话框，截图build-artifacts/screenshots/native-print-dialog.png及native-print-sheet.png；前端按钮桥由E2E分别覆盖。未发送实体打印任务，未验Windows实机打印。4293/4294临时服务已清理，临时脚本未进入产品源码/dist。
运行环境：desktop/target/debug/bundle/macos/库存管理.app，桌面PID48322；测试服务PID48241，0.0.0.0:4291，--web-dir=dist，原测试库build-artifacts/tmp/desktop-v0.2.1-test保留。connection.json为remote http://127.0.0.1:4291/。防火墙授权已完成，本机及192.168.0.89:4291/api/status最终均200。未动原4280/4290/5173服务和真实数据。
Self-review / Acceptance: PASS，复用现有架构，无依赖/版本/schema/权限语义变化，18个改动文件均在范围内。
Next: 用户在当前本地测试桌面验收，必要时刷新加载最终dist；不强制重启以免打断用户操作。代码尚未提交/推送/发版，本轮未要求发布；正式发版需正常完整构建bundle以包含最终前端。
Last checkpoint: 2026-10-12，最终专项结果全部收齐，服务健康。

## Follow-up — 重启后要求登录（2026-10-12）
Phase: ACCEPTANCE / Direct；只读排查完成，无产品修改。
已证实原因：macOS持久Cookie文件中的erp_session尚未到期，但其SHA256不匹配当前desktop-v0.2.1-test会话，精确匹配navigation-visual/inventory.sqlite的会话（created_at=1791791340330，2026-10-12 15:49新加坡时间），与原生打印smoke时间一致。smoke在同一桌面WebView profile内登录127.0.0.1:4293，覆盖原127.0.0.1:4291的同名Cookie（Cookie不按端口隔离）；不是正常重启清除会话。未输出/保存明文会话令牌。
当前实现：会话存SQLite；Cookie有Max-Age且WebView使用持久默认存储；未勾记住登录8小时无操作过期，勾选为30天无操作过期。地址仍为127.0.0.1:4291，当前服务与数据正常。
Next: 向用户说明测试隔离失误导致的一次性掉登录；当前服务重新登录后可恢复。不擅自重启用户窗口、不改变会话策略。后续原生smoke须用独立WebView数据存储或独立hostname；不同端口不是Cookie隔离。未额外做桌面登录后重启实测，不能宣称已实测该流程。

## Follow-up — 登录后首次点单据报错、刷新恢复（2026-10-12）
Phase: ACCEPTANCE / Direct；原因复现，无业务代码改动。
旧窗口入口index-_uDaBl65.js引用Sales-C5Gj2Ybk.js；当前dist为index-CZWS-fnf.js/Sales-C6YF9cZU.js。最终构建替换dist后保留旧桌面窗口，首次懒加载单据请求旧资源失败，触发现有ErrorBoundary。此前为避免打断用户没有刷新窗口，但漏掉了这个跨构建一致性问题。
Verification: 独立Chromium/WebKit上下文模拟旧入口+当前服务资源，两者均复现恢复页并捕获vite:preloadError（Chromium明确请求已删除的Sales-C5Gj2Ybk.js）；点击重新打开均恢复单据列表，随后各2次往返工作台/单据无新增错误。证据build-artifacts/tmp/stale-sales-repro.json、stale-sales-repro.mjs及screenshots/stale-sales-*.png。测试上下文独立，结束只注销各自会话，没有使用或改动桌面Cookie、窗口、单据数据、dist或运行服务。
Next: 用户已刷新恢复，继续验收当前窗口。本轮不再覆盖运行服务的dist；后续本地验收服务使用固定构建快照，构建其他改动不影响已打开的验收窗口。无后台测试，未提交/发布。

## Active Task — 2026-10-12 空闲更新提示与本机数据维护
Phase: IMPLEMENTATION / Hybrid。用户授权补齐更新空闲提示、启动失败仍可重置/恢复、数据与备份分别清空。已确认重置回首次使用（业务/图片/账号/设置全清），保留备份；按钮及说明必须明确“不含备份数据”。照片备份是重点验收。
分工：idle_updates完成NativeTools及update E2E并typecheck；desktop_recovery实现桌面launcher维护UI/native/文件选择（必要新增dialog插件），CLI共享契约；recovery_tests编写离线CLI真实集成测试。主代理负责服务CLI/备份复用/停服API/集成验收。
设计：CLI --recovery-action list/reset/restore/clear-backups；三个确认短语，数据目录锁排斥运行服务。prepare-recovery复用本机控制token，排空请求后停服，独立于旧升级备份流程。恢复复用ZIP/hash/schema/库存/销售/权限校验，stage验证成功后持久维护记录替换，启动重入可继续未完成操作，备份不进替换文件白名单。
进度：服务cargo check PASS；桌面cargo check PASS，launcher mock UI3项PASS；更新typecheck/E2E typecheck PASS。真实CLI/照片roundtrip及浏览器更新专项待跑。
约束：绝不操作用户真实库或4291桌面Cookie；当前服务仍指向dist，不覆盖dist。新前端构建至build-artifacts/tmp/recovery-web，E2E服务通过ERP_WEB_DIR加载。Rust编译在target，不替换用户当前运行bundle。不提交/发布。
Next: 完成维护中断恢复单测，跑cargo CLI集成测试（照片、坏库、锁、确认、备份独立），再隔离前端update/launcher及原备份E2E、规范复核。Windows真实设备维护未测需如实说明。

Checkpoint — 本机维护与更新最终验收
Phase: ACCEPTANCE / Hybrid。全部需求实现，最终自查PASS，用户新增明确授权“全部提交推送”。
Verification: 服务单元10/10及真实CLI集成5/5最终PASS（recovery-server-final.log）；JPEG/PNG照片往返和库存金额一致、两类清空隔离、sessions失效、坏库/坏备份/锁/确认均通过。桌面原14项+新增路径安全2项通过；双浏览器launcher共10项+最终4项通过。Chromium本轮27项首轮26过，1项冻结时钟阻塞懒加载（未进入业务断言）修测试时钟后定点1/1PASS；WebKit最终29/29PASS。Node门禁6/6PASS，前端隔离构建/类型/格式通过。
Review: web-design-guidelines范围仅新增更新/维护UI，通过；报告build-artifacts/tmp/recovery-guidelines-review.md。补充Windows可写sync句柄与关闭journal、断电清理顺序防御；进程中断单测覆盖，真实断电/磁盘满和Windows实机未测。桌面维护UI使用mock bridge，后端CLI+停服API为真实进程，原生整条GUI维护未实机执行。
不影响用户当前测试窗口：原4291服务/bundle/数据库/Cookie未修改，dist未替换；本轮前端产物在build-artifacts/tmp/recovery-web。新维护功能需以后构建新版桌面才会进入用户当前安装包。
Next: 最终检查后提交所有已审查源码/测试/README/状态与desktop Cargo.lock，推送origin/main，确认远端SHA及Actions启动。不要发版（本轮只要求提交推送）。

Delivery checkpoint — 2026-10-12
实现提交21e0ff9d6a0d1826ae4542c60094087a6f11f36c已推送origin/main，远端SHA核对一致。GitHub Actions38244820238已启动（in_progress），尚不能宣称云端通过；本地验证证据如上。此记录仅文档，随[skip ci]提交推送，不重跑/取消实现提交的验证。当前用户桌面仍为先前本地测试版，本轮未重启或发版。
Remaining: 实现与提交推送无待办；云端构建结果待GitHub完成。下一步如需发版，先核对上述Actions与新桌面设备验收，不把本地CLI/桥模拟当作Windows实机验证。

## Follow-up — 2026-10-14 桌面开发启动权限误判
Phase: ACCEPTANCE / Direct。用户要求运行桌面，随后报告数据不见、使用本机按钮无响应，并要求需要权限时引导授权。
原因：tauri dev 无显式devUrl时由CLI提供127.0.0.1:1430启动页；trusted仅接受打包协议，错误拒绝launcher，截图显示“业务窗口没有本机管理权限”。不是macOS权限拒绝，无需系统授权。
修复：desktop/src/desktop.rs复用配置build.dev_url，debug构建只额外接受其精确origin，仍要求launcher标签。其他端口、协议、主机不放行；正式release不额外接受dev origin。
数据只读核对：connection.json仍为remote http://127.0.0.1:4291/；服务PID48241、build-artifacts/tmp/desktop-v0.2.1-test数据库仍在，5物料/4销售单；本机默认server目录是另一个旧库（2物料）。未迁移、清空或恢复任一数据库，未更改连接配置。
Verification: 桌面dev编译成功并实际输出“库存业务窗口已打开”，自动恢复4291连接；/api/status initialized=true、v0.2.1。cargo test --manifest-path desktop/Cargo.toml --lib 18/18 PASS（含新增2项origin回归）；cargo fmt、git diff --check PASS。未点击切换本机以免启动/升级另一旧库；未进行登录后业务写入测试。未提交/发布。
Self-review / Acceptance: 修复权限误判并恢复原服务入口PASS；系统授权引导原则已向用户说明，此次无可授权的系统权限。
Next: 用户继续使用恢复的库存窗口；没有待执行修复，变更留在工作区。

## Active Task — 2026-10-14 备份分页与维护入口
Phase: IMPLEMENTATION / Direct。用户要求完整备份与恢复分页、找回手动清空入口，并询问为何不保持登录。
设计：备份API不变，沿用现有pagination样式，每页10条，页数随列表收缩钳制，新增备份回第一页；备份页新增本机维护入口，仅打开既有桌面维护窗口，复用open-recovery事件/菜单行为，不执行任何维护。浏览器显示顶部/托盘菜单指引。保持本机与远程数据区别及原确认机制。
登录只读证据：Library/HTTPStorages/easy-erp-desktop.binarycookies与com.aspeed.easy-erp.binarycookies分别对应开发可执行文件和打包App；两者当前令牌摘要都匹配4291数据库有效会话，分别11月13日20:39和20:14到期。开发启动和打包App存储身份不同导致此前需登录，现开发身份已重新登录。未修改Cookie/会话/有效期。
约束：不清空、不恢复、不迁移用户数据库；不更改自动登录时长。构建先输出隔离目录，测试使用独立4289服务与浏览器上下文；向dist交付保留旧assets防止正在运行窗口懒加载失败。
Next: 实现分页与仅打开维护窗口的桥接，补分页边界/选中恢复文件/维护入口回归，构建并跑相关双浏览器E2E及桌面测试。

Checkpoint — 备份分页完成，准备v0.2.2发布
用户最新授权“弄好了就推送发版”，覆盖此前不提交/发布限制。版本7文件同步0.2.2；发布说明docs/releases/v0.2.2.md涵盖自v0.2.1以来已合并但未发版的维护/更新/桌面流程及本次分页入口。
已实现每页10条、末页边界、列表收缩钳制、新备份回首页；备份页复用UpdateProvider识别桌面，网页版/移动版只显示指引。新native命令仅对当前inventory窗口的已连接origin开放，显示launcher并发送既有open-recovery事件，不授予业务窗口执行维护权限。
Verification: Chromium最终分页+维护8/8 PASS；先前备份策略及真实备份详情等其余9项PASS（首轮分页日期断言错误已改为选中文件的确切快照时间）；WebKit最终13项运行中。桌面0.2.2单测18/18 PASS；Node发布/更新权限5/5 PASS；typecheck、typecheck:e2e、隔离vite构建、Prettier、diff检查PASS。维护关闭→本机启动→再次打开维护新增断言在WebKit最终轮覆盖。未对真实数据执行维护。
本地Web产物已合并到dist且保留旧assets，避免旧窗口懒加载404；桌面开发进程0.2.2已编译并重新打开4291业务窗口。
Next: 等WebKit结果并复核版本/改动，提交已审查14文件、推送main和v0.2.2标签；跟踪完整tag Actions，所有门禁通过后验草稿资产签名/哈希并正式发布，匿名核对latest清单。不得把云端运行中说成已发布。
最终本地检查：WebKit13/13 PASS（含维护关闭后再次打开），版本与两锁文件精确一致0.2.2；工作区仅14个已审查交付文件，无生成文件。Self-review / 本次功能Acceptance PASS。即将提交并推送，正式发布仍等待完整tag云端门禁和资产验收。

Release checkpoint — v0.2.2推送完成
提交db6b4f04e5ec12f6cd203822a28caf3735037a1f与标签v0.2.2已推送origin，main此前与origin完全同步。完整tag流水线38567578546运行中；重复main流水线38567577935已请求取消。Web构建已通过，其余任务尚未结束。此前21e0ff9云端38244820238曾失败于两浏览器E2E和iOS打包，正在读取日志以预先核对是否影响本次；不把其状态当作成功。
发布验收复用既有minisign-verify0.2.5工具和v0.2.1公开密钥；build-artifacts/releases/v0.2.2/verify-assets.py已准备，待下载本次草稿23资产进行大小/hash/GitHub digest/四平台更新签名/macOS包内版本核对。所有资产与日志仍在ignored目录，不提交。
Next: 跟踪38567578546；如失败复现并最小修复，禁止绕过门禁。全部通过后核对草稿并正式发布、匿名latest入口验证，最后更新状态文档并推送[skip ci]记录。

Release gate correction — 2026-10-14
38567578546已取消且未创建Release；旧38244820238日志证实两项既有测试过时：维护时间断言写死新加坡时间（CI为UTC），业绩零行要求与已确认显示零业绩档案的实现冲突；调任测试find仅按业务员ID，零行/历史行顺序不保证。仅修测试：按浏览器本地格式验证精确快照时间；业务员+部门选历史行并额外验证count2/due2100/paid300；新部门零行全部金额0；UI零业绩行精确验证单数/金额。未改产品财务行为或降低断言。
验证Chromium相关16/16 PASS；UTC环境WebKit原失败3/3 PASS；typecheck:e2e与diff PASS。iOS旧失败为runner模拟器bootstatus超时，此次不做推测性代码改动，待新流水线实测。
Next: 提交这3个已审查文件并推送main，将未发布且已取消构建的v0.2.2标签以精确旧SHA lease更新到新提交；重新执行完整发布门禁。旧tag绝非已发布版本，无正式资产可覆盖。最终发布固定新的tag SHA。

当前发布源固定：99265f09460f7fd889840eb91c55ccce5dd6e47b，main与v0.2.2已推送一致；未发布tag通过旧SHA精确lease更新成功，旧构建已取消，无Release被覆盖。新完整tag流水线38568513174运行中；重复main38568495283已请求取消。以新流水线为唯一发布门禁来源。

Cloud checkpoint — 38568513174
Chromium完整169/169 PASS（日志build-artifacts/logs/v0.2.2-chromium.log，10分钟）；Windows/Linux checks、四桌面目标、Android、Web全部SUCCESS，Windows覆盖升级/数据保留与原生更新检查通过。iOS模拟器本次安装启动存活检查SUCCESS，无需修改重试策略；iOS真机签名仍按规则SKIPPED。唯一剩余为WebKit完整E2E，尚未正式发布。
Next: 等WebKit与release job成功后下载草稿全部资产，运行verify-assets.py，gh release edit正式发布，匿名核对latest与四平台URL。发布源仍为99265f0，不移动标签。
