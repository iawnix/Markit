# Markit

Markit 是一款跨平台的本地 Markdown 编辑器，适合研究笔记、技术文档和日常写作。支持即时排版、源码编辑、文档大纲和多标签页，文稿以 Markdown 文件保存。

[下载最新版本](https://github.com/iawnix/markit/releases/latest) · [使用指南](resources/FeatureTour.md) · [开发指南](resources/Development.md) · [问题反馈](https://github.com/iawnix/markit/issues)

## 功能

- **编辑**：即时排版与源码模式、语法高亮、撤销重做、查找替换。
- **组织**：文档标签页、工作区文件浏览、标题大纲与章节跳转。
- **排版**：任务列表、表格、代码块、LaTeX 公式和本地图片。
- **文件**：UTF-8、BOM、LF/CRLF、原子保存、外部修改检测和未保存文稿恢复。
- **导出**：HTML、打印 / PDF 和 PNG 长图。
- **外观**：浅色、深色与系统主题，字体、字号和阅读宽度设置，中英文界面。
- **插件**：安装本地 `.markit-plugin` 包；通过 Citations 插件连接 Zotero、插入引文并生成参考文献。

## 安装

从 [Releases](https://github.com/iawnix/markit/releases/latest) 下载对应系统的软件包：

| 系统 | 软件包 |
| --- | --- |
| Windows | 安装程序 `.exe`、ZIP |
| macOS（Apple Silicon） | `.dmg` |
| Ubuntu / Debian | `.deb` |
| Fedora / RHEL | `.rpm` |
| 其他 Linux 发行版 | `.AppImage`、`.tar.gz` |

Linux 需要 WebKitGTK 4.1 和 GTK3。DEB、RPM 包声明了运行依赖；AppImage 和 tar.gz 的依赖安装方法见[开发与构建指南](resources/Development.md#linux-依赖)。

发布附件中的 `SHA256SUMS.txt` 提供文件校验值。在下载目录中校验已有文件：

```sh
sha256sum --ignore-missing -c SHA256SUMS.txt
```

## 开始使用

1. 打开 Markit，通过菜单新建文稿或打开 `.md` 文件。
2. 使用底部模式按钮切换即时排版和源码编辑。
3. 通过左侧文件列表、大纲和搜索面板浏览文稿。
4. 按 `Ctrl+S`（macOS 为 `Cmd+S`）保存，或从菜单导出文稿。

Zotero 工作流见[参考文献与公式](resources/AcademicWriting.md)，插件安装步骤见 [Citations 文档](plugins/citations/README.md)。

## 开发

技术栈：Tauri 2、Rust、React、TypeScript、CodeMirror 6 和 Vite。

准备 Node.js 24 LTS、Rust stable 及 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)，然后运行：

```sh
git clone https://github.com/iawnix/markit.git
cd markit
npm ci
npm run dev
```

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 类型检查并构建桌面前端 |
| `npm run tauri:build` | 构建当前平台桌面程序及安装包 |
| `npm test` | 运行单元测试 |
| `npm run test:desktop-ui` | 运行前端交互测试 |
| `npm run plugin:citations` | 构建 Citations 插件 |

构建依赖、平台命令和发布流程见[开发指南](resources/Development.md)，代码组织见[架构文档](docs/ARCHITECTURE.md)。

## 参与贡献

欢迎提交 Issue 和 Pull Request。报告问题时请附上 Markit 版本、操作系统、复现步骤和相关示例；提交代码前请运行与改动相关的检查，具体见[测试指南](resources/Validation.md)。

插件开发接口和示例见[插件开发指南](resources/Extensions.md)。

## 许可证

Markit 使用 [MIT 许可证](LICENSE)。第三方组件的许可证、署名和来源见[第三方说明](resources/ThirdPartyNotices.md)。
