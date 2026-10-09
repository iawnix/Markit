# 插件开发

Markit 通过 `.markit-plugin` 包加载插件。插件在 Web Worker 中运行，通过宿主 API 读取文稿、执行命令、更新侧栏和访问设置。完整类型位于 [`packages/plugin-sdk/src/index.ts`](../packages/plugin-sdk/src/index.ts)。

## 包结构

`.markit-plugin` 是 ZIP 格式，包含：

```text
manifest.json
dist/index.js
integrity.json    # 可选的完整性记录
```

示例 manifest：

```json
{
  "id": "example.word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "dist/index.js",
  "permissions": ["document.read", "commands"],
  "contributions": [
    { "type": "panel", "id": "count", "title": "Word Count" }
  ]
}
```

入口模块默认导出包含 `activate(context)` 的对象，可通过 `deactivate()` 释放资源。入口 JavaScript 应打包为可在 Worker 中直接加载的 ES 模块。

## 命令与面板

下面的插件读取当前文稿，将字符数显示在侧栏：

```js
export default {
  activate(context) {
    context.registerPanel({
      id: 'count',
      title: 'Word Count',
      initialContent: { status: 'Choose Count characters from the menu.' },
      mount() { return () => {}; },
    });
    context.registerCommand({
      id: 'count-characters',
      title: 'Count characters',
      async run() {
        const document = await context.readDocument();
        await context.updatePanel('count', {
          status: document
            ? `${Array.from(document.source).length} characters`
            : 'Open a document to count characters.',
        });
      },
    });
  },
};
```

宿主通过 `initialContent` 和 `updatePanel()` 渲染面板。`mount` 是接口保留字段；Worker 宿主使用声明式面板内容。命令在应用菜单中显示，设置 `visible: false` 可供面板内部调用。

## 宿主 API

| 方法 | 用途 |
| --- | --- |
| `readDocument()` | 读取当前文稿及其 Markdown 源码 |
| `updateDocument(source)` | 更新当前文稿源码 |
| `registerCommand(command)` | 注册命令，返回注销函数 |
| `registerPanel(panel)` | 注册侧栏面板，返回注销函数 |
| `updatePanel(id, content)` | 更新状态、条目和引文编号映射 |
| `fetch(url, init)` | 通过宿主请求网络资源 |
| `readSetting(key)` / `writeSetting(key, value)` | 读取和保存插件设置 |
| `hasPermission(permission)` | 查询 manifest 中的权限声明 |

`document.read`、`document.write`、`commands`、`network` 和 `settings` 权限分别对应上述操作。宿主在启用插件时展示需要确认的权限，并在调用时检查权限声明。

网络接口支持对 `localhost:23119` 或 `127.0.0.1:23119` 的 HTTP GET、POST 请求，用于 Zotero 本地 API；请求体、响应体和执行时间设有上限。

## 构建与安装

参考 [`plugins/citations`](../plugins/citations) 的 manifest 和入口代码。构建脚本接受插件目录：

```sh
node scripts/build-plugin.mjs plugins/citations
```

脚本将入口代码及依赖打包，生成 `.markit-plugin` 文件。通过 Markit 设置中的“安装插件”导入，在插件列表中启用、停用或卸载。
