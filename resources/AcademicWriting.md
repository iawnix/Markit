# 参考文献与公式

Markit 内置 Markdown 和 LaTeX 公式编辑，Citations 插件提供 Zotero 检索、引文和参考文献列表。

## 连接 Zotero

1. 从 [Releases](https://github.com/iawnix/markit/releases/latest) 下载 Citations 插件。
2. 在 Markit 设置中选择“安装插件”，导入并启用。
3. 启动 Zotero，在其高级设置中开启本地 API。
4. 在 Markit 菜单中运行 **Check Zotero connection**。

插件使用 `http://127.0.0.1:23119/api/` 访问本机 Zotero。连接失败时，请检查 Zotero 是否运行、本地 API 是否启用以及该端口是否可访问。

## 插入引文

打开文稿，切换到侧栏 **References**，输入标题、作者或年份后按 Enter。点击搜索结果会将该条目的引文追加到文稿末尾，再按需要移动到正文中。

引文源码使用八位 Zotero 条目键：

```markdown
相关研究见 [@ABCD1234]。
多条引用可写为 [@ABCD1234; @EFGH5678]。
```

示例中的键需替换为个人文献库中的实际条目键。即时排版和 HTML 导出使用数字编号，Markdown 保留条目键。

## 生成参考文献

通过菜单中的 **Insert bibliography marker** 添加占位符，将它移动到希望展示参考文献的位置：

```markdown
<!-- markedown:bibliography -->
```

运行 **Refresh bibliography**，插件解析文稿中的条目键，并使用 citeproc-js 生成数字制参考文献列表。条目解析失败时，错误信息会列出缺失的键，便于核对 Zotero 文库。

## 数学公式

行内公式使用 `$...$`，行间公式使用 `$$...$$`：

```markdown
质量为 $m$ 的物体，其能量为：

$$
E = mc^2
$$
```

即时排版使用 KaTeX 显示公式。将光标移入公式区域可编辑其源码。

## 导出

应用菜单提供 HTML、打印 / PDF 和 PNG 长图导出。更新参考文献后保存文稿，再选择所需格式。

[示例文稿](AcademicExample.md) 可用于练习公式和引文编辑。插件命令及构建方法见 [Citations 文档](../plugins/citations/README.md)。
