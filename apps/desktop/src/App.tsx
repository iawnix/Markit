import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open, save as saveFile } from '@tauri-apps/plugin-dialog';
import { Download, FileText, FolderOpen, ImagePlus, Languages, Menu, PanelLeft, Plus, Save, Search, Settings2, X } from 'lucide-react';
import { exportHtml as writeHtml, importImages as writeImages, isTauriRuntime, listDirectory, outline, readDocument, saveDocument } from './bridge';
import type { DirectoryEntry, DocumentSnapshot, ImageInput, Locale, OutlineEntry } from './contracts';
import { message } from './i18n';
import { renderHtmlDocument } from '../../../packages/markdown/src/index';
const ProseMirrorEditor = lazy(() => import('./ProseMirrorEditor').then(module => ({ default: module.ProseMirrorEditor })));

type Sidebar = 'files' | 'outline' | 'search';

function titleFor(path: string | null, locale: Locale) {
  return path?.split(/[\\/]/).at(-1) || message(locale, 'untitled');
}

function wordCount(source: string) { return source.trim() ? source.trim().split(/\s+/u).length : 0; }

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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const documentsRef = useRef<DocumentSnapshot[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const active = documents.find(document => document.id === activeId) || null;
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
  useEffect(() => { localStorage.setItem('markit.locale', locale); document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { documentsRef.current = documents; }, [documents]);

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
      setDocuments(current => current.map(item => item.id === active.id ? { ...item, path, title: titleFor(path, locale), savedSource: item.source, dirty: false, revision } : item));
    } catch (error) { window.alert(String(error)); }
  }

  async function exportDocument() {
    if (!active) return;
    const defaultName = `${titleFor(active.path, locale).replace(/\.(md|markdown|mdown|mkd)$/i, '') || 'Markit-export'}.html`;
    const html = renderHtmlDocument(active.source, titleFor(active.path, locale));
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
      editorRef.current.setSelectionRange(item.offset, item.offset);
      return;
    }
    const heading = document.querySelector('.pm-editor')?.querySelectorAll('h1, h2, h3, h4, h5, h6').item(index);
    heading?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function insertImages(files: File[]) {
    if (!active?.path || !files.length) return;
    try {
      const inputs: ImageInput[] = await Promise.all(files.slice(0, 100).map(async file => ({ name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] })));
      const destinations = await writeImages(active.path!, inputs);
      const insertion = destinations.map(destination => `![](<${destination.replace(/[<>\n]/g, character => encodeURIComponent(character))}>)`).join('\n');
      const element = editorRef.current;
      const position = element?.selectionStart ?? active.source.length;
      const source = active.source.slice(0, position) + (position && !/\n$/.test(active.source.slice(0, position)) ? '\n' : '') + insertion + '\n' + active.source.slice(position);
      updateSource(source);
    } catch (error) { window.alert(String(error)); }
  }

  const filteredHeadings = useMemo(() => headings.filter(item => item.text.toLowerCase().includes(query.toLowerCase())), [headings, query]);
  const closeDocument = (id: string) => { setDocuments(current => current.filter(item => item.id !== id)); if (activeId === id) setActiveId(documents.find(item => item.id !== id)?.id || null); };

  return <div className="markit-app">
    <header className="titlebar">
      <div className="brand"><span className="brand-mark">M</span><strong>Markit</strong></div>
      <div className="titlebar-title">{active ? titleFor(active.path, locale) : 'Markit'}</div>
      <div className="titlebar-actions">
        <button className="icon-button" title={t('language')} aria-label={t('language')} onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}><Languages size={16} /></button>
        <button className="icon-button" title={t('settings')} aria-label={t('settings')} onClick={() => setShowSettings(true)}><Settings2 size={16} /></button>
      </div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-tabs">
          {([['files', FileText, t('files')], ['outline', Menu, t('outline')], ['search', Search, t('search')]] as const).map(([id, Icon, label]) => <button key={id} className={sidebar === id ? 'selected' : ''} title={label} aria-label={label} onClick={() => setSidebar(id)}><Icon size={16} /></button>)}
        </div>
        <div className="sidebar-content">
          {sidebar === 'files' && <><div className="sidebar-heading"><span>{t('files')}</span><span><button className="icon-button" title="Open folder" aria-label="Open folder" onClick={() => void chooseWorkspace()}><FolderOpen size={15} /></button><button className="icon-button" title={t('newDocument')} aria-label={t('newDocument')} onClick={newDocument}><Plus size={15} /></button></span></div><p className="workspace-path">{workspace || 'Local workspace'}</p>{entries.filter(entry => !entry.directory && /\.(md|markdown|mdown|mkd|txt)$/i.test(entry.name)).map(entry => <button key={entry.path} className={`file-row ${active?.path === entry.path ? 'active' : ''}`} onClick={() => void openPath(entry.path)}><FileText size={15} /><span>{entry.name}</span></button>)}{!entries.length && <button className="file-row active" onClick={() => void chooseDocument()}><FileText size={15} /><span>{active ? titleFor(active.path, locale) : t('emptyTitle')}</span></button>}</>}
          {sidebar === 'outline' && <><div className="sidebar-heading"><span>{t('outline')}</span><span className="count">{headings.length}</span></div>{filteredHeadings.length ? <nav className="outline-list">{filteredHeadings.map(item => <button key={item.id} style={{ paddingLeft: `${12 + item.level * 10}px` }} onClick={() => jumpToHeading(item)}>{item.text}</button>)}</nav> : <p className="empty-sidebar">{t('noOutline')}</p>}</>}
          {sidebar === 'search' && <><div className="sidebar-heading"><span>{t('search')}</span></div><input className="sidebar-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('search')} />{query && <p className="empty-sidebar">{active?.source.toLowerCase().includes(query.toLowerCase()) ? '1 match' : 'No matches'}</p>}</>}
        </div>
      </aside>
      <main className="main-panel">
        <div className="document-tabs"><button className="new-tab" title={t('newDocument')} aria-label={t('newDocument')} onClick={newDocument}><Plus size={16} /></button>{documents.map(document => <button key={document.id} className={`document-tab ${document.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(document.id)}><FileText size={14} /><span>{titleFor(document.path, locale)}</span>{document.dirty && <i />}<span className="tab-close" role="button" aria-label="Close" onClick={event => { event.stopPropagation(); closeDocument(document.id); }}><X size={13} /></span></button>)}</div>
        {active ? <>
          <div className="editor-toolbar"><button className="toolbar-command" onClick={newDocument}><Plus size={15} />{t('newDocument')}</button><button className="toolbar-command" onClick={() => void chooseDocument()}><FolderOpen size={15} />{t('open')}</button><button className="toolbar-command" onClick={() => void save()} disabled={!active.dirty}><Save size={15} />{t('save')}</button><button className="toolbar-command" onClick={() => void exportDocument()} title={t('exportHtml')}><Download size={15} />{t('exportHtml')}</button><button className="toolbar-command" onClick={() => imageInputRef.current?.click()} title={t('image')}><ImagePlus size={15} />{t('image')}</button><input ref={imageInputRef} hidden type="file" accept="image/*" multiple onChange={event => { void insertImages(Array.from(event.target.files || [])); event.currentTarget.value = ''; }} /><span className="toolbar-spacer" /><button className={`mode-switch ${active.mode === 'source' ? 'selected' : ''}`} onClick={() => setDocuments(current => current.map(item => item.id === active.id ? { ...item, mode: 'source' } : item))}>{t('source')}</button><button className={`mode-switch ${active.mode === 'live' ? 'selected' : ''}`} onClick={() => setDocuments(current => current.map(item => item.id === active.id ? { ...item, mode: 'live' } : item))}>{t('live')}</button></div>
          <div className="editor-scroll"><div className="editor-column">{active.mode === 'source' ? <textarea ref={editorRef} className="source-editor" value={active.source} onChange={event => updateSource(event.target.value)} onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void insertImages(files); } }} onDrop={event => { const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void insertImages(files); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} spellCheck={false} /> : <Suspense fallback={<div className="editor-loading">Loading editor…</div>}><ProseMirrorEditor source={active.source} documentPath={active.path} onChange={updateSource} /></Suspense>}</div></div>
          <footer className="statusbar"><span>{wordCount(active.source).toLocaleString()} {t('words')}</span><span>{active.revision ? 'UTF-8' : 'Local'}</span><span className={active.dirty ? 'status-dirty' : ''}>{active.dirty ? t('unsaved') : t('saved')}</span></footer>
        </> : <div className="empty-state"><div className="empty-icon"><PanelLeft size={25} /></div><h1>{t('emptyTitle')}</h1><p>{t('emptyBody')}</p><button className="primary-command" onClick={newDocument}><Plus size={16} />{t('newDocument')}</button><button className="secondary-command" onClick={() => void chooseDocument()}><FolderOpen size={16} />{t('open')}</button></div>}
      </main>
    </div>
    {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><section className="settings-modal" onClick={event => event.stopPropagation()}><header><h2>{t('settings')}</h2><button className="icon-button" title="Close" aria-label="Close" onClick={() => setShowSettings(false)}><X size={18} /></button></header><div className="settings-row"><span>{t('language')}</span><button className="secondary-command" onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}>{locale === 'zh-CN' ? t('chinese') : t('english')}</button></div></section></div>}
  </div>;
}
