# Easy ERP · 库存管理

面向小型工厂的轻量库存管理应用，以物料数量和简单操作为核心。

## 功能

- 物料管理、入库、出库、库存查询及清点。
- 管理员与工人账号、岗位权限及操作记录。
- 多物料销售开单、自定义单据类型、系统打印、折扣抹零、收款欠款、退款退货及签字凭证。
- SQLite 本地存储或 MySQL 服务器存储、定时备份、备份恢复及表格导入导出。
- Web 界面与 Tauri 桌面应用，支持局域网多人访问。
- 桌面托盘、可选开机自启，以及从桌面打开 Web。

## 服务器容器部署

服务器镜像支持 Linux amd64 / arm64，包含 Web，无需单独部署前端。镜像统一发布到 [GHCR](https://github.com/orgs/7link-team/packages/container/package/easy-erp-server)，Release 不再附带 Docker 镜像归档。从仓库下载 [compose.yaml](compose.yaml)（如需 MySQL 同时下载 [compose.mysql.yaml](compose.mysql.yaml)）。

使用版本标签 `ghcr.io/7link-team/easy-erp-server:v0.2.5` 固定版本，或 `:latest` 跟随最新构建。GHCR 当前为私有包，需使用具有包读取权限的 GitHub 账号登录。

```sh
docker login ghcr.io
docker pull ghcr.io/7link-team/easy-erp-server:v0.2.5
# 固定版本部署时，将 compose.yaml 的 image 标签改为 v0.2.5（默认 latest）
docker compose up -d
docker compose logs inventory
```

打开 `http://服务器地址:4280/`，首次选择 SQLite 或 MySQL，再创建管理员；没有内置账号密码。初始化口令在首次启动日志中，也可用 `docker compose exec inventory cat /data/setup-token` 查看。使用服务器 IP 或域名访问时，在 `.env` 设置 `ERP_ALLOWED_HOSTS=你的域名或IP`（多个用逗号分隔，不含协议和端口）。HTTPS 反向代理应保留原 Host，并设置 `ERP_SECURE_COOKIE=true`。代理后所有请求都来自代理地址，登录失败限流会把所有用户算作同一来源（一个人试错 15 次即锁住全部账号）；确认代理会设置 `X-Forwarded-For` 后，再设置 `ERP_TRUSTED_PROXY=true`，限流改按该头最后一段（代理自己追加、客户端无法伪造的那段）区分。未设置时行为不变。直接暴露到公网时不要开启此项。

- **SQLite**：直接选择本地 SQLite，数据库保存在 `/data/inventory.sqlite`。
- **MySQL**：需 MySQL 8.0.21 或更新版本，推荐 8.4；先创建空数据库并授予应用账号建表及读写权限。表单填写主机、端口、数据库、用户名、密码，可开启 TLS。连接失败会保留表单供重试，不会另建 SQLite 替代。
- **同时部署 MySQL**：在本地 `.env` 设置 `MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD`，运行 `docker compose -f compose.yaml -f compose.mysql.yaml up -d`。网页填写主机 `mysql`、端口 `3306`、数据库 `inventory`、用户名 `inventory` 及设定的应用密码。

`inventory-data` 持久卷保存配置、SQLite（如使用）、附件、完整备份和初始化口令；MySQL 的 `mysql-data` 也必须保留。普通重启和更新不会清空数据，勿用 `docker compose down -v` 删除持久卷。若改用宿主目录挂载，需让容器 UID/GID `10001:10001` 有读写权限。MySQL 连接设置保存在 `/data/database.json`，权限为 `0600`，不会返回给浏览器；也支持通过 `ERP_DATABASE_URL=mysql://...` 预配置（密码中特殊字符需 URL 编码），并通过 `ERP_SETUP_TOKEN` 指定至少16位的初始化口令。

已有数据目录会继续使用原配置。首次数据库选择不会自动迁移已有数据，也不能在启动时直接切换已有账本。桌面启动窗口同样支持首次选择 SQLite / MySQL；已配置时直接使用原数据库。

服务器管理员可在备份页生成、下载和恢复完整备份；MySQL 使用一致性快照并沿用包含附件的备份格式。桌面本机离线维护仍只用于 SQLite，MySQL 请在已连接的备份页面操作。

### 文件存储（本地目录 / S3）

数据库类型与文件存储分别配置：SQLite/MySQL 都可以配本地目录或 S3。新上传的签字、凭证图片写入文件存储，旧数据库内图片继续读取，无需搬迁。通过 Compose 的 `environment` 或服务器进程环境变量配置，修改后重启服务。

本地默认 `ERP_FILE_STORAGE=local`、`ERP_STORAGE_LOCAL_DIR=/data`。自定义路径须挂载持久目录并给予容器 `10001:10001` 读写权限。目录结构如下（日期为 UTC）：

```text
/data/
  inventory.sqlite             # 使用 SQLite 时
  attachments/<图片ID>          # 签字与凭证图片
  backups/
    policy.json                # 保留天数，独立于业务数据库
    2026/10/18/
      backup-20261018-....zip
      backup-20261018-....zip.json
  backup-staging/               # 生成完整备份时的临时空间
```

S3：下载 [compose.s3.yaml](compose.s3.yaml)，在部署目录 `.env` 配置后启动：

```dotenv
ERP_S3_BUCKET=inventory-files
ERP_S3_REGION=us-east-1
ERP_S3_ACCESS_KEY_ID=替换为访问密钥
ERP_S3_SECRET_ACCESS_KEY=替换为密钥密码
ERP_S3_PREFIX=inventory-production
# MinIO等兼容服务填写endpoint；AWS S3留空
ERP_S3_ENDPOINT=https://s3.example.com
ERP_S3_PATH_STYLE=true
```

```sh
docker compose -f compose.yaml -f compose.s3.yaml up -d
# 同时部署MySQL可再追加 -f compose.mysql.yaml（放在up之前）
```

S3 内使用同样的 `attachments/` 和 `backups/年/月/日/` 结构，位于指定 prefix 下。Bucket 须预先创建，凭据需要该 prefix 的列举、读取、写入、删除及分片上传/中止权限。默认 HTTPS；仅可信内网 HTTP 服务显式设置 `ERP_S3_ALLOW_HTTP=true`。临时凭据还可配置 `ERP_S3_SESSION_TOKEN`。每套库存系统使用独立 prefix；不要把不同系统共用一个目录。凭据不写入业务数据库或备份包。

备份包的校验和用于发现损坏，不能证明来源：能往 `backups/` 写入对象的人就能放入一个可被恢复的归档（其中可以包含对方自己的管理员账号）。因此存放备份的 prefix 必须视作与数据库同等敏感——不要与其他系统或他人共用 Bucket/prefix，写入凭据只授予该 prefix，并避免把本地存储目录指向网络共享或云同步文件夹。

完整备份把图片（包含历史凭证）嵌入包内，下载后可在无原 S3 配置的环境恢复。S3 模式仍需要 `/data` 持久卷保存实例配置和 SQLite（如使用），并需要本地空间生成/校验备份；临时文件在任务结束后删除。

备份页及本机维护直接扫描已配置的存储，**清空业务数据不删除备份和保留策略**。每份 ZIP 的 `.json` 是显示信息缓存，不是唯一索引；丢失或损坏时从 ZIP 内部清单读取，备份仍可发现。旧版平铺 `.zip` / `.erpbackup` 继续识别。默认保留7天，可在备份页设置1–365天；每小时成功生成完整备份后清理过期归档和对应 `.json`，始终保留最新一份，备份失败时不清理。S3开启版本控制时，删除仅生成删除标记，历史版本的空间回收需在Bucket生命周期策略中配置。上传中断（例如备份写入途中网络断开）可能留下未完成的分片上传，这部分空间不会自动释放，请同时配置中止未完成分片上传的生命周期规则。

切换本地/S3只影响新文件，不自动迁移历史文件。切回本地后须保留S3连接环境变量，才能访问原S3文件；更换本地根目录、Bucket或prefix前须迁移原目录内容。清空业务数据后会清理已配置存储中的凭证图片；备份包内的图片不受影响。若外置存储不可用，界面会报告图片清理未完成，可修复连接后再次执行清空。备份过期清理只管理备份目录，不删除附件。


## 开单与打印配置

在“基础资料 → 公司信息 → 设置公司信息”中选择新单的默认结算方式：全部收款、部分收款、全部欠款；未配置时沿用全部欠款。草稿保留原选择，无收款权限的账号不会预选收款。

同一处可设置打印单各项金额为“打印 / 不打印 / 为0时不打印”，默认剩余欠款不打印，其他金额为0时不打印；送货地址默认“为空不打印”。打印单右上角只显示单号和时间，明细底边保留，签字区不再重复显示应收、已收和欠款说明。

## 桌面数据保存位置

- **macOS**：业务数据默认保存到 `~/.EasyERP`，备份在 `~/.EasyERP/backups`，附件在 `~/.EasyERP/attachments`。这是用户主目录下的隐藏文件夹，可在 Finder 按 `Command + Shift + G` 输入 `~/.EasyERP` 打开，或使用应用里的“在文件管理器中查看”。
- **Windows**：继续使用已发布的 `~/EasyErp` 目录，安装和卸载策略不变。

macOS 旧版的 `~/Library/Application Support/com.aspeed.easy-erp/server` 会在本机服务未运行、目标目录不存在时整体迁移；数据库、WAL、账号配置、附件和已有备份一起保留，不合并两套目录。旧服务正在运行时先选择“全部退出（停止本机共享）”；目录冲突、符号链接或迁移失败时会提示并停止，不创建空库替代。仅剩备份、没有数据库的旧目录也会保留并迁移。明确配置的外置文件存储/S3 位置不变；如果 `ERP_STORAGE_LOCAL_DIR` 指向旧目录内部，需先迁移并更新该配置。

正常删除 macOS 的 `.app` 不会删除用户数据；第三方卸载工具可能清理 Application Support 关联目录。业务数据移出后可降低被关联清理的风险，但无法保证第三方工具永远不会删除它。连接设置与更新配置仍保存在 Application Support，丢失后需要重新设置连接，不代表业务数据丢失。重要备份仍应另存到其他磁盘或存储位置。

## 本机数据维护

桌面应用的启动窗口、应用菜单或托盘菜单中选择“本机数据维护”。库存服务启动失败时仍可进入；这里只操作页面上显示的本机数据目录，不会清空所连接的远程库存电脑。

- **清空数据（不含备份数据）**：删除当前业务、凭证图片、账号和设置，回到首次使用，启动后重新创建管理员。已有完整备份保留。
- **从备份恢复**：选择列表里的备份或外部 `.zip` / `.erpbackup` 文件，校验通过后替换当前数据。备份包含凭证图片，恢复后使用备份中的账号重新登录。
- **清空备份**：仅删除当前配置存储中的备份文件及配套元数据，不删除当前业务和图片；不会删除已复制到其他位置的备份。以后仍按原有自动备份计划生成新备份。

三个操作分别输入对应确认文字，并在二次提醒中核对目标和存储位置后才会执行；该提醒默认停在“取消”，按 Esc 或回车都不会执行。可勾选完成后启动，也可先连续维护再手动启动；支持先清空再恢复、先恢复再清空。维护会停止本机服务，请先让同事保存操作。离线清空和恢复不会强制另存当前数据，需保留的内容应先手动备份。

备份页的“系统信息”展示当前库存主机的数据库类型与配置来源、实际文件存储位置、监听地址、实例标识和备份统计；桌面本机模式还展示配置文件、日志、更新记录的路径、大小和修改时间。远程路径属于库存主机，S3 路径属于对象存储，不能在客户端文件管理器中打开。密码、密钥、初始化令牌和完整数据库连接串不会返回到信息面板。

桌面应用后台定时检查更新，发现新版后等待窗口可见、没有未保存内容或其他弹窗，并连续约 30 秒无操作再提示。同版本选择“稍后”后本次运行不反复提醒；安装和重启仍需确认。

## 技术栈

React、TypeScript、Vite、Radix UI；Rust、Axum、SeaORM、SQLite / MySQL；Tauri 2。

## 本地开发

需要 Node.js 22.12 或更高版本、Rust stable，以及当前系统的 Tauri 构建依赖。

```sh
npm ci
npm run desktop:dev
```

桌面启动前会构建前端与内置库存服务。

只调试 Web 时，先运行一次 `npm run build` 为服务准备嵌入页面，再在两个终端分别运行 `cargo run -p easy-erp-server -- --data-dir ./data --bind 127.0.0.1:4280` 和 `npm run dev`，打开 `http://127.0.0.1:5173/`。首次使用在页面创建管理员，没有内置默认密码。开发代理保留浏览器的 Host，供后端校验 Origin。

## 构建

```sh
npm run build
npm run desktop:build
```

桌面安装包位于 `desktop/target/release/bundle/`。Windows 安装包推荐在 Windows 构建环境生成，需安装 Visual Studio C++ 构建工具及 Windows SDK。

当前已验证本机 macOS 桌面和 Web；Windows、Linux、Android、iOS 不代表已经完成构建或验收。移动端目前可通过响应式 Web 使用。

## 验证

```sh
npm run build
cargo build -p easy-erp-server
cargo test --locked
npm run typecheck:e2e
npx playwright install chromium webkit
npm run test:e2e
ERP_E2E_BROWSER=webkit npm run test:e2e
```

Playwright 配置和测试代码纳入版本管理，GitHub Actions 在 Chromium 与 WebKit 中运行完整 E2E，并上传报告、截图和 PDF。运行报告不提交到仓库。

报告、截图、临时文件和检查缓存统一放在已忽略的 `build-artifacts/` 下：

| 目录                                   | 内容                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| `build-artifacts/playwright/chromium/` | Chromium 的 `report/` HTML 报告及 `results/` 测试截图、追踪等附件 |
| `build-artifacts/playwright/webkit/`   | WebKit 的报告和测试附件                                           |
| `build-artifacts/screenshots/`         | 原型和应用截图脚本产物                                            |
| `build-artifacts/tmp/`                 | 性能测试的合成数据库、结果及其他本地临时资料                      |
| `build-artifacts/cache/`               | TypeScript 增量检查缓存                                           |
| `build-artifacts/simulator-evidence/`  | iOS 模拟器启动检查的截图和日志                                    |

查看报告：`npx playwright show-report build-artifacts/playwright/chromium/report`（WebKit 将 `chromium` 换为 `webkit`）。同一浏览器的新一轮测试会替换其报告及结果；需要保留某轮证据时，将整轮目录复制到 `build-artifacts/playwright/archive/`，不要另建根目录报告文件夹。测试中的截图使用 `test.info().outputPath(...)`，随用例输出到对应浏览器的结果目录。

本地已有的根目录 `playwright-report*`、`test-results` 已归档到 `build-artifacts/playwright/archive/`，原 `tmp/` 迁至 `build-artifacts/tmp/`；历史验收文档中的旧路径按此对应查找。工具标准目录 `node_modules/`、`dist/`、`target/` 和 `desktop/target/` 保留原位置。

设计系统见 [`design-system/v2/DESIGN.md`](design-system/v2/DESIGN.md)。真实应用的主题令牌集中在 `src/theme.css`，打印使用独立配色；原型与实装的差异列在设计文档第 18 节。

```sh
python3 -m http.server 8912 --directory design-system/v2 # 另开终端运行，打开 preview.html
node scripts/review.mjs      # 原型静态检查：溢出 / 裁切 / 字号下限 / 无障碍名
node scripts/review2.mjs     # 原型交互检查：弹窗焦点、可输入下拉、权限、字号档位
node scripts/contrast.mjs    # 先在环境中设置 ERP_USERNAME / ERP_PASSWORD；可用 ERP_URL 指定预览地址
```

验收说明见 `docs/`。

视觉脚本发现问题会以非零状态退出；真实应用检查必须先通过浏览器登录。对比度脚本抽查 5 个页面的深浅主题、三档字号和桌面/手机视口；渐变、图片、整体透明度背景需人工核对，不能据此宣称全站无障碍达标。

多平台 GitHub Actions、Release 和自动更新的签名配置见 [发布与自动更新](docs/发布与自动更新.md)。工作流会先构建安装包；正式更新还需要配置发布仓库与签名 Secrets，iOS 真机包另需 Apple 分发资料。
