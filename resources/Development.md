# 开发与构建

Markit 使用 Tauri 2、Rust、React、TypeScript 和 Vite。桌面应用位于 `apps/desktop`，共享模块位于 `packages`。

## 环境准备

- Node.js 24 LTS 和 npm
- Rust stable 和 Cargo
- [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)

```sh
git clone https://github.com/iawnix/markit.git
cd markit
npm ci
```

JavaScript 和 Rust 依赖版本分别记录在 `package-lock.json` 与 `apps/desktop/src-tauri/Cargo.lock`。

## Linux 依赖

桌面运行时使用 WebKitGTK 4.1 和 GTK3。Ubuntu / Debian 安装运行依赖：

```sh
sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0
```

Ubuntu 24.04 构建环境：

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev librsvg2-dev patchelf rpm
```

Fedora 构建环境：

```sh
sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel patchelf rpm
```

AppImage 使用系统 WebKitGTK 运行库。缺少 FUSE 时，可通过 `./Markit-<version>-Linux-x64.AppImage --appimage-extract-and-run` 启动，也可使用 tar.gz 包。

## 本地开发

```sh
npm run dev
```

该命令启动 Vite 和 Tauri 桌面窗口。Linux 桌面启动需要 Wayland 或 X11 会话。在无头环境中，可运行类型检查、Rust 检查和浏览器交互测试：

```sh
npm run typecheck
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run test:desktop-ui
```

完整测试说明见[测试指南](Validation.md)。前端构建结果位于 `dist/desktop`，桌面安装包位于 `apps/desktop/src-tauri/target/release/bundle`。

## 构建安装包

在目标操作系统中执行对应命令。

Linux：

```sh
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles appimage,deb,rpm
```

Windows：

```powershell
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles nsis
```

macOS：

```sh
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles app,dmg
```

发布工作流另外将 Windows 可执行文件打包为 ZIP，将 Linux 可执行文件打包为 tar.gz。

## 插件开发

```sh
npm run plugin:citations
```

生成文件为 `plugins/citations/dist/markit.citations.markit-plugin`，可从应用设置中的“安装插件”导入。接口、权限和示例见[插件开发指南](Extensions.md)。

## 发布

1. 同步更新根目录 `package.json`、`package-lock.json`、Tauri 配置、`Cargo.toml` 和 `Cargo.lock` 中的应用版本。
2. 运行类型检查、单元测试、前端交互测试、前端构建和插件构建。
3. 在目标平台检查安装包启动、文稿打开与保存、关闭确认、导出和卸载。
4. 提交改动并推送对应的 `vX.Y.Z` 标签。
5. 等待 [Release 工作流](../.github/workflows/release.yml) 完成，核对附件并填写版本说明。

工作流在 Windows、macOS 和 Linux runner 上构建、测试并检查安装包，上传 Citations 插件，生成 `SHA256SUMS.txt` 后发布 GitHub Release。日常分支构建由 [Tauri build 工作流](../.github/workflows/tauri-build.yml) 执行。

## 历史 Electron 工程

`src/main`、`src/renderer` 和部分 `src/shared` 模块属于 Electron 工程。相关命令使用 `:legacy` 后缀：

```sh
npm run dev:legacy
npm run build:legacy
npm run test:e2e:legacy
```

## 第三方依赖记录

```sh
npm run notices
```

该命令收集已安装 npm 依赖的许可证和来源。记录格式及组件署名要求见[第三方说明](ThirdPartyNotices.md)。
