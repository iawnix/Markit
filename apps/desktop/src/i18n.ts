import type { Locale } from './contracts';

const messages = {
  'zh-CN': {
    files: '文件', outline: '大纲', search: '搜索', newDocument: '新建文稿', open: '打开', image: '插入图片',
    save: '保存', exportHtml: '导出 HTML', source: '源码', live: '即时排版', settings: '设置', untitled: '未命名文稿',
    emptyTitle: '开始写作', emptyBody: '打开一个 Markdown 文件，或创建一份新的文稿。',
    noOutline: '当前文稿还没有标题', words: '字', saved: '已保存', unsaved: '未保存',
    openPath: '打开文件路径', language: '语言', chinese: '简体中文', english: 'English',
    plugins: '插件', installPlugin: '安装插件', noPlugins: '尚未安装插件。', enablePlugin: '启用', disablePlugin: '停用', removePlugin: '卸载', pluginPanelReady: '插件面板已加载', pluginPanelProvider: '由插件提供',
    pluginPermissions: '请求权限', pluginIntegrity: '完整性已验证', pluginUnsigned: '未签名', pluginInstallError: '插件安装失败', pluginPermissionPrompt: '此插件请求高风险权限，启用前请确认：',
  },
  en: {
    files: 'Files', outline: 'Outline', search: 'Search', newDocument: 'New document', open: 'Open', image: 'Image',
    save: 'Save', exportHtml: 'Export HTML', source: 'Source', live: 'Live', settings: 'Settings', untitled: 'Untitled document',
    emptyTitle: 'Start writing', emptyBody: 'Open a Markdown file or create a new document.',
    noOutline: 'This document has no headings yet', words: 'words', saved: 'Saved', unsaved: 'Unsaved',
    openPath: 'Open file path', language: 'Language', chinese: '简体中文', english: 'English',
    plugins: 'Plugins', installPlugin: 'Install plugin', noPlugins: 'No plugins installed yet.', enablePlugin: 'Enable', disablePlugin: 'Disable', removePlugin: 'Remove', pluginPanelReady: 'Plugin panel loaded', pluginPanelProvider: 'Provided by plugin',
    pluginPermissions: 'Requested permissions', pluginIntegrity: 'Integrity verified', pluginUnsigned: 'Unsigned', pluginInstallError: 'Plugin installation failed', pluginPermissionPrompt: 'This plugin requests high-risk permissions. Confirm before enabling:',
  },
} as const;

export type MessageKey = keyof typeof messages['zh-CN'];
export function message(locale: Locale, key: MessageKey): string { return messages[locale][key]; }
