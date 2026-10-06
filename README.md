# Markit

Markit 是一款轻量、跨平台的本地 Markdown 写作工具，面向研究笔记、技术文档和日常写作。它使用 Tauri 2、Rust、React、TypeScript 和 Vite 构建，文稿始终以 Markdown 源文件保存。

Markit 的核心编辑体验包含即时排版、源码模式、文档大纲、标签页、工作区文件浏览、相对路径图片和 HTML 导出。参考文献、Zotero 和其他重型能力通过可选插件提供，核心启动时不会加载这些功能。

项目主页：[github.com/iawnix/markit](https://github.com/iawnix/markit)

## 当前状态

项目正在进行独立重构。桌面基础工程、文件服务、Tauri 命令桥接、Markdown 编辑器、插件运行时和 citations 插件已经可以开发和验证；安装包发布、更多语义编辑能力和跨发行版验收仍在持续完善。

当前首发目标为 Windows、macOS 和 Linux x64：

- Windows：NSIS 安装包和 ZIP
- macOS：DMG
- Ubuntu/Debian：DEB
- Fedora/RHEL：RPM
- Manjaro/Arch 及其他 Linux：AppImage 和 tar.gz

Linux 构建使用系统 WebKitGTK。AppImage 不包含完整的 Chromium 运行时，使用前请确保系统具备对应的 WebKitGTK/GTK3 依赖。

## 核心功能

- 即时排版和 Markdown 源码编辑模式
- 源码模式使用 CodeMirror 6，支持 Markdown 高亮、撤销重做和行换行
- 标题大纲、章节跳转、标签页和工作区文件浏览
- CommonMark/GFM 基础语法、任务列表、表格、代码块和 LaTeX 公式
- 粘贴、拖拽和批量导入图片，使用相对路径保存
- UTF-8、BOM、LF/CRLF 和外部文件修改检测
- 原子保存、未保存状态和崩溃恢复
- HTML 导出
- 简体中文和 English 界面
- 本地 `.markit-plugin` 插件包、权限确认和 Worker 隔离

## 可选插件

Markit 核心不依赖 Zotero、citeproc、CSL 或 Mermaid。插件可以注册命令、侧栏面板、文档变换和导出入口，但必须通过宿主 API 请求文件、网络和设置访问。

当前提供的 citations 插件支持：

- 连接本机 Zotero API
- 搜索和缓存 Zotero 条目
- 插入 `[@KEY]` 引用
- 生成 bibliography 标记和编号列表
- 在即时排版和 HTML 导出中显示引用编号

插件包格式、权限模型和开发接口见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 与 [`plugins/citations/README.md`](plugins/citations/README.md)。

## 从源码运行

环境要求：Node.js 24 LTS、Rust stable，以及 Tauri 对应的平台依赖。Linux 还需要 WebKitGTK 4.1、GTK3、librsvg 和 patchelf。

```bash
git clone https://github.com/iawnix/markit.git
cd markit
npm ci
npm run tauri:dev
```

常用命令：

```bash
npm run typecheck       # TypeScript 类型检查
npm run tauri:frontend  # 构建桌面前端
npm run tauri:build     # 构建当前平台 Tauri 程序
npm run plugin:citations
npm run test:e2e        # 无头浏览器验证 Tauri 前端交互
```

根目录的 `npm run dev` 和 `npm run build` 现在默认走 Tauri。旧 Electron
验证链仍暂时保留，可通过 `npm run dev:legacy`、`npm run build:legacy`、
`npm run test:e2e:legacy` 和 `npm run test:ui:legacy` 运行；这些命令会在旧代码迁移完成后移除。

Linux 发行包示例：

```bash
npx tauri build --config apps/desktop/src-tauri/tauri.conf.json --bundles appimage,deb,rpm
```

开发和发布细节见 [`resources/Development.md`](resources/Development.md)。

## 项目结构

```text
apps/desktop/              Tauri 桌面应用和 React 界面
apps/desktop/src-tauri/    Rust 文件、图片、窗口和平台服务
packages/markdown/         Markdown 解析、目录和 HTML 渲染
packages/editor/           CodeMirror/ProseMirror 编辑模型
packages/plugin-sdk/       插件契约、权限和 Worker 宿主
plugins/citations/         Zotero/citeproc 可选插件
docs/                      架构和扩展说明
tests/                     核心单元测试
```

Markdown 源文本是持久化事实来源。语义编辑器是源码的投影，保存时不会把编辑器内部 JSON 写入文稿，也不会主动改写未编辑区域。

## 许可证

Markit 主体使用 MIT 许可证，见 [`LICENSE`](LICENSE)。第三方依赖、图标和 citeproc-js 的许可证与来源见 [`resources/ThirdPartyNotices.md`](resources/ThirdPartyNotices.md)。

## 反馈与贡献

请在 [Issues](https://github.com/iawnix/markit/issues) 中报告问题或提出建议。提交问题时请注明 Markit 版本、操作系统、复现步骤和最小示例。贡献代码前请先阅读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
