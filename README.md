# Easy ERP · 库存管理

面向小型工厂的轻量库存管理应用，以物料数量和简单操作为核心。

## 功能

- 物料管理、入库、出库、库存查询及清点。
- 管理员与工人账号、岗位权限及操作记录。
- 多物料销售开单、自定义单据类型、系统打印、折扣抹零、收款欠款、退款退货及签字凭证。
- SQLite 本地存储、定时备份、备份恢复及表格导入导出。
- Web 界面与 Tauri 桌面应用，支持局域网多人访问。
- 桌面托盘、可选开机自启，以及从桌面打开 Web。

## 技术栈

React、TypeScript、Vite、Radix UI；Rust、Axum、SeaORM、SQLite；Tauri 2。

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
