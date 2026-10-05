import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open, save as saveFile } from '@tauri-apps/plugin-dialog';
import { Code2, Download, Eye, FileText, FolderOpen, Focus, ImagePlus, Languages, Menu, Minus, PanelLeft, Play, Plus, Puzzle, RotateCcw, Save, Search, Settings2, ShieldCheck, Square, Trash2, Upload, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { clearRecovery, exportHtml as writeHtml, fileRevision, importImages as writeImages, isTauriRuntime, listDirectory, outline, readDocument, readPluginPackage, readRecovery, saveDocument, writeRecovery } from './bridge';
import type { DirectoryEntry, DocumentSnapshot, ImageInput, Locale, OutlineEntry } from './contracts';
import { message } from './i18n';
import { renderHtmlDocument } from '../../../packages/markdown/src/index';
import { parsePluginPackage } from '../../../packages/plugin-sdk/src/package';
import { requiresPrompt } from '../../../packages/plugin-sdk/src/permissions';
import { PluginRegistry, type InstalledPlugin } from '../../../packages/plugin-sdk/src/registry';
import { loadPluginEntry, removePluginEntry, savePluginEntry } from '../../../packages/plugin-sdk/src/package-store';
import { PluginWorkerHost } from '../../../packages/plugin-sdk/src/worker-host';
import type { SourceEditorHandle } from './CodeMirrorEditor';
const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor').then(module => ({ default: module.CodeMirrorEditor })));
const ProseMirrorEditor = lazy(() => import('./ProseMirrorEditor').then(module => ({ default: module.ProseMirrorEditor })));

type Sidebar = 'files' | 'outline' | 'search' | 'plugin';
type PluginPanelItem = { id: string; title: string; meta?: string; command?: { id: string; args?: unknown[] } };
type PluginPanelContent = { status?: string; items?: PluginPanelItem[]; citations?: Record<string, number> };
type PluginCommandContribution = { pluginId: string; id: string; title: string; shortcut?: string; visible?: boolean; host: PluginWorkerHost };
type PluginPanelContribution = { pluginId: string; id: string; title: string; attribution?: string; searchCommand?: string; content?: PluginPanelContent };

function titleFor(path: string | null, locale: Locale) {
  return path?.split(/[\\/]/).at(-1) || message(locale, 'untitled');
}

function wordCount(source: string) { return source.trim() ? source.trim().split(/\s+/u).length : 0; }

function loadPlugins(): InstalledPlugin[] {
  try { return new PluginRegistry(JSON.parse(localStorage.getItem('markit.plugins') || '[]')).list(); } catch { return []; }
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem('markit.locale') as Locale) || 'zh-CN');
  const [sidebar, setSidebar] = useState<Sidebar>('outline');
  const [documents, setDocuments] = useState<DocumentSnapshot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [headings, setHeadings] = useState<OutlineEntry[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const editorRef = useRef<SourceEditorHandle>(null);
  const documentsRef = useRef<DocumentSnapshot[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pluginInputRef = useRef<HTMLInputElement>(null);
  const pluginHostsRef = useRef(new Map<string, PluginWorkerHost>());
  const activeIdRef = useRef<string | null>(null);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>(loadPlugins);
  const [pluginError, setPluginError] = useState('');
  const [pluginCommands, setPluginCommands] = useState<PluginCommandContribution[]>([]);
  const [pluginPanels, setPluginPanels] = useState<PluginPanelContribution[]>([]);
  const [selectedPluginPanel, setSelectedPluginPanel] = useState<PluginPanelContribution | null>(null);
  const [recoveryLoaded, setRecoveryLoaded] = useState(!isTauriRuntime);
  const active = documents.find(document => document.id === activeId) || null;
  const citationMap = useMemo(() => {
    const panel = pluginPanels.find(item => item.id === 'references');
    return panel?.content?.citations || {};
  }, [pluginPanels]);
  const t = (key: Parameters<typeof message>[1]) => message(locale, key);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (path) void openPath(path);
    };
    window.addEventListener('markit:open-path', onOpen);
    let unlisten: (() => void) | undefined;
    if (isTauriRuntime) void listen<string>('open-file', event => { void openPath(event.payload); }).then(value => { unlisten = value; });
    return () => { window.removeEventListener('markit:open-path', onOpen); unlisten?.(); };
  }, []);

  useEffect(() => { if (active) void outline(active.source).then(setHeadings); }, [active?.id, active?.source]);
  useEffect(() => {
    if (!isTauriRuntime) return;
    let cancelled = false;
    void readRecovery().then(records => {
      if (cancelled) return;
      if (records.length && window.confirm(t('recoveryFound'))) {
        setDocuments(records);
        setActiveId(records[0].id);
        const firstPath = records[0].path;
        if (firstPath) setWorkspace(firstPath.replace(/[\\/][^\\/]+$/, '') || firstPath);
      } else if (records.length) {
        void clearRecovery();
      }
      setRecoveryLoaded(true);
    }).catch(() => setRecoveryLoaded(true));
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!recoveryLoaded) return;
    const recoverable = documents.filter(document => document.dirty || (!document.path && document.source !== document.savedSource));
    const timer = window.setTimeout(() => {
      if (recoverable.length) void writeRecovery(recoverable).catch(() => undefined);
      else void clearRecovery().catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [documents, recoveryLoaded]);
  useEffect(() => {
    if (!isTauriRuntime || !active?.path || !active.revision) return;
    const documentId = active.id;
    const path = active.path;
    const expected = active.revision;
    let cancelled = false;
    const check = async () => {
      try {
        const current = await fileRevision(path);
        if (cancelled) return;
        const changed = current.hash !== expected.hash || current.size !== expected.size || current.modifiedMs !== expected.modifiedMs;
        setDocuments(documents => documents.map(document => document.id === documentId ? { ...document, externalChange: changed } : document));
      } catch {
        // A deleted or temporarily inaccessible file is reported when saving.
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active?.id, active?.path, active?.revision?.hash, active?.revision?.size, active?.revision?.modifiedMs]);
  useEffect(() => { localStorage.setItem('markit.locale', locale); document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); return; }
      if ((event.ctrlKey || event.metaKey) && event.key === 'j') {
        event.preventDefault();
        setFocusMode(current => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => {
    if (!isTauriRuntime) return;
    void getCurrentWindow().setDecorations(false).catch(() => undefined);
  }, []);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => {
    setSelectedPluginPanel(current => current ? pluginPanels.find(panel => panel.pluginId === current.pluginId && panel.id === current.id) || current : null);
  }, [pluginPanels]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(plugins.filter(plugin => plugin.enabled).map(async plugin => {
      try { if (!cancelled) await activatePlugin(plugin); }
      catch (error) {
        const registry = new PluginRegistry(plugins);
        registry.setEnabled(plugin.manifest.id, false);
        registry.setError(plugin.manifest.id, error instanceof Error ? error.message : String(error));
        if (!cancelled) persistPlugins(registry.list());
      }
    }));
    return () => {
      cancelled = true;
      for (const host of pluginHostsRef.current.values()) void host.deactivate().catch(() => undefined);
      pluginHostsRef.current.clear();
    };
  }, []);

  async function openPath(path: string) {
    try {
      const existing = documentsRef.current.find(item => item.path === path);
      if (existing) {
        setActiveId(existing.id);
        setWorkspace(path.replace(/[\\/][^\\/]+$/, '') || path);
        return;
      }
      const document = await readDocument(path);
      setDocuments(current => current.some(item => item.path === path) ? current : [...current, document]);
      setActiveId(document.id);
      setWorkspace(path.replace(/[\\/][^\\/]+$/, '') || path);
    } catch (error) { window.alert(String(error)); }
  }

  async function chooseDocument() {
    try {
      const selection = await open({ multiple: false, directory: false, filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }] });
      if (typeof selection === 'string') await openPath(selection);
    } catch (error) { window.alert(String(error)); }
  }

  async function chooseWorkspace() {
    try {
      const selection = await open({ multiple: false, directory: true });
      if (typeof selection !== 'string') return;
      setWorkspace(selection);
      setEntries(await listDirectory(selection));
    } catch (error) { window.alert(String(error)); }
  }

  function newDocument() {
    const document: DocumentSnapshot = {
      id: crypto.randomUUID(), path: null, title: t('untitled'), source: '# Untitled\n\n', savedSource: '# Untitled\n\n',
      dirty: false, revision: null, bom: false, lineEnding: 'LF', mode: 'live', selection: { anchor: 0, head: 0 }, scrollTop: 0,
    };
    setDocuments(current => [...current, document]); setActiveId(document.id);
  }

  async function save() {
    if (!active) return;
    try {
      let path = active.path;
      if (!path) {
        const selected = await saveFile({ defaultPath: 'Untitled.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (typeof selected !== 'string') return;
        path = selected;
      }
      const revision = await saveDocument(path, active.source, active.path ? active.revision : null, active.bom, active.lineEnding);
      setDocuments(current => current.map(item => item.id === active.id ? { ...item, path, title: titleFor(path, locale), savedSource: item.source, dirty: false, revision, externalChange: false } : item));
    } catch (error) { window.alert(String(error)); }
  }

  async function reloadActiveDocument() {
    if (!active?.path) return;
    try {
      const fresh = await readDocument(active.path);
      setDocuments(current => current.map(item => item.id === active.id ? { ...fresh, id: item.id, mode: item.mode, externalChange: false } : item));
    } catch (error) { window.alert(String(error)); }
  }

  async function exportDocument() {
    if (!active) return;
    const defaultName = `${titleFor(active.path, locale).replace(/\.(md|markdown|mdown|mkd)$/i, '') || 'Markit-export'}.html`;
    const html = renderHtmlDocument(active.source, titleFor(active.path, locale), citationMap);
    try {
      if (!isTauriRuntime) {
        await writeHtml(defaultName, html);
        return;
      }
      const selected = await saveFile({ defaultPath: defaultName, filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
      if (typeof selected === 'string') await writeHtml(selected, html);
    } catch (error) { window.alert(String(error)); }
  }

  function updateSource(source: string) {
    if (!active) return;
    setDocuments(current => current.map(item => item.id === active.id ? { ...item, source, dirty: source !== item.savedSource } : item));
  }

  function jumpToHeading(item: OutlineEntry) {
    const index = headings.indexOf(item);
    if (active?.mode === 'source' && editorRef.current) {
      editorRef.current.focus();
      editorRef.current.setSelection(item.offset);
      return;
    }
    const heading = document.querySelector('.pm-editor')?.querySelectorAll('h1, h2, h3, h4, h5, h6').item(index);
    heading?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function jumpToSearch(offset: number, index: number) {
    if (active?.mode === 'source' && editorRef.current) {
      editorRef.current.focus();
      editorRef.current.setSelection(offset);
      return;
    }
    document.querySelectorAll('.md-search-hit').item(index)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function insertImages(files: File[]) {
    if (!active?.path || !files.length) return;
    const position = editorRef.current?.getSelectionStart() ?? active.source.length;
    try {
      const inputs: ImageInput[] = await Promise.all(files.slice(0, 100).map(async file => ({ name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] })));
      const destinations = await writeImages(active.path!, inputs);
      const insertion = destinations.map(destination => `![](<${destination.replace(/[<>\n]/g, character => encodeURIComponent(character))}>)`).join('\n');
      const source = active.source.slice(0, position) + (position && !/\n$/.test(active.source.slice(0, position)) ? '\n' : '') + insertion + '\n' + active.source.slice(position);
      updateSource(source);
    } catch (error) { window.alert(String(error)); }
  }

  function persistPlugins(next: InstalledPlugin[]) {
    setPlugins(next);
    localStorage.setItem('markit.plugins', JSON.stringify(next));
  }

  function clearPluginContributions(pluginId: string) {
    setPluginCommands(current => current.filter(command => command.pluginId !== pluginId));
    setPluginPanels(current => current.filter(panel => panel.pluginId !== pluginId));
    setSelectedPluginPanel(current => current?.pluginId === pluginId ? null : current);
  }

  async function installPlugin(bytes: Uint8Array) {
    try {
      const packaged = await parsePluginPackage(bytes);
      await savePluginEntry(packaged.manifest.id, packaged.entrySource);
      const registry = new PluginRegistry(plugins);
      registry.install(packaged.manifest, packaged);
      persistPlugins(registry.list());
      setPluginError('');
    } catch (error) {
      setPluginError(error instanceof Error ? error.message : String(error));
    }
  }

  async function choosePlugin() {
    setPluginError('');
    if (!isTauriRuntime) { pluginInputRef.current?.click(); return; }
    try {
      const selection = await open({ multiple: false, directory: false, filters: [{ name: 'Markit plugin', extensions: ['markit-plugin'] }] });
      if (typeof selection === 'string') await installPlugin(new Uint8Array(await readPluginPackage(selection)));
    } catch (error) { setPluginError(error instanceof Error ? error.message : String(error)); }
  }

  function togglePlugin(plugin: InstalledPlugin) {
    void setPluginEnabled(plugin);
  }

  async function setPluginEnabled(plugin: InstalledPlugin) {
    const registry = new PluginRegistry(plugins);
    try {
      if (plugin.enabled) {
        const host = pluginHostsRef.current.get(plugin.manifest.id);
        if (host) await host.deactivate();
        pluginHostsRef.current.delete(plugin.manifest.id);
        clearPluginContributions(plugin.manifest.id);
      } else {
        const approved = plugin.manifest.permissions.filter(requiresPrompt);
        if (approved.length && !window.confirm(`${t('pluginPermissionPrompt')}\n${approved.join(', ')}`)) return;
        await activatePlugin(plugin, approved);
      }
      registry.setEnabled(plugin.manifest.id, !plugin.enabled);
      registry.setError(plugin.manifest.id, undefined);
      persistPlugins(registry.list());
    } catch (error) {
      registry.setEnabled(plugin.manifest.id, false);
      registry.setError(plugin.manifest.id, error instanceof Error ? error.message : String(error));
      clearPluginContributions(plugin.manifest.id);
      persistPlugins(registry.list());
      setPluginError(error instanceof Error ? error.message : String(error));
    }
  }

  async function activatePlugin(plugin: InstalledPlugin, approvedPermissions: InstalledPlugin['manifest']['permissions'] = []): Promise<void> {
    if (pluginHostsRef.current.has(plugin.manifest.id)) return;
    const entrySource = await loadPluginEntry(plugin.manifest.id);
    if (!entrySource) throw new Error('Plugin package contents are unavailable. Reinstall the plugin.');
    const host = new PluginWorkerHost({
      manifest: plugin.manifest,
      entrySource,
      approvedPermissions,
      confirmPermission: async permission => window.confirm(`${t('pluginPermissionPrompt')}\n${permission}`),
      handleRequest: async (method, args) => {
        if (method === 'document.read') return documentsRef.current.find(item => item.id === activeIdRef.current) || null;
        if (method === 'document.update') {
          const source = args[0];
          if (typeof source !== 'string' || !activeIdRef.current) throw new Error('No active document is available.');
          setDocuments(current => current.map(item => item.id === activeIdRef.current ? { ...item, source, dirty: source !== item.savedSource } : item));
          return null;
        }
        if (method === 'settings.get') {
          const key = args[0];
          if (typeof key !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/u.test(key)) throw new Error('Plugin setting key is invalid.');
          return localStorage.getItem(`markit.plugin.${plugin.manifest.id}.${key}`);
        }
        if (method === 'settings.set') {
          const [key, value] = args;
          if (typeof key !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/u.test(key) || typeof value !== 'string') throw new Error('Plugin setting is invalid.');
          if (value.length > 512 * 1024) throw new Error('Plugin setting exceeds the 512 KiB limit.');
          localStorage.setItem(`markit.plugin.${plugin.manifest.id}.${key}`, value);
          return null;
        }
        if (method === 'network.fetch') {
          const [rawUrl, rawInit] = args;
          if (typeof rawUrl !== 'string') throw new Error('Plugin network URL is invalid.');
          const url = new URL(rawUrl);
          if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port !== '23119') throw new Error('Plugin network access is limited to Zotero at localhost:23119.');
          const init = rawInit && typeof rawInit === 'object' ? rawInit as { method?: string; headers?: Record<string, string>; body?: string } : {};
          const methodName = init.method || 'GET';
          if (methodName !== 'GET' && methodName !== 'POST') throw new Error('Plugin network method is not allowed.');
          if (init.body && init.body.length > 128 * 1024) throw new Error('Plugin request body exceeds the 128 KiB limit.');
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 10_000);
          try {
            const response = await fetch(url, { method: methodName, headers: init.headers, body: init.body, signal: controller.signal });
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Plugin response exceeds the 8 MiB limit.');
            return { status: response.status, headers: { 'content-type': response.headers.get('content-type') || '' }, body: new TextDecoder().decode(bytes) };
          } finally { window.clearTimeout(timeout); }
        }
        if (method === 'commands.register') {
          const descriptor = args[0];
          if (!descriptor || typeof descriptor !== 'object' || typeof (descriptor as { id?: unknown }).id !== 'string' || typeof (descriptor as { title?: unknown }).title !== 'string') throw new Error('Plugin command descriptor is invalid.');
          const command = descriptor as { id: string; title: string; shortcut?: string; visible?: boolean };
          setPluginCommands(current => [...current.filter(item => !(item.pluginId === plugin.manifest.id && item.id === command.id)), { ...command, pluginId: plugin.manifest.id, host }]);
          return null;
        }
        if (method === 'commands.unregister') {
          const id = args[0];
          if (typeof id === 'string') setPluginCommands(current => current.filter(item => !(item.pluginId === plugin.manifest.id && item.id === id)));
          return null;
        }
        if (method === 'panels.register') {
          const descriptor = args[0];
          if (!descriptor || typeof descriptor !== 'object' || typeof (descriptor as { id?: unknown }).id !== 'string' || typeof (descriptor as { title?: unknown }).title !== 'string') throw new Error('Plugin panel descriptor is invalid.');
          const panel = descriptor as { id: string; title: string; attribution?: string; searchCommand?: string; initialContent?: { status?: string; items?: unknown[]; citations?: Record<string, number> } };
          const citations = panel.initialContent?.citations && typeof panel.initialContent.citations === 'object'
            ? Object.fromEntries(Object.entries(panel.initialContent.citations).filter(([key, value]) => /^[A-Z0-9]{8}$/u.test(key) && Number.isInteger(value) && Number(value) > 0).slice(0, 500))
            : undefined;
          const initialContent: PluginPanelContent = {
            status: typeof panel.initialContent?.status === 'string' ? panel.initialContent.status.slice(0, 1000) : undefined,
            items: Array.isArray(panel.initialContent?.items) ? panel.initialContent.items.filter((item): item is PluginPanelItem => Boolean(item && typeof item === 'object' && typeof (item as PluginPanelItem).id === 'string' && typeof (item as PluginPanelItem).title === 'string')).slice(0, 100) : [],
            citations,
          };
          setPluginPanels(current => [...current.filter(item => !(item.pluginId === plugin.manifest.id && item.id === panel.id)), { ...panel, pluginId: plugin.manifest.id, content: initialContent }]);
          return null;
        }
        if (method === 'panels.update') {
          const [panelId, rawContent] = args;
          if (typeof panelId !== 'string' || !rawContent || typeof rawContent !== 'object') throw new Error('Plugin panel update is invalid.');
          const content = rawContent as { status?: unknown; items?: unknown; citations?: unknown };
          const citations = content.citations && typeof content.citations === 'object'
            ? Object.fromEntries(Object.entries(content.citations).filter(([key, value]) => /^[A-Z0-9]{8}$/u.test(key) && Number.isInteger(value) && Number(value) > 0).slice(0, 500))
            : undefined;
          const nextContent: PluginPanelContent = {
            status: typeof content.status === 'string' ? content.status.slice(0, 1000) : undefined,
            items: Array.isArray(content.items) ? content.items.filter((item): item is PluginPanelItem => Boolean(item && typeof item === 'object' && typeof (item as PluginPanelItem).id === 'string' && typeof (item as PluginPanelItem).title === 'string')).slice(0, 100) : [],
            citations,
          };
          setPluginPanels(current => current.map(panel => panel.pluginId === plugin.manifest.id && panel.id === panelId ? { ...panel, content: nextContent } : panel));
          return null;
        }
        if (method === 'panels.unregister') {
          const id = args[0];
          if (typeof id === 'string') setPluginPanels(current => current.filter(item => !(item.pluginId === plugin.manifest.id && item.id === id)));
          return null;
        }
        throw new Error(`Unsupported plugin request: ${method}`);
      },
    });
    try { await host.activate(); } catch (error) { await host.deactivate().catch(() => undefined); throw error; }
    pluginHostsRef.current.set(plugin.manifest.id, host);
  }

  async function removePlugin(plugin: InstalledPlugin) {
    const host = pluginHostsRef.current.get(plugin.manifest.id);
    if (host) await host.deactivate().catch(() => undefined);
    pluginHostsRef.current.delete(plugin.manifest.id);
    clearPluginContributions(plugin.manifest.id);
    await removePluginEntry(plugin.manifest.id).catch(() => undefined);
    const registry = new PluginRegistry(plugins);
    registry.remove(plugin.manifest.id);
    persistPlugins(registry.list());
  }

  async function runPluginCommand(command: PluginCommandContribution, args: unknown[] = []) {
    try { await command.host.executeCommand(command.id, args); }
    catch (error) { setPluginError(error instanceof Error ? error.message : String(error)); }
  }

  function runPanelAction(panel: PluginPanelContribution, action: { id: string; args?: unknown[] }) {
    const command = pluginCommands.find(item => item.pluginId === panel.pluginId && item.id === action.id);
    if (command) void runPluginCommand(command, action.args || []);
  }

  const filteredHeadings = headings;
  const searchResults = useMemo(() => {
    const needle = query.trim();
    if (!active || !needle) return [] as { offset: number; text: string }[];
    const source = active.source;
    const lowerSource = source.toLocaleLowerCase();
    const lowerNeedle = needle.toLocaleLowerCase();
    const results: { offset: number; text: string }[] = [];
    let offset = lowerSource.indexOf(lowerNeedle);
    while (offset >= 0 && results.length < 100) {
      const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
      const lineEnd = source.indexOf('\n', offset);
      const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim();
      results.push({ offset, text: line || needle });
      offset = lowerSource.indexOf(lowerNeedle, offset + Math.max(1, lowerNeedle.length));
    }
    return results;
  }, [active?.id, active?.source, query]);
  const closeDocument = (id: string) => { setDocuments(current => current.filter(item => item.id !== id)); if (activeId === id) setActiveId(documents.find(item => item.id !== id)?.id || null); };
  const dragWindow = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !isTauriRuntime) return;
    void getCurrentWindow().startDragging().catch(() => undefined);
  };
  const minimizeWindow = () => { if (isTauriRuntime) void getCurrentWindow().minimize().catch(() => undefined); };
  const toggleMaximizeWindow = async () => {
    if (!isTauriRuntime) return;
    const appWindow = getCurrentWindow();
    try { if (await appWindow.isMaximized()) await appWindow.unmaximize(); else await appWindow.maximize(); } catch { /* Window controls are unavailable in browser preview. */ }
  };
  const closeWindow = () => { if (isTauriRuntime) void getCurrentWindow().close().catch(() => undefined); };
  const toggleSidebar = () => {
    if (focusMode) {
      setFocusMode(false);
      return;
    }
    setSidebarCollapsed(current => !current);
  };
  const sidebarIsVisible = !focusMode && !sidebarCollapsed;

  return <div className={`markit-app ${focusMode ? 'focus-mode' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <header className="titlebar">
      <div className="titlebar-left" data-tauri-drag-region="true" onPointerDown={dragWindow} onDoubleClick={() => void toggleMaximizeWindow()}>
        <button className="menu-trigger" title={t('menu')} aria-label={t('menu')} onPointerDown={event => event.stopPropagation()} onClick={() => setMenuOpen(current => !current)}><Menu size={16} /></button>
        <div className="brand" title="Markit"><strong>Markit</strong></div>
      </div>
      <div className="titlebar-title" data-tauri-drag-region="true" onPointerDown={dragWindow} onDoubleClick={() => void toggleMaximizeWindow()} title={active ? titleFor(active.path, locale) : 'Markit'}>
        <span className="titlebar-document">{active ? titleFor(active.path, locale) : 'Markit'}</span>
        {active && <span className={`titlebar-status ${active.dirty ? 'dirty' : ''}`} aria-label={active.dirty ? t('unsaved') : t('saved')} />}
      </div>
      <div className="titlebar-actions">
        <div className="window-controls" aria-label="Window controls">
          <button className="window-control" title="Minimize" aria-label="Minimize" onClick={minimizeWindow}><Minus size={15} /></button>
          <button className="window-control" title="Maximize" aria-label="Maximize" onClick={() => void toggleMaximizeWindow()}><Square size={13} /></button>
          <button className="window-control window-control-close" title="Close" aria-label="Close" onClick={closeWindow}><X size={15} /></button>
        </div>
      </div>
    </header>
    {menuOpen && <>
      <button className="menu-scrim" aria-label={t('closeMenu')} onClick={() => setMenuOpen(false)} />
      <aside className="command-menu" aria-label={t('menu')}>
        <div className="command-menu-header"><span className="command-menu-brand">Markit</span><button className="icon-button" title={t('closeMenu')} aria-label={t('closeMenu')} onClick={() => setMenuOpen(false)}><X size={17} /></button></div>
        <nav className="command-menu-list">
          <button onClick={() => { newDocument(); setMenuOpen(false); }}><Plus size={16} />{t('newDocument')}</button>
          <button onClick={() => { void chooseDocument(); setMenuOpen(false); }}><FolderOpen size={16} />{t('open')}</button>
          <button disabled={!active?.dirty} onClick={() => { void save(); setMenuOpen(false); }}><Save size={16} />{t('save')}</button>
          <button onClick={() => { void exportDocument(); setMenuOpen(false); }}><Download size={16} />{t('exportHtml')}</button>
          <button onClick={() => { imageInputRef.current?.click(); setMenuOpen(false); }}><ImagePlus size={16} />{t('image')}</button>
          <div className="command-menu-rule" />
          <button onClick={() => { toggleSidebar(); setMenuOpen(false); }}><PanelLeft size={16} />{sidebarIsVisible ? t('hideSidebar') : t('showSidebar')}</button>
          <button onClick={() => { setFocusMode(current => !current); setMenuOpen(false); }}><Menu size={16} />{focusMode ? t('exitFocus') : t('focusMode')}</button>
          <button onClick={() => { setShowSettings(true); setMenuOpen(false); }}><Settings2 size={16} />{t('settings')}</button>
          <button onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}><Languages size={16} />{locale === 'zh-CN' ? t('english') : t('chinese')}</button>
          {pluginCommands.filter(command => command.visible !== false).map(command => <button key={`${command.pluginId}:${command.id}`} onClick={() => { void runPluginCommand(command); setMenuOpen(false); }}><Play size={15} /><span>{command.title}</span></button>)}
        </nav>
      </aside>
    </>}
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-tabs">
          {([['files', t('files')], ['outline', t('outline')], ['search', t('search')]] as const).map(([id, label]) => <button key={id} className={sidebar === id ? 'selected' : ''} title={label} aria-label={label} onClick={() => setSidebar(id)}>{label}</button>)}
          {pluginPanels.map(panel => <button key={`${panel.pluginId}:${panel.id}`} className={sidebar === 'plugin' && selectedPluginPanel?.pluginId === panel.pluginId && selectedPluginPanel.id === panel.id ? 'selected' : ''} title={panel.title} aria-label={panel.title} onClick={() => { setSidebar('plugin'); setSelectedPluginPanel(panel); }}>{panel.title}</button>)}
        </div>
        <div className="sidebar-content">
          {sidebar === 'files' && <><div className="sidebar-heading"><span>{t('files')}</span><span><button className="icon-button" title="Open folder" aria-label="Open folder" onClick={() => void chooseWorkspace()}><FolderOpen size={15} /></button><button className="icon-button" title={t('newDocument')} aria-label={t('newDocument')} onClick={newDocument}><Plus size={15} /></button></span></div><p className="workspace-path">{workspace || 'Local workspace'}</p>{entries.filter(entry => !entry.directory && /\.(md|markdown|mdown|mkd|txt)$/i.test(entry.name)).map(entry => <button key={entry.path} className={`file-row ${active?.path === entry.path ? 'active' : ''}`} onClick={() => void openPath(entry.path)}><FileText size={15} /><span>{entry.name}</span></button>)}{!entries.length && <button className="file-row active" onClick={() => void chooseDocument()}><FileText size={15} /><span>{active ? titleFor(active.path, locale) : t('emptyTitle')}</span></button>}</>}
          {sidebar === 'outline' && <><div className="sidebar-heading"><span>{t('outline')}</span><span className="count">{headings.length}</span></div>{filteredHeadings.length ? <nav className="outline-list">{filteredHeadings.map(item => <button key={item.id} style={{ paddingLeft: `${12 + item.level * 10}px` }} onClick={() => jumpToHeading(item)}>{item.text}</button>)}</nav> : <p className="empty-sidebar">{t('noOutline')}</p>}</>}
          {sidebar === 'search' && <><div className="sidebar-heading"><span>{t('search')}</span><span className="count">{query ? searchResults.length : ''}</span></div><input className="sidebar-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('search')} />{query && searchResults.length ? <div className="search-results">{searchResults.map((result, index) => <button className="search-result" key={`${result.offset}:${index}`} onClick={() => jumpToSearch(result.offset, index)}><strong>{result.text}</strong><small>#{index + 1}</small></button>)}</div> : query ? <p className="empty-sidebar">{t('searchNoResults')}</p> : <p className="empty-sidebar">{t('searchHint')}</p>}</>}
          {sidebar === 'plugin' && selectedPluginPanel && <div className="plugin-panel"><div className="sidebar-heading"><span>{selectedPluginPanel.title}</span><span className="count"><Puzzle size={13} /></span></div>{selectedPluginPanel.searchCommand && <input className="plugin-panel-search" aria-label={t('pluginSearchPlaceholder')} placeholder={t('pluginSearchPlaceholder')} onKeyDown={event => { if (event.key === 'Enter') { const command = pluginCommands.find(item => item.pluginId === selectedPluginPanel.pluginId && item.id === selectedPluginPanel.searchCommand); if (command) void runPluginCommand(command, [(event.currentTarget as HTMLInputElement).value]); } }} />}{selectedPluginPanel.content?.status && <p className="plugin-panel-status">{selectedPluginPanel.content.status}</p>}{selectedPluginPanel.content?.items?.length ? <div className="plugin-panel-items">{selectedPluginPanel.content.items.map(item => <button className="plugin-panel-item" key={item.id} onClick={() => item.command && runPanelAction(selectedPluginPanel, item.command)} disabled={!item.command}><strong>{item.title}</strong>{item.meta && <small>{item.meta}</small>}</button>)}</div> : <p className="plugin-panel-status">{t('pluginNoResults')}</p>}{selectedPluginPanel.attribution && <p className="plugin-panel-attribution">{selectedPluginPanel.attribution}</p>}</div>}
        </div>
      </aside>
      <main className="main-panel">
        <div className="document-tabs"><button className="new-tab" title={t('newDocument')} aria-label={t('newDocument')} onClick={newDocument}><Plus size={16} /></button>{documents.map(document => <button key={document.id} className={`document-tab ${document.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(document.id)}><FileText size={14} /><span>{titleFor(document.path, locale)}</span>{document.dirty && <i />}<span className="tab-close" role="button" aria-label="Close" onClick={event => { event.stopPropagation(); closeDocument(document.id); }}><X size={13} /></span></button>)}</div>
        {active ? <>
          <div className="editor-toolbar"><button className="toolbar-command" onClick={newDocument}><Plus size={15} />{t('newDocument')}</button><button className="toolbar-command" onClick={() => void chooseDocument()}><FolderOpen size={15} />{t('open')}</button><button className="toolbar-command" onClick={() => void save()} disabled={!active.dirty}><Save size={15} />{t('save')}</button><button className="toolbar-command" onClick={() => void exportDocument()} title={t('exportHtml')}><Download size={15} />{t('exportHtml')}</button><button className="toolbar-command" onClick={() => imageInputRef.current?.click()} title={t('image')}><ImagePlus size={15} />{t('image')}</button><input ref={imageInputRef} hidden type="file" accept="image/*" multiple onChange={event => { void insertImages(Array.from(event.target.files || [])); event.currentTarget.value = ''; }} />{pluginCommands.filter(command => command.visible !== false).map(command => <button key={`${command.pluginId}:${command.id}`} className="toolbar-command plugin-command" title={command.shortcut ? `${command.title} (${command.shortcut})` : command.title} onClick={() => void runPluginCommand(command)}><Play size={14} /><span>{command.title}</span></button>)}<span className="toolbar-spacer" /><button className={`mode-switch ${active.mode === 'source' ? 'selected' : ''}`} onClick={() => setDocuments(current => current.map(item => item.id === active.id ? { ...item, mode: 'source' } : item))}>{t('source')}</button><button className={`mode-switch ${active.mode === 'live' ? 'selected' : ''}`} onClick={() => setDocuments(current => current.map(item => item.id === active.id ? { ...item, mode: 'live' } : item))}>{t('live')}</button></div>
          {active.externalChange && <div className="external-change" role="alert"><span>{t('externalChange')}</span><button className="secondary-command" onClick={() => void reloadActiveDocument()}><RotateCcw size={14} />{t('reload')}</button></div>}
          <div className="editor-scroll"><div className="editor-column">{active.mode === 'source' ? <Suspense fallback={<div className="editor-loading">Loading editor…</div>}><CodeMirrorEditor ref={editorRef} source={active.source} searchQuery={query} onChange={updateSource} onImageFiles={files => { void insertImages(files); }} /></Suspense> : <Suspense fallback={<div className="editor-loading">Loading editor…</div>}><ProseMirrorEditor source={active.source} documentPath={active.path} citationMap={citationMap} searchQuery={query} onChange={updateSource} /></Suspense>}</div></div>
          <footer className="statusbar"><div className="statusbar-left"><button className="status-button" title={sidebarIsVisible ? t('hideSidebar') : t('showSidebar')} aria-label={sidebarIsVisible ? t('hideSidebar') : t('showSidebar')} onClick={toggleSidebar}><PanelLeft size={14} /></button><div className="status-mode-switch" role="group" aria-label={`${t('source')} / ${t('preview')}`}><button className={`status-mode-option ${active.mode === 'source' ? 'selected' : ''}`} title={t('source')} aria-label={t('source')} onClick={() => setDocuments(current => current.map(item => item.id === active.id ? { ...item, mode: 'source' } : item))}><Code2 size={14} /></button><button className={`status-mode-option ${active.mode === 'live' ? 'selected' : ''}`} title={t('preview')} aria-label={t('preview')} onClick={() => setDocuments(current => current.map(item => item.id === active.id ? { ...item, mode: 'live' } : item))}><Eye size={14} /></button></div><button className="status-button" title={focusMode ? t('exitFocus') : t('focusMode')} aria-label={focusMode ? t('exitFocus') : t('focusMode')} onClick={() => setFocusMode(current => !current)}><Focus size={14} /></button></div><div className="statusbar-right"><span>{wordCount(active.source).toLocaleString()} {t('words')}</span><span>{active.revision ? 'UTF-8' : 'Local'}</span><span className={active.dirty ? 'status-dirty' : ''}>{active.dirty ? t('unsaved') : t('saved')}</span></div></footer>
        </> : <div className="empty-state"><div className="empty-icon"><PanelLeft size={25} /></div><h1>{t('emptyTitle')}</h1><p>{t('emptyBody')}</p><button className="primary-command" onClick={newDocument}><Plus size={16} />{t('newDocument')}</button><button className="secondary-command" onClick={() => void chooseDocument()}><FolderOpen size={16} />{t('open')}</button></div>}
      </main>
    </div>
    {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><section className="settings-modal" onClick={event => event.stopPropagation()}><header><h2>{t('settings')}</h2><button className="icon-button" title="Close" aria-label="Close" onClick={() => setShowSettings(false)}><X size={18} /></button></header><div className="settings-row"><span>{t('language')}</span><button className="secondary-command" onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}>{locale === 'zh-CN' ? t('chinese') : t('english')}</button></div><div className="settings-section"><div className="settings-section-heading"><strong>{t('plugins')}</strong><button className="secondary-command" onClick={() => void choosePlugin()}><Upload size={14} />{t('installPlugin')}</button><input ref={pluginInputRef} hidden type="file" accept=".markit-plugin" onChange={event => { const file = event.target.files?.[0]; if (file) void file.arrayBuffer().then(bytes => installPlugin(new Uint8Array(bytes))); event.currentTarget.value = ''; }} /></div>{pluginError && <p className="plugin-error">{t('pluginInstallError')}: {pluginError}</p>}{plugins.length ? <div className="plugin-list">{plugins.map(plugin => <article className="plugin-row" key={plugin.manifest.id}><div className="plugin-info"><strong>{plugin.manifest.name}</strong><span>{plugin.manifest.id} · v{plugin.manifest.version}</span><small>{t('pluginPermissions')}: {plugin.manifest.permissions.length ? plugin.manifest.permissions.join(', ') : 'none'}</small></div><div className="plugin-actions">{(plugin.integrityVerified || plugin.signaturePresent) && <span title={plugin.integrityVerified ? t('pluginIntegrity') : t('pluginUnsigned')}><ShieldCheck size={14} /></span>}<button className="icon-button" title={plugin.enabled ? t('disablePlugin') : t('enablePlugin')} aria-label={plugin.enabled ? t('disablePlugin') : t('enablePlugin')} onClick={() => togglePlugin(plugin)}><span className={`plugin-toggle ${plugin.enabled ? 'enabled' : ''}`} /></button><button className="icon-button" title={t('removePlugin')} aria-label={t('removePlugin')} onClick={() => removePlugin(plugin)}><Trash2 size={14} /></button></div></article>)}</div> : <p className="empty-sidebar">{t('noPlugins')}</p>}</div></section></div>}
  </div>;
}
