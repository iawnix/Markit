# 第三方组件与来源

Markit 使用 [MIT 许可证](../LICENSE)。本页记录第三方组件的来源、许可证和署名要求；各组件的完整条款见其随附的许可证文件。

## 图标与参考素材

macOS 参考工程位于 [`reference/macos/Markedown`](../reference/macos/Markedown)。图标来源为其中的 `Resources/Assets.xcassets/AppIcon.appiconset`：

- `resources/icon.png` 与 `markedown-icon-256.png` 内容一致，SHA-256 为 `2958645e18020083f8ec0f64aa65481373bef53ebd6ab7fddb1e84ef75497f4b`。
- `resources/icon.ico` 封装该图标的 16、32、64、128、256 像素 PNG。
- `resources/icons/256x256.png` 使用相同的 256 像素 PNG。
- `resources/FeatureTour.md` 根据参考工程的功能示例改写为当前使用指南。

参考工程的 Swift 依赖和来源记录见其 [ThirdPartyNotices.md](../reference/macos/Markedown/Resources/ThirdPartyNotices.md) 与 [Vendor/PROVENANCE.md](../reference/macos/Markedown/Vendor/PROVENANCE.md)。`Vendor` 目录保存来源记录，原始素材适用各自的版权和许可证。

## 组件索引

JavaScript 精确版本见 `package-lock.json`，Rust 精确版本见 `apps/desktop/src-tauri/Cargo.lock`。以下列出主要组件，完整 npm 依赖记录由下节命令生成。

| 组件 | 声明的许可证 |
| --- | --- |
| Tauri | MIT OR Apache-2.0 |
| React、React DOM | MIT |
| CodeMirror 6、Lezer | MIT |
| ProseMirror | MIT |
| markdown-it | MIT |
| KaTeX | MIT；保留分发文件中的字体说明 |
| citeproc | 本项目选用 CPAL 1.0，详见下文 |
| fflate、`@xmldom/xmldom` | MIT |
| highlight.js | BSD-3-Clause |
| lucide-react | ISC；保留包内图标来源说明 |
| DOMPurify | MPL-2.0 OR Apache-2.0 |

仓库的 Electron 工程及相关导出模块还使用：

| 组件 | 声明的许可证 |
| --- | --- |
| Electron | MIT；Chromium 及内置组件适用各自条款 |
| MathJax (`mathjax-full`) | Apache-2.0 |
| sharp | Apache-2.0；libvips 及其组件适用各自条款 |
| `@img/sharp-*` 原生包 | Apache-2.0 AND LGPL-3.0-or-later |

Electron 分发目录包含 `LICENSE` 和 `LICENSES.chromium.html`，electron-builder 可将前者重命名为 `LICENSE.electron.txt`。分发 Electron 构建时保留这些文件及 sharp / libvips 的许可材料。Pandoc 是该工程使用的可选外部程序，由用户安装。

## 生成 npm 依赖记录

```sh
npm ci
npm run notices
```

`scripts/notices.mjs` 读取锁文件与已安装依赖，收集 `LICENSE*`、`LICENCE*`、`COPYING*`、`NOTICE*` 等文件，生成：

- `resources/THIRD_PARTY_LICENSES.txt`
- `resources/THIRD_PARTY_DEPENDENCIES.json`

记录包含包名、版本、许可证声明和来源；未声明许可证的条目标记为待核实。该命令覆盖 npm 依赖，Rust 依赖信息由 Cargo 元数据及各 crate 的许可证提供。各平台应在其构建环境中生成记录，以包含正确的原生包。

`npm run build:legacy` 会通过 `prebuild:legacy` 运行许可证收集。Electron 发布脚本将记录复制到 `release/` 并生成校验文件。

## 原生组件许可材料

`resources/native-licenses` 保存原生依赖的补充材料和来源记录。

Windows 的 `@img/sharp-win32-x64@0.34.5` 声明 `Apache-2.0 AND LGPL-3.0-or-later`，包内 `LICENSE` 为 Apache-2.0。补充材料包括官方 libvips 8.17.3 Windows 包中的 LGPL-2.1、GNU 官方 LGPL-3/GPL-3，以及 sharp 的原始署名表。官方包与本地 DLL 的字节及 28 个组件版本已核对，摘要和版本记录在 `provenance.json` 中。

组件级版权、许可证及对应源码的待补项目也记录在 `provenance.json`，其 `completeComponentLicenseTexts` 值为 `false`。依赖更新时同步核对组件版本、许可证和 DLL 摘要。

`mj-context-menu@0.6.1` 声明 Apache-2.0，其 npm 包和对应上游提交缺少包级 `LICENSE` / `NOTICE`。`mj-context-menu-0.6.1-*` 保存固定提交中 `ts/context_menu.ts` 的版权注释及其引用的 Apache 2.0 正文；对应 provenance 文件记录发布提交、标签、来源和 SHA-256。

## citeproc-js

Markit Citations 使用 `citeproc@2.4.63`，Copyright (c) 2009–2019 Frank Bennett，选用 **CPAL 1.0** 分发。

npm 元数据声明 `CPAL-1.0 OR AGPL-1.0`，包内 `LICENSE`、源码注释及上游 Exhibit A 声明 CPAL 1 或更高版本、或 AGPL 3 或更高版本。来源记录同时保存这两种表述和本项目选用的许可。接收者保有原始双重许可中的选择。

完整 CPAL、AGPLv3、原始 LICENSE 和 Exhibit B 署名保存在 `resources/native-licenses/citeproc-2.4.63-*`。CPAL 第 14 条和 Exhibit B 要求在 Larger Work 启动或开始会话时显著展示以下信息，并保留足够时间供用户阅读：

```text
(c) Frank Bennett
citeproc-js implements the Citation Style Language
https://citationstyles.org/
```

受许可源码见 [`resources/source-archives/citeproc-js-73bc1b44bc7d54d0bfec4e070fd27f5efe024ff9.tar.gz`](source-archives/citeproc-js-73bc1b44bc7d54d0bfec4e070fd27f5efe024ff9.tar.gz)，亦可从[固定上游提交](https://github.com/Juris-M/citeproc-js/tree/73bc1b44bc7d54d0bfec4e070fd27f5efe024ff9) 获取。归档包含 930 个上游文件及构建脚本，其中 `citeproc_commonjs.js` 与安装的运行库逐字节一致。

上游源码保持原样，插件构建通过 esbuild 合并运行库。初始集成日期为 2026-09-07，适配代码位于 `plugins/citations` 和相关共享模块。分发时遵守 CPAL 对 Covered Code 的源码通知、修改说明、署名和分发条件；来源记录通过 SHA-256 校验源码归档、许可证及本地运行库。
