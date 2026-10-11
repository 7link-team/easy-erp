# Task State

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
