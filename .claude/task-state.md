# Task State

## Task / Phase
打印显示、默认结算、网页及桌面首次SQLite/MySQL选择、GitHub服务器镜像发布：ACCEPTANCE / COMPLETE。
Direct执行，无子代理。使用ui-ux-pro-max，沿用原组件、权限、版本及备份机制。

## Delivered Requirements
- 打印右上角仅单号/业务日期；明细最后行底边可见。
- 公司信息可逐项配置8金额always/never/nonzero；debt默认never，其余nonzero。
- 送货地址always/never/nonempty，默认nonempty；底部重复欠款说明已删除，保留签字/日期。
- 默认结算full/partial/unpaid；未配置沿用unpaid，仅新单应用，草稿保留原选择，无sales.pay不预选收款。
- 用户明确确认网页和桌面启动窗口都支持首次SQLite/MySQL选择。MySQL主机/端口/库/用户名/密码/TLS表单；失败保留重试，配置原子写入database.json0600，不回传密码。
- Desktop通过既有trusted IPC和stdin配置，不在argv传密码；配置已保存但服务启动失败后直接沿用原配置重试。
- SQLite原数据目录直接复用；MySQL通过实际backend参数化SQL执行，支持库存、销售、财务、导入及一致性完整备份/事务恢复。MySQL连接失败不另建SQLite，不自动迁移已有账本。
- Docker runtime非root10001，/data持久卷、内嵌Web、healthcheck；compose两种部署示例和初始化口令说明已交付。

## Original User Service — Preserve
- http://127.0.0.1:4291/；数据 build-artifacts/tmp/desktop-v0.2.1-test；桌面connection.json保持remote该地址。
- 最终服务exec21357，target/debug/easy-erp-server --bind0.0.0.0:4291 --web-dir dist；实际flags有正常空格，勿改数据目录。最后status initialized=true、instance_id64ccfd16-a314-493d-bd12-b0023b00854a。
- 最后只读核对：1用户、5物料、10库存单、5销售单。用户工作期间新增1单，不能用旧9/4数量误判数据改变。未向原库写测试数据、清空或恢复。
- 安全副本：build-artifacts/tmp/before-print-config-20261017.sqlite、before-server-config-20261017.sqlite。
- dist合并最新Web并保留旧assets，原会话/连接及已有数据继续使用。
- 4280/5173为之前误开的空./data开发服务，不能当作原库。4290另有既有tmp/demo-sales-tk87dgiu预览进程，未触碰；隔离手动MySQL4290已停止。

## Source / Git
- 功能bfcb098；首次MySQL8 RSA认证修复c361713；容器重启临时端口检查修复a10a9de；桌面配置已落盘后的启动重试修复170435f；公开镜像归档与说明b21570f，均已推送main。
- 镜像源固定a10a9dedb0a1fec092a3fa4f24259c7d62ed436c。后续只有desktop UI/tests、发布工作流和文档改变，服务器生产构建内容与该源一致。
- 既有桌面v0.2.2标签仍99265f09460f7fd889840eb91c55ccce5dd6e47b；GitHub latest Release仍v0.2.2，未移动标签或发布新桌面安装包。

## Published Server Images
- GHCR ghcr.io/7link-team/easy-erp-server:latest 以及sha-a10a9dedb0a1fec092a3fa4f24259c7d62ed436c。
- 多架构manifest sha256:69e352d430eb82db88dd5db41f1d59e421d63dd0fd3e64a0aa7cb3f1fad93428。
- linux/amd64 sha256:53e9f4a60d80e79f8be9fe62bb8677abd47febdb7cce737b022d11547f4ac052；linux/arm64 sha256:3bbde651fbe1466b504eef60aba0058113bf4a522bacb099ee16b194a05b2093。
- GHCR默认私有，匿名拉取已实测401；README明确需要包读取权限。已额外发布无需登录的GitHub镜像归档，避免用户部署受阻。
- 公开Release：https://github.com/7link-team/easy-erp/releases/tag/server-a10a9dedb0a1，正式非草稿、非预发布，latest=false，不影响桌面更新。
- 6资产：两架构tar.gz、compose.yaml、compose.mysql.yaml、DEPLOY.md、SHA256SUMS。
- amd64 40984737字节，SHA256 f5cb348f6d7681a4c64540d06d7beae7577c589dd652c413a8311ab82dfad951。
- arm64 40264814字节，SHA256 fd5ded41dea37f3d7468904a72ad02f4ef1894d789f641d63d30e664dc9c2de5。
- 下载对应架构tar.gz后docker load -i，再docker compose up -d；网页首次选择数据库并创建管理员。没有内置服务器密码；初始化口令从日志或/data/setup-token获取。

## Verification — PASS
- Rust12单元+8维护/初始化集成；其中真实MySQL冷账号首次连接（RSA）、网页初始化、重启保留、完整备份恢复PASS。
- Desktop18原生单测；Node6发布/权限检查；TS/e2e类型、Rust两workspace fmt、改动文件Prettier、JS语法、diff检查PASS。
- 本地SQLite完整171/171，新增网页/桌面初始化Chromium8/8、WebKit8/8；后续桌面部分成功重试先复现FAIL再修复，desktop-recovery整文件Chromium8/8、WebKit8/8 PASS。
- 标准4289+全新MySQL业务56/56 PASS。仅排除两项直接改SQLite旧文件的fixture，SQLite完整suite仍覆盖。
- 最终云端服务器run39002864227全部SUCCESS：SQLite174/174（10m）、MySQL56/56及Rust20、原生amd64/arm64构建+初始化/登录/重启smoke、合并发布。
- 最终本机构建镜像SQLite及全新MySQL账号容器smoke均PASS；真实MySQL TLS=true CLI初始化PASS。
- 公共归档run39004350572全部SUCCESS：两架构从GHCR实际pull、校验architecture/OCI源SHA、native smoke后导出并正式发布。
- 匿名下载amd64归档并校验大小/SHA256 PASS；两架构和Compose的SHA256SUMS均与GitHub资产digest匹配；arm64匿名URL HTTP/2 200 PASS（初次检查误写HTTP1式200 OK，已按协议无关状态码复核）。
- 实际公开下载amd64 docker load→architecture/OCI源SHA→初始化/管理员登录/写入/重启保留smoke PASS；随后独立Compose项目up成功进入首次初始化，测试卷/容器/网络已清理。
- 目视核对打印截图：头部、底边、默认金额/地址、无底部欠款段正确。

## Evidence / Cleanup
- 证据均ignored：build-artifacts/tmp/{cloud-mysql-final.log,cloud-sqlite-final.log,cloud-server-publish.log,public-server-image-smoke.log,server-release-api.json}、build-artifacts/releases/server-a10a9dedb0a1/。
- 本地隔离MySQL easy-erp-mysql-check:43306及测试镜像仍保留供复验，不是用户数据；测试账号仅用于隔离容器。
- Self-review Scope/Reuse/Architecture/Regression/Complexity/Data preservation：PASS。
- Final Acceptance 全部原需求：PASS；唯一运行限制为GHCR包需要认证，已提供并实际验证公开归档部署途径。

## Next Action
提交此验收记录[skip ci]并确认main已推送、worktree clean；然后向用户交付原4291入口、公司信息配置入口和公开服务器镜像Release。功能/测试/发布无待办，不需要用户确认。

## Last Checkpoint
2026-10-17 13:00 SGT，公开镜像下载/加载/Compose/重启检查均完成。
