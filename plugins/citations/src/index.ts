import CSL from 'citeproc';
import { citationLocale, citationStyles } from '../../../src/shared/citation-styles';

const bibliographyMarker = '<!-- markedown:bibliography -->';
const bibliographyEndMarker = '<!-- /markedown:bibliography -->';
const citationKeyPattern = /^[A-Z0-9]{8}$/;

type ZoteroItem = { key?: string; data?: { key?: string; title?: string; date?: string; creators?: Array<{ creatorType?: string; name?: string; firstName?: string; lastName?: string }> } };
type CitationContext = {
  fetch(url: string): Promise<{ status: number; body: string }>;
  readSetting(key: string): Promise<string | null>;
  writeSetting(key: string, value: string): Promise<void>;
};

function itemsFrom(body: string): ZoteroItem[] {
  const value = JSON.parse(body) as unknown;
  if (Array.isArray(value)) return value as ZoteroItem[];
  if (value && typeof value === 'object') return [value as ZoteroItem];
  return [];
}

function keyFor(item: ZoteroItem): string | null {
  const key = (item.key || item.data?.key || '').toUpperCase();
  return citationKeyPattern.test(key) ? key : null;
}

function itemText(item: ZoteroItem): string {
  const data = item.data || {};
  const authors = (data.creators || []).filter(creator => creator.creatorType === 'author' || !creator.creatorType).map(creator => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join(', ');
  const year = (data.date || '').match(/\d{4}/u)?.[0] || 'n.d.';
  const title = (data.title || 'Untitled').replace(/[\[\]\\]/gu, '\\$&');
  return `${authors || 'Unknown author'} (${year}). ${title}.`;
}

function cslItem(item: ZoteroItem, key: string): Record<string, unknown> {
  const data = item.data || {};
  const creators = (data.creators || []).filter(creator => creator.creatorType === 'author' || !creator.creatorType).map(creator => creator.name ? { literal: creator.name } : { given: creator.firstName || '', family: creator.lastName || '' });
  const year = (data.date || '').match(/\d{4}/u)?.[0];
  return { id: key, type: 'article-journal', title: data.title || 'Untitled', author: creators, issued: year ? { 'date-parts': [[Number(year)]] } : undefined };
}

function bibliographyText(engine: { makeBibliography(): [unknown, Array<string>] | undefined }): string {
  const bibliography = engine.makeBibliography();
  if (!bibliography) return '';
  return bibliography[1].map((entry, index) => `${index + 1}. ${entry.replace(/<[^>]*>/gu, '').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').trim()}`).join('\n');
}

async function zoteroItems(context: { fetch(url: string): Promise<{ status: number; body: string }> }, keys?: string[]): Promise<ZoteroItem[]> {
  const query = keys?.length ? `&itemKey=${encodeURIComponent(keys.join(','))}` : '&limit=20';
  const response = await context.fetch(`http://127.0.0.1:23119/api/users/0/items?format=json${query}`);
  if (response.status < 200 || response.status >= 300) throw new Error(`Zotero returned HTTP ${response.status}.`);
  try { return itemsFrom(response.body); } catch { throw new Error('Zotero returned invalid JSON.'); }
}

async function searchZotero(context: CitationContext, query: string): Promise<ZoteroItem[]> {
  const normalized = query.trim().slice(0, 300);
  if (!normalized) return [];
  const cached = await context.readSetting('search-cache');
  if (cached) {
    try {
      const value = JSON.parse(cached) as { query?: string; savedAt?: number; items?: ZoteroItem[] };
      if (value.query === normalized && typeof value.savedAt === 'number' && Date.now() - value.savedAt < 5 * 60 * 1000 && Array.isArray(value.items)) return value.items;
    } catch { /* Refresh malformed cache below. */ }
  }
  const response = await context.fetch(`http://127.0.0.1:23119/api/users/0/items?format=json&limit=30&search=${encodeURIComponent(normalized)}`);
  if (response.status < 200 || response.status >= 300) throw new Error(`Zotero returned HTTP ${response.status}.`);
  const items = itemsFrom(response.body);
  await context.writeSetting('search-cache', JSON.stringify({ query: normalized, savedAt: Date.now(), items }));
  return items;
}

function panelItems(items: ZoteroItem[]): Array<{ id: string; title: string; meta: string; command: { id: string; args: string[] } }> {
  return items.flatMap(item => {
    const key = keyFor(item);
    if (!key) return [];
    const data = item.data || {};
    const authors = (data.creators || []).filter(creator => creator.creatorType === 'author' || !creator.creatorType).map(creator => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join(', ');
    const year = (data.date || '').match(/\d{4}/u)?.[0] || 'n.d.';
    return [{ id: key, title: data.title || key, meta: `${authors || 'Unknown author'} · ${year} · ${key}`, command: { id: 'insert-zotero-citation', args: [key] } }];
  });
}

function citationNumbers(keys: string[]): Record<string, number> {
  return Object.fromEntries([...new Set(keys)].map((key, index) => [key, index + 1] as const));
}

export default {
  activate(context: {
    registerCommand(command: { id: string; title: string; visible?: boolean; run(...args: unknown[]): void | Promise<void> }): () => void;
    registerPanel(panel: { id: string; title: string; attribution?: string; searchCommand?: string; initialContent?: { status?: string; items?: unknown[] }; mount(container: HTMLElement): () => void }): () => void;
    readDocument(): Promise<{ source: string } | null>;
    updateDocument(source: string): Promise<void>;
    fetch(url: string): Promise<{ status: number; body: string }>;
    updatePanel(panelId: string, content: { status?: string; items?: unknown[]; citations?: Record<string, number> }): Promise<void>;
    readSetting(key: string): Promise<string | null>;
    writeSetting(key: string, value: string): Promise<void>;
  }) {
    context.registerPanel({
      id: 'references',
      title: 'References',
      attribution: '(c) Frank Bennett · citeproc-js implements the Citation Style Language · https://citationstyles.org/',
      searchCommand: 'search-zotero',
      initialContent: { status: 'Search Zotero for a reference.', items: [] },
      mount() { return () => {}; },
    });

    context.registerCommand({
      id: 'insert-bibliography-marker',
      title: 'Insert bibliography marker',
      async run() {
        const document = await context.readDocument();
        if (!document) throw new Error('Open a document before inserting a bibliography.');
        if (document.source.includes(bibliographyMarker)) return;
        const source = `${document.source.replace(/\s*$/u, '')}\n\n${bibliographyMarker}\n`;
        await context.updateDocument(source);
      },
    });

    context.registerCommand({
      id: 'check-zotero-connection',
      title: 'Check Zotero connection',
      async run() {
        const response = await context.fetch('http://127.0.0.1:23119/api/users/0/items?limit=1');
        if (response.status < 200 || response.status >= 300) throw new Error(`Zotero returned HTTP ${response.status}.`);
      },
    });

    context.registerCommand({
      id: 'search-zotero',
      title: 'Search Zotero',
      visible: false,
      async run(...args: unknown[]) {
        const query = typeof args[0] === 'string' ? args[0] : '';
        if (!query.trim()) {
          await context.updatePanel('references', { status: 'Enter a title, author or year to search.', items: [] });
          return;
        }
        await context.updatePanel('references', { status: 'Searching Zotero…', items: [] });
        const items = await searchZotero(context, query);
        await context.updatePanel('references', { status: items.length ? `${items.length} references found.` : 'No matching references.', items: panelItems(items) });
      },
    });

    context.registerCommand({
      id: 'insert-zotero-citation',
      title: 'Insert Zotero citation',
      async run(...args: unknown[]) {
        const document = await context.readDocument();
        if (!document) throw new Error('Open a document before inserting a citation.');
        const requestedKey = typeof args[0] === 'string' && citationKeyPattern.test(args[0]) ? args[0] : undefined;
        const item = (await zoteroItems(context, requestedKey ? [requestedKey] : undefined))[0];
        const key = item && keyFor(item);
        if (!key) throw new Error('Zotero did not return an eight-character item key.');
        if (document.source.includes(`@${key}`)) return;
        const source = `${document.source.replace(/\s*$/u, '')}\n\n[@${key}]\n`;
        await context.updateDocument(source);
        const keys = [...new Set([...source.matchAll(/@([A-Z0-9]{8})/gu)].map(match => match[1]))];
        await context.updatePanel('references', { status: `${keys.length} references in this document.`, items: panelItems([item]), citations: citationNumbers(keys) });
      },
    });

    context.registerCommand({
      id: 'refresh-bibliography',
      title: 'Refresh bibliography',
      async run() {
        const document = await context.readDocument();
        if (!document) throw new Error('Open a document before refreshing the bibliography.');
        const keys = [...new Set([...document.source.matchAll(/@([A-Z0-9]{8})/gu)].map(match => match[1]))];
        if (!keys.length) throw new Error('The document has no supported Zotero citation keys.');
        const byKey = new Map((await zoteroItems(context, keys)).map(item => [keyFor(item), item] as const));
        const missing = keys.filter(key => !byKey.has(key));
        if (missing.length) throw new Error(`Zotero could not resolve: ${missing.join(', ')}.`);
        const cslData = new Map(keys.map(key => [key, cslItem(byKey.get(key)!, key)] as const));
        const style = citationStyles.numeric;
        const engine = new CSL.Engine({ retrieveLocale: () => citationLocale, retrieveItem: (key: string) => cslData.get(key) }, style, 'en-US');
        engine.updateItems(keys);
        const citations = citationNumbers(keys);
        const entries = bibliographyText(engine) || keys.map((key, index) => `${index + 1}. ${itemText(byKey.get(key)!)}`).join('\n');
        const block = `${bibliographyMarker}\n\n${entries}\n${bibliographyEndMarker}`;
        const region = new RegExp(`${bibliographyMarker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\\s\\S]*?(?:${bibliographyEndMarker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')})?`, 'u');
        const source = region.test(document.source) ? document.source.replace(region, block) : `${document.source.replace(/\s*$/u, '')}\n\n${block}\n`;
        await context.updateDocument(source);
        await context.updatePanel('references', { status: `${keys.length} references in this document.`, items: panelItems([...byKey.values()]), citations });
      },
    });
  },
};
