# Task State

## Task / Objective
用户授权「提交推送发版吧」：发布本地/S3文件存储及独立备份功能为v0.2.4，包含桌面/移动端安装产物和GHCR服务器双架构镜像。

## Current Phase / Current Step
COMPLETE / 发布与公开下载核验完成。Direct执行，无子代理。最终发布记录提交使用[skip ci]；产物源码标签保持不变。

## Delivered
- 附件、签字图片、完整备份支持本地目录/S3兼容存储，通过Compose/环境变量配置；SQLite/MySQL均支持。
- 新上传图片外置、旧BLOB兼容；完整备份嵌入历史/外部图片，可脱离原Bucket恢复，支持在线及桌面离线维护。
- attachments/与backups/YYYY/MM/DD/隔离（UTC）；每归档JSON侧车，列举存储为准，缺少侧车时回读ZIP。
- backups/policy.json独立于业务数据库，清空业务后仍发现备份/保留策略；成功备份后清理到期文件/侧车，保留最新一份。
- Compose支持数据库及初始化变量，新增compose.s3.yaml与README说明；未实现未获授权的锁定备份/主动失败提醒建议。

## Published
- Release：https://github.com/7link-team/easy-erp/releases/tag/v0.2.4，正式Latest，draft=false/prerelease=false，共23个文件。
- 源码tag：v0.2.4 → d3f88641e0ed4d48dea7176fee210e0ff347c2ac。
- 源码提交：15c9f77（功能/版本）、4b09f23（Windows递归备份验收）、d3f8864（关闭上传错误处理/本地ZIP清单读取）。
- 镜像：ghcr.io/7link-team/easy-erp-server:v0.2.4，支持linux/amd64与linux/arm64；latest由成功main镜像构建发布。
- 镜像manifest：sha256:b0cea0f0b74f0260234dfd0cfc237861ce9d9174646412de90c0b9da3deacf1f。
- GHCR包仍private，读取需有权限账号登录；Release有GHCR版本拉取命令和Compose链接，无镜像归档。

## Verification — PASS
- Build and release 39101817546最终SUCCESS（同一SHA，WebKit单项重跑）；Windows/Linux检查、所有启用平台构建与升级/原生验收通过。
- Chromium180/180、WebKit180/180。WebKit首轮172/180无断言失败但30分钟job超时；仅重跑该job后180/180通过（15.8分钟），未放宽断言或超时。
- Server container39101817466SUCCESS：SQLite/MySQL检查、双架构构建/容器冒烟/发布。
- Publish verified build39105442533SUCCESS：复用上述成功构建产物；tag触发重复Build39105440635已取消，未重复打包。
- 版本镜像39105446339与release.published触发39105742523均SUCCESS，架构和源manifest一致。
- 发布前检查23个资产，22项清单digest与GitHub资产digest完全一致；四平台更新URL/签名存在且版本0.2.4。只下载latest.json与SHA256SUMS，未下载全部二进制/未做本轮所有包的密码学签名独立验签。
- 发布后匿名latest/download/latest.json与已验证文件逐字节一致；API latest=v0.2.4。
- 本地实际SQLite/隔离MySQL/Moto S3测试：12单元+11集成（两类可选环境均明确启用）通过；10MiB分片、在线/离线S3恢复、清空后发现/策略、脱离原S3恢复、旧BLOB/旧目录兼容、恶意外部引用拒绝均通过。
- 最后错误处理修复：13单元通过及桌面维护真实进程测试通过；该轮本地MySQL/S3未启用，不重复声称覆盖。云端相应门禁通过。
- cargo fmt/git diff检查PASS。范围、架构、回归、自审及原需求验收PASS。

## Resolved Issues
- Windows安装测试旧平铺目录假设：改递归搜索ZIP，保持至少两份备份断言。
- object_store关闭失败后abort导致Already shut down panic：只在copy失败时abort，shutdown失败正常返回500；目标冲突回归验证原文件保留且后续上传正常。
- 本地无侧车备份列表复制ZIP造成变慢：直接从原ZIP读取清单；S3仍流式暂存。
- Windows桌面测试改用递归扫描的相对路径，避免Rust扩展绝对路径差异。

## Live Service / Data Preservation
- 用户服务http://127.0.0.1:4291/，数据build-artifacts/tmp/desktop-v0.2.1-test/inventory.sqlite。
- 原服务二进制target/debug/easy-erp-server报告0.2.2，发布后/api/status健康且initialized=true；本次发版未替换/重启或改动业务数据。
- 不可对用户4291进行测试或覆盖原二进制。未来本地验收使用固定Web快照目录，避免dist重建破坏旧窗口动态加载。
- 浏览器测试须隔离cookie hostname/WebView数据目录，不能只换端口。

## Cleanup / Constraints
- 云端构建，未在本地下载大型安装包/镜像。已清理本轮storage-target、storage-test-tmp、不完整WebKit证据下载及临时桌面测试副本；文本日志保留。
- 项目盘可用约104GiB，系统可用约25GiB。未清理Docker数据卷、未触碰其他项目/用户备份。
- 既有MySQL测试容器easy-erp-mysql-check已恢复停止状态，Moto/临时测试库已清理。
- S3实测为Moto兼容端点，不是实际AWS/MinIO；macOS ad-hoc签名，iOS仅模拟器包。

## Evidence
build-artifacts/tmp/storage-acceptance-tests.log；v024-storage-fix-tests.log；v024-fixed-desktop-test.log；v024-webkit-final.log；v024-image-version.log；v024-release-metadata/；v024-public-latest.json。大文件测试副本已清理。

## Remaining Work / Next Action
功能/发布/镜像无待办。提交推送本最终记录[skip ci]，确认工作树干净且与origin/main同步后交付。无需用户审批。

## Last Checkpoint
2026-10-18，v0.2.4正式发布、公开Latest清单及GHCR版本镜像均核验完成。
