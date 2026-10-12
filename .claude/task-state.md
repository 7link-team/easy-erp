# Task State

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
