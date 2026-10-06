# 开发与构建

本文说明如何从源码运行、检查和构建 Markit。项目使用 Tauri 2、Rust、React、TypeScript 和 Vite。

## 环境准备

- Windows、macOS 或 Linux x64
- Node.js 24 LTS 和 npm
- Rust stable、Cargo 和 Tauri CLI
- Linux：WebKitGTK 4.1、GTK3、librsvg、patchelf
- Pandoc 仅在需要扩展格式导入导出时安装

获取源码并安装依赖：

```bash
git clone https://github.com/iawnix/markit.git
cd markit
npm ci
```

依赖版本以 `package-lock.json` 和 `apps/desktop/src-tauri/Cargo.lock` 为准。Tauri 使用系统 WebView，不下载或打包 Chromium。

Fedora 44 可安装构建依赖：

```bash
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel patchelf rpm
```

`cargo check` 不需要图形会话；`npm run tauri:dev` 和实际桌面启动需要可用的 Wayland/X11 显示环境。无头服务器上应使用 `cargo check` 或 CI runner 验证编译，不要把 GTK 初始化失败当作构建失败。

## 开发和检查

启动桌面开发环境：

```bash
npm run tauri:dev
```

常用检查：

```bash
npm run typecheck
npm run tauri:frontend
npm run test:e2e
npm run plugin:citations
git diff --check
```

核心测试使用 Vitest：

```bash
npm test
```

前端构建结果位于 `dist/desktop`。Tauri 本地构建结果位于 `apps/desktop/src-tauri/target/release/bundle`。

桌面端会把未保存文稿的恢复记录写入 Tauri 应用配置目录。启动时发现恢复记录会先询问是否恢复；选择拒绝或所有文稿保存成功后，记录会被清理。恢复文件只保存当前文稿内容和编辑元数据，不会自动覆盖磁盘文件。

## Linux 构建

在 Linux x64 环境执行：

```bash
npm run tauri:build
```

同时构建 AppImage、DEB 和 RPM：

```bash
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles appimage,deb,rpm
```

产物包括：

| 产物 | 适用场景 |
| --- | --- |
| AppImage | Manjaro/Arch 及其他 Linux 发行版 |
| DEB | Ubuntu/Debian |
| RPM | Fedora/RHEL |
| tar.gz | 不使用系统包管理器的 Linux 环境 |

Tauri Linux 程序使用系统 WebKitGTK。AppImage 不是自带 Chromium 的完全独立包；缺少 FUSE 时可以使用 `--appimage-extract-and-run`，或使用 tar.gz。DEB/RPM 会声明必要的 GTK 和 WebKitGTK 依赖。

## Windows 和 macOS 构建

Windows：

```powershell
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles nsis
```

macOS：

```bash
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles app,dmg
```

正式发布应在目标平台原生 runner 上构建。发布工作流位于 `.github/workflows/release.yml` 和 `.github/workflows/tauri-build.yml`。

## 插件开发

插件是 `.markit-plugin` ZIP 包，至少包含 `manifest.json` 和入口模块。入口代码运行在独立 Worker 中，文件、网络、设置和文档写入必须声明并通过权限代理请求。

构建 citations 插件：

```bash
npm run plugin:citations
```

插件 SDK、权限模型和面板贡献方式见 [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) 以及 [`plugins/citations/README.md`](../plugins/citations/README.md)。

## 许可证和发布检查

生成第三方依赖清单：

```bash
npm run notices
```

发布前至少检查：

- `npm run typecheck`
- `npm run tauri:frontend`
- `npm run plugin:citations`
- `git diff --check`
- 目标平台安装包启动、打开 Markdown、保存和卸载

第三方许可证和来源见 [`ThirdPartyNotices.md`](ThirdPartyNotices.md)。
