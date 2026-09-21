import type { Locale } from './contracts';

const messages = {
  'zh-CN': {
    files: '文件', outline: '大纲', search: '搜索', newDocument: '新建文稿', open: '打开', image: '插入图片',
    save: '保存', exportHtml: '导出 HTML', source: '源码', live: '即时排版', settings: '设置', untitled: '未命名文稿',
    emptyTitle: '开始写作', emptyBody: '打开一个 Markdown 文件，或创建一份新的文稿。',
    noOutline: '当前文稿还没有标题', words: '字', saved: '已保存', unsaved: '未保存',
    openPath: '打开文件路径', language: '语言', chinese: '简体中文', english: 'English',
  },
  en: {
    files: 'Files', outline: 'Outline', search: 'Search', newDocument: 'New document', open: 'Open', image: 'Image',
    save: 'Save', exportHtml: 'Export HTML', source: 'Source', live: 'Live', settings: 'Settings', untitled: 'Untitled document',
    emptyTitle: 'Start writing', emptyBody: 'Open a Markdown file or create a new document.',
    noOutline: 'This document has no headings yet', words: 'words', saved: 'Saved', unsaved: 'Unsaved',
    openPath: 'Open file path', language: 'Language', chinese: '简体中文', english: 'English',
  },
} as const;

export type MessageKey = keyof typeof messages['zh-CN'];
export function message(locale: Locale, key: MessageKey): string { return messages[locale][key]; }
