# 开发与构建

本文面向从源码运行、测试和打包 Markit 的开发者。安装使用说明见[项目首页](../README.md)。

## 环境准备

- Windows、macOS 或 Linux x64。发布包应在目标平台原生构建。
- Node.js 24 LTS、npm 和 Rust stable。Windows 发布工作流使用 Node.js 24。
- Linux 需要 WebKitGTK 4.1、GTK3、librsvg 和 patchelf；Fedora、Manjaro 使用发行版对应的 WebKitGTK/GTK3 包。
- Pandoc 仅用于扩展格式的导入、导出和相关集成验证。

可下载 GitHub 按版本标签生成的 [Source code (zip)](https://github.com/iawnix/Markit/archive/refs/tags/v0.4.0.zip)，或克隆仓库：

```bash
git clone https://github.com/iawnix/Markit.git
cd Markit
npm ci
npm run tauri:dev
```

依赖以 `package-lock.json` 和 `apps/desktop/src-tauri/Cargo.lock` 为准。Tauri 在构建时使用系统 WebView，不下载或打包 Chromium。

`npm run tauri:dev` 构建前端并启动 Tauri。浏览器前端检查使用 `npm run tauri:frontend`，不能通过普通浏览器获得完整的文件和窗口功能。

## 检查与测试

```bash
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npm run test:e2e
npm run test:ui
```

`npm test` 运行 Vitest 测试；`test:e2e` 和 `test:ui` 使用 Playwright 启动真实 Electron 程序。功能专项验证命令见[验证记录](Validation.md)，包括编辑事务、光标定位、大图粘贴、学术引用、导出及实际打包程序。

UI 验证使用独立数据目录，结果和截图写入 `test-results`。部分集成检查需要 Pandoc、Zotero、Word 或额外工具，应按验证记录准备对应环境；跳过的检查不代表已通过。

## Linux 打包

在 Ubuntu、Fedora、Manjaro 或其他 Linux x64 环境中执行：

```bash
npm run tauri:build
```

Tauri 的可执行文件位于 `apps/desktop/src-tauri/target/release/markit`。GitHub Actions 会在 Ubuntu 24.04 runner 中生成可分发产物：

```bash
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles appimage,deb,rpm
```

输出包括：

| 本地产物 | 用途 |
| --- | --- |
| `Markit-<版本>-Linux-x64.AppImage` | 适合多数 Linux 发行版的单文件包 |
| `Markit-<版本>-Linux-x64.deb` | Ubuntu/Debian 安装包 |
| `Markit-<版本>-Linux-x64.rpm` | Fedora/RHEL 及其他 RPM 发行版安装包 |
| `Markit-<版本>-Linux-x64.tar.gz` | Manjaro/Arch 及其他发行版的解压运行包 |

安装方式示例：

```bash
# Ubuntu/Debian
sudo apt install ./Markit-<版本>-Linux-x64.deb

# Fedora/RHEL
sudo dnf install ./Markit-<版本>-Linux-x64.rpm

# Manjaro/Arch 或其他发行版
tar -xzf Markit-<版本>-Linux-x64.tar.gz
./Markit-<版本>-Linux-x64/markit

# AppImage
chmod +x Markit-<版本>-Linux-x64.AppImage
./Markit-<版本>-Linux-x64.AppImage
```

Linux 构建使用系统 WebKitGTK，AppImage 不是自带 Chromium 的完全独立包。Ubuntu/Debian 的 DEB 和 Fedora/RHEL 的 RPM 会声明 WebKitGTK/GTK3 依赖；Manjaro/Arch 优先使用 AppImage 或 tar.gz，并确保系统安装对应 WebKitGTK。系统没有 FUSE 时可使用 `--appimage-extract-and-run`，或改用 tar.gz。发布 Linux 包时应在目标平台或兼容的 Linux x64 环境中构建，以保持系统库兼容。

## Windows 与 macOS 打包

```powershell
npm run tauri:build
```

Tauri 的 Windows 可执行文件位于 `apps/desktop/src-tauri/target/release/markit.exe`。生成 NSIS 安装程序使用：

```powershell
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles nsis
```

macOS 使用同一命令并指定 `--bundles app,dmg` 生成 `.app` 和 `.dmg`。正式发布包由 GitHub Actions 在各平台原生 runner 上生成，Windows ZIP 只包含 `Markit.exe` 便携可执行文件。

本地构建产物保存在 `apps/desktop/src-tauri/target/release/bundle`。正式 Release 只上传安装包和便携包，GitHub 会自动生成源码归档；依赖许可证与第三方说明保留在源码的 `resources` 目录中。

## GitHub 发布

仓库的 [Release 工作流](https://github.com/iawnix/Markit/blob/main/.github/workflows/release.yml)支持推送 `v*.*.*` 标签触发，也支持手动指定已有标签。标签必须与 `package.json` 中的版本一致。工作流在 Windows、macOS 和 Ubuntu x64 runner 上分别构建，再集中上传 Windows 安装程序与 ZIP、macOS DMG、Linux AppImage/DEB/RPM/tar.gz。

Linux AppImage 依赖宿主机 WebKitGTK/GTK3；DEB 和 RPM 会声明对应运行时依赖。工作流会检查每个文件存在且非空，并在 Release 页面上传前再次核对文件名。

## 运行与排错

可通过命令行打开含中文或空格路径的文稿：

```powershell
.\Markit.exe "C:\文稿\研究笔记.md"
```

Windows 安装版和 ZIP 数据通常位于 `%APPDATA%\Markit`；Linux 通常位于 `~/.config/Markit`，或 `XDG_CONFIG_HOME` 指定的位置。恢复记录可能包含完整未保存文稿。

工作区扫描使用系统 Windows PowerShell 读取隐藏与重解析点属性。受权限限制的子目录会跳过；PowerShell 被系统策略禁用时会报告扫描失败。搜索跳过符号链接和目录联接，避免循环遍历。

编辑器内部使用 LF，打开文件时记录 UTF-8 BOM 和换行格式。保存使用同目录临时文件、原子替换和内容摘要检查。恢复记录约在修改后 220 毫秒写入；启用自动保存的有路径文稿约在停输 1.1 秒后写回，恢复稿首次手动保存前禁止自动写回。

图片导入限制：静态图片最多 2.56 亿像素；动画或多页图片合计最多 8000 万像素、500 帧；单文件最多 64 MiB，每批最多 100 张且总计不超过 256 MiB。大图默认生成 2048 像素以内的缓存缩略图。PNG 导出最长边不超过 16,384 像素、总像素不超过 40,000,000，超出时缩小。

超过 1 MiB 的源码文稿暂停输入时的全文学术索引与自动参考文献占位符插入；主动插入、刷新和导出仍按需解析。此行为用于限制长文稿输入时的计算开销。

项目结构与未来扩展方式见[扩展接口](Extensions.md)，许可证来源和适用范围见[第三方与来源说明](ThirdPartyNotices.md)。
