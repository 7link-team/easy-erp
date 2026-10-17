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

服务器镜像支持 Linux amd64 / arm64，包含 Web，无需单独部署前端。从 [GitHub 服务器镜像 Release](https://github.com/7link-team/easy-erp/releases/tag/server-a10a9dedb0a1) 下载对应架构的 `.tar.gz`、`compose.yaml`（如需 MySQL 同时下载 `compose.mysql.yaml`），可使用同页的 `SHA256SUMS` 校验文件。

GHCR 地址为 `ghcr.io/7link-team/easy-erp-server:latest`，也有 `sha-完整提交SHA` 固定标签。GHCR 当前为私有包，直接拉取需要具备包读取权限；使用公开的 Release 镜像文件加载后，Compose 可以直接启动。

```sh
# Intel/AMD；ARM64 将文件名中的 amd64 替换为 arm64
docker load -i easy-erp-server-linux-amd64.tar.gz
docker compose up -d
docker compose logs inventory
```

打开 `http://服务器地址:4280/`，首次选择 SQLite 或 MySQL，再创建管理员；没有内置账号密码。初始化口令在首次启动日志中，也可用 `docker compose exec inventory cat /data/setup-token` 查看。使用服务器 IP 或域名访问时，在 `.env` 设置 `ERP_ALLOWED_HOSTS=你的域名或IP`（多个用逗号分隔，不含协议和端口）。HTTPS 反向代理应保留原 Host，并设置 `ERP_SECURE_COOKIE=true`。

- **SQLite**：直接选择本地 SQLite，数据库保存在 `/data/inventory.sqlite`。
- **MySQL**：需 MySQL 8.0.21 或更新版本，推荐 8.4；先创建空数据库并授予应用账号建表及读写权限。表单填写主机、端口、数据库、用户名、密码，可开启 TLS。连接失败会保留表单供重试，不会另建 SQLite 替代。
- **同时部署 MySQL**：在本地 `.env` 设置 `MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD`，运行 `docker compose -f compose.yaml -f compose.mysql.yaml up -d`。网页填写主机 `mysql`、端口 `3306`、数据库 `inventory`、用户名 `inventory` 及设定的应用密码。

`inventory-data` 持久卷保存配置、SQLite（如使用）、附件、完整备份和初始化口令；MySQL 的 `mysql-data` 也必须保留。普通重启和更新不会清空数据，勿用 `docker compose down -v` 删除持久卷。若改用宿主目录挂载，需让容器 UID/GID `10001:10001` 有读写权限。MySQL 连接设置保存在 `/data/database.json`，权限为 `0600`，不会返回给浏览器；也支持通过 `ERP_DATABASE_URL=mysql://...` 预配置（密码中特殊字符需 URL 编码），并通过 `ERP_SETUP_TOKEN` 指定至少16位的初始化口令。

已有数据目录会继续使用原配置。首次数据库选择不会自动迁移已有数据，也不能在启动时直接切换已有账本。桌面启动窗口同样支持首次选择 SQLite / MySQL；已配置时直接使用原数据库。

服务器管理员可在备份页生成、下载和恢复完整备份；MySQL 使用一致性快照并沿用包含附件的备份格式。桌面本机离线维护仍只用于 SQLite，MySQL 请在已连接的备份页面操作。

## 开单与打印配置

在“基础资料 → 公司信息 → 设置公司信息”中选择新单的默认结算方式：全部收款、部分收款、全部欠款；未配置时沿用全部欠款。草稿保留原选择，无收款权限的账号不会预选收款。

同一处可设置打印单各项金额为“打印 / 不打印 / 为0时不打印”，默认剩余欠款不打印，其他金额为0时不打印；送货地址默认“为空不打印”。打印单右上角只显示单号和时间，明细底边保留，签字区不再重复显示应收、已收和欠款说明。

## 本机数据维护

桌面应用的启动窗口、应用菜单或托盘菜单中选择“本机数据维护”。库存服务启动失败时仍可进入；这里只操作页面上显示的本机数据目录，不会清空所连接的远程库存电脑。

- **清空数据（不含备份数据）**：删除当前业务、凭证图片、账号和设置，回到首次使用，启动后重新创建管理员。已有完整备份保留。
- **从备份恢复**：选择列表里的备份或外部 `.zip` / `.erpbackup` 文件，校验通过后替换当前数据。备份包含凭证图片，恢复后使用备份中的账号重新登录。
- **清空备份**：仅删除本机备份目录中的备份文件，不删除当前业务和图片；不会删除已复制到其他位置的备份。以后仍按原有自动备份计划生成新备份。

三个操作分别输入对应确认文字。可勾选完成后启动，也可先连续维护再手动启动；支持先清空再恢复、先恢复再清空。维护会停止本机服务，请先让同事保存操作。离线清空和恢复不会强制另存当前数据，需保留的内容应先手动备份。

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
