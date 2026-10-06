import type { Locale } from './contracts';

const messages = {
  'zh-CN': {
    files: '文件', outline: '大纲', search: '搜索', menu: '菜单', closeMenu: '关闭菜单', newDocument: '新建文稿', open: '打开', image: '插入图片',
    save: '保存', exportHtml: '导出 HTML', printPdf: '打印 / 导出 PDF', source: '源码', live: '即时排版', preview: '预览', settings: '设置', untitled: '未命名文稿', externalChange: '文件已被其他程序修改。重新加载会丢弃当前未保存内容。', reload: '重新加载', recoveryFound: '发现上次未正常关闭时保留的未保存文稿。是否恢复？',
    emptyTitle: '开始写作', emptyBody: '打开一个 Markdown 文件，或创建一份新的文稿。', focusMode: '专注模式', exitFocus: '退出专注模式', showSidebar: '显示侧栏', hideSidebar: '隐藏侧栏',
    noOutline: '当前文稿还没有标题', searchHint: '输入关键词查找当前文稿', searchNoResults: '没有找到匹配内容', replacePlaceholder: '替换为', replaceCurrent: '替换当前', replaceAll: '全部替换', words: '字', saved: '已保存', unsaved: '未保存',
    openPath: '打开文件路径', language: '语言', chinese: '简体中文', english: 'English', theme: '主题', themeSystem: '跟随系统', themeLight: '浅色', themeDark: '深色', resizeSidebar: '调整侧栏宽度', editorAppearance: '编辑器外观', editorFont: '编辑器字体', editorFontSize: '字号', fontSystem: '系统等宽', fontNoto: 'Noto Sans Mono', fontSarasa: 'Sarasa Mono', fontJetBrains: 'JetBrains Mono',
    plugins: '插件', installPlugin: '安装插件', noPlugins: '尚未安装插件。', enablePlugin: '启用', disablePlugin: '停用', removePlugin: '卸载', pluginPanelReady: '插件面板已加载', pluginPanelProvider: '由插件提供', pluginSearchPlaceholder: '搜索文献后按 Enter', pluginNoResults: '暂无结果', linkEditorTitle: '编辑链接', linkURL: '链接地址', cancel: '取消', apply: '应用', errorTitle: '错误', closeError: '关闭错误提示', closeUnsavedTitle: '文稿尚未保存', closeUnsavedBody: '“{title}”有未保存的修改。关闭前要保存吗？', closeWindowUnsavedBody: '有文稿尚未保存。关闭窗口前要保存吗？', saveAndClose: '保存并关闭', discardChanges: '丢弃修改',
    pluginPermissions: '请求权限', pluginIntegrity: '完整性已验证', pluginUnsigned: '未签名', pluginInstallError: '插件安装失败', pluginPermissionPrompt: '此插件请求高风险权限，启用前请确认：',
  },
  en: {
    files: 'Files', outline: 'Outline', search: 'Search', menu: 'Menu', closeMenu: 'Close menu', newDocument: 'New document', open: 'Open', image: 'Image',
    save: 'Save', exportHtml: 'Export HTML', printPdf: 'Print / export PDF', source: 'Source', live: 'Live', preview: 'Preview', settings: 'Settings', untitled: 'Untitled document', externalChange: 'This file changed outside Markit. Reloading discards unsaved changes.', reload: 'Reload', recoveryFound: 'Unsaved documents from the last session were found. Restore them?',
    emptyTitle: 'Start writing', emptyBody: 'Open a Markdown file or create a new document.', focusMode: 'Focus mode', exitFocus: 'Exit focus mode', showSidebar: 'Show sidebar', hideSidebar: 'Hide sidebar',
    noOutline: 'This document has no headings yet', searchHint: 'Search this document', searchNoResults: 'No matches found', replacePlaceholder: 'Replace with', replaceCurrent: 'Replace', replaceAll: 'Replace all', words: 'words', saved: 'Saved', unsaved: 'Unsaved',
    openPath: 'Open file path', language: 'Language', chinese: '简体中文', english: 'English', theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', resizeSidebar: 'Resize sidebar', editorAppearance: 'Editor appearance', editorFont: 'Editor font', editorFontSize: 'Font size', fontSystem: 'System monospace', fontNoto: 'Noto Sans Mono', fontSarasa: 'Sarasa Mono', fontJetBrains: 'JetBrains Mono',
    plugins: 'Plugins', installPlugin: 'Install plugin', noPlugins: 'No plugins installed yet.', enablePlugin: 'Enable', disablePlugin: 'Disable', removePlugin: 'Remove', pluginPanelReady: 'Plugin panel loaded', pluginPanelProvider: 'Provided by plugin', pluginSearchPlaceholder: 'Search references and press Enter', pluginNoResults: 'No results yet', linkEditorTitle: 'Edit link', linkURL: 'Link URL', cancel: 'Cancel', apply: 'Apply', errorTitle: 'Error', closeError: 'Dismiss error', closeUnsavedTitle: 'Unsaved document', closeUnsavedBody: '“{title}” has unsaved changes. Save before closing?', closeWindowUnsavedBody: 'Some documents have unsaved changes. Save before closing the window?', saveAndClose: 'Save and close', discardChanges: 'Discard changes',
    pluginPermissions: 'Requested permissions', pluginIntegrity: 'Integrity verified', pluginUnsigned: 'Unsigned', pluginInstallError: 'Plugin installation failed', pluginPermissionPrompt: 'This plugin requests high-risk permissions. Confirm before enabling:',
  },
} as const;

export type MessageKey = keyof typeof messages['zh-CN'];
export function message(locale: Locale, key: MessageKey): string { return messages[locale][key]; }
