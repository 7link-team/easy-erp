# Easy ERP · 库存管理

面向小型工厂的轻量库存管理应用，以物料数量和简单操作为核心。

## 功能

- 物料管理、入库、出库、库存查询及清点。
- 管理员与工人账号、岗位权限及操作记录。
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
```

Playwright 配置、测试代码及运行报告仅保留在本地，不纳入仓库。

设计与验收说明见 `design-system/` 和 `docs/`。

多平台 GitHub Actions、Release 和自动更新的签名配置见 [发布与自动更新](docs/发布与自动更新.md)。工作流会先构建安装包；正式更新还需要配置发布仓库与签名 Secrets，iOS 真机包另需 Apple 分发资料。
