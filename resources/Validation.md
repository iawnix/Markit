# 测试指南

## 自动化检查

从仓库根目录运行：

```sh
npm ci
npm run typecheck
npm test
npm run tauri:frontend
npm run test:desktop-ui
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run plugin:citations
git diff --check
```

Rust 检查需要安装对应的 Tauri 平台依赖，见[开发指南](Development.md)。前端交互测试通过 Playwright 使用 Chromium；首次运行可安装浏览器：

```sh
npx playwright install --with-deps chromium
```

## 测试覆盖

| 测试入口 | 内容 |
| --- | --- |
| `tests/` | Markdown、编辑模型、文件服务、插件契约及历史 Electron 模块 |
| `scripts/smoke-tauri-frontend.mjs` | 编辑、模式切换、搜索、表格、选区、主题和文稿关闭，以及下列文稿 / 项目流程 |
| `scripts/check-document-workspace.mjs` | 模拟原生命令验证启动文件、独立文稿 / 项目切换、异步插图、另存为失败及成功、HTML 图片嵌入、ZIP 解压内容与项目恢复 |
| `scripts/check-window-close.mjs` | 带权限检查的 Tauri 关闭流程：正常关闭、取消、保存、丢弃及错误提示 |
| `apps/desktop/src-tauri/src/lib.rs` | Rust 文件处理和服务测试 |

关闭流程测试使用实际的 Tauri JavaScript API，并模拟原生事件和命令；权限列表读取自应用 capability 配置。系统窗口行为在桌面安装包中验证。

## 桌面检查

在 Windows、macOS 和 Linux 的安装包中检查以下流程：

1. 启动应用，打开包含中文、图片、表格和公式的 Markdown 文件。
2. 编辑文稿，切换模式，执行撤销、重做和保存，再次打开核对内容。
3. 拖动标题栏空白和文字区域，双击最大化，操作最小化和关闭按钮。
4. 分别关闭已保存文稿和含未保存修改的窗口，检查取消、丢弃、保存并关闭；保存失败或取消保存时窗口应保持打开。
5. 导出 HTML、打印 / PDF 和 PNG，检查内容与排版。
6. 安装 Citations 插件，连接本机 Zotero，检索条目并生成参考文献。
7. 单独打开文稿后确认没有项目树；打开项目、展开子目录，再打开项目外文件，确认根目录不变。
8. 新文稿粘贴图片，取消和完成首次保存；检查 `.assets` 目录和相对路径。导入期间编辑文字、切换标签，核对图片归属。
9. 另存为、HTML 和 ZIP 导出包含共享图片的文稿；移动副本 / 解压目录后重新打开，确认图片可用，原文稿和原图片不变。
10. 从系统文件管理器分别在应用未运行、已运行时打开 Markdown；检查安装、再次启动和卸载。

报告问题时记录版本、操作系统、操作步骤、预期与实际结果，并附上可共享的示例文稿。

## CI 与历史记录

[Tauri build](../.github/workflows/tauri-build.yml) 执行前端交互检查及三平台构建；[Release](../.github/workflows/release.yml) 检查版本、运行 Rust 测试、构建安装包并校验发布附件。

历史版本的验证环境和结果保存在 [validation-history](validation-history/)，包括 [Windows 0.3.6 验证记录](validation-history/0.3.6.md)。
