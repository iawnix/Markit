import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File, FileImage, FileText, Folder, FolderOpen, Plus, RefreshCw, X } from 'lucide-react';
import { listDirectory } from './bridge';
import type { DirectoryEntry, DocumentSnapshot, Locale } from './contracts';
import { basename, dirname, isDocument, isImage, isInside } from './document-paths';
import { message } from './i18n';

interface Props {
  projectRoot: string | null; documents: DocumentSnapshot[]; activeId: string | null; locale: Locale; refresh: number;
  onSelect(id: string): void; onOpen(entry: DirectoryEntry): void; onOpenProject(): void; onCloseProject(): void; onNew(): void; onRefresh(): void; onDirectory(path: string): void;
}
function Directory({ path, depth, selected, expanded, toggle, refresh, onOpen, locale }: {
  path: string; depth: number; selected: string | null; expanded: Set<string>; toggle(path: string): void; refresh: number; onOpen(entry: DirectoryEntry): void; locale: Locale;
}) {
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const t = (key: Parameters<typeof message>[1]) => message(locale, key);
  useEffect(() => {
    let cancelled = false;
    setError('');
    void listDirectory(path).then(value => { if (!cancelled) setEntries(value); }).catch(error => { if (!cancelled) { setEntries(null); setError(String(error)); } });
    return () => { cancelled = true; };
  }, [path, refresh, retry]);
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected, entries]);
  if (error) return <div className="tree-message" role="status">{error}<button onClick={() => setRetry(value => value + 1)}>{t('retry')}</button></div>;
  if (!entries) return <p className="tree-message">{t('loading')}</p>;
  if (!entries.length) return <p className="tree-message" style={{ paddingLeft: depth * 14 + 8 }}>{t('emptyFolder')}</p>;
  return <>{entries.map(entry => <div key={entry.path}>
    <button ref={selected === entry.path ? selectedRef : undefined} className={`file-row ${selected === entry.path ? 'active' : ''}`} style={{ paddingLeft: depth * 14 + 8 }} title={entry.path} aria-expanded={entry.directory ? expanded.has(entry.path) : undefined} onClick={() => entry.directory ? toggle(entry.path) : onOpen(entry)}>
      {entry.directory ? expanded.has(entry.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span className="tree-spacer" />}
      {entry.directory ? <Folder size={15} /> : isImage(entry.name) ? <FileImage size={15} /> : isDocument(entry.name) ? <FileText size={15} /> : <File size={15} />}<span>{entry.name}</span>
    </button>
    {entry.directory && expanded.has(entry.path) && depth < 40 && <Directory path={entry.path} depth={depth + 1} selected={selected} expanded={expanded} toggle={toggle} refresh={refresh} onOpen={onOpen} locale={locale} />}
  </div>)}</>;
}
export function FilesPanel(props: Props) {
  const { projectRoot, documents, activeId, locale } = props;
  const t = (key: Parameters<typeof message>[1]) => message(locale, key);
  const [expanded, setExpanded] = useState(new Set<string>());
  const activePath = documents.find(doc => doc.id === activeId)?.path || null;
  useEffect(() => {
    try {
      const paths: unknown = JSON.parse(localStorage.getItem(`markit.expanded:${projectRoot}`) || '[]');
      setExpanded(new Set(Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string' && !!projectRoot && isInside(path, projectRoot)) : []));
    } catch { setExpanded(new Set()); }
  }, [projectRoot]);
  useEffect(() => {
    if (!projectRoot || !activePath || !isInside(activePath, projectRoot)) return;
    setExpanded(current => {
      const next = new Set(current);
      let parent = dirname(activePath);
      while (parent && parent !== projectRoot && isInside(parent, projectRoot)) { next.add(parent); const previous = parent; parent = dirname(parent); if (parent === previous) break; }
      return next;
    });
  }, [activePath, projectRoot]);
  const toggle = (path: string) => {
    props.onDirectory(path);
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      localStorage.setItem(`markit.expanded:${projectRoot}`, JSON.stringify([...next]));
      return next;
    });
  };
  return <div className="files-panel">
    <div className="sidebar-heading"><span>{t('openDocuments')}</span><button className="icon-button" title={t('newDocument')} aria-label={t('newDocument')} onClick={props.onNew}><Plus size={15} /></button></div>
    <div className="open-documents">{documents.map(doc => <button key={doc.id} className={`file-row ${doc.id === activeId ? 'active' : ''}`} title={doc.path || t('untitled')} onClick={() => props.onSelect(doc.id)}><FileText size={15} /><span>{doc.path ? basename(doc.path) : t('untitled')}</span>{doc.dirty && <small aria-label={t('unsaved')}>●</small>}</button>)}</div>
    <button className="file-row open-project" onClick={props.onOpenProject}><FolderOpen size={15} /><span>{t('openProject')}</span></button>
    {projectRoot && <section className="project-files" aria-label={t('project')}><div className="sidebar-heading"><button className="project-name" title={projectRoot} onClick={() => props.onDirectory(projectRoot)}>{basename(projectRoot)}</button><span><button className="icon-button" title={t('refresh')} aria-label={t('refresh')} onClick={props.onRefresh}><RefreshCw size={14} /></button><button className="icon-button" title={t('closeProject')} aria-label={t('closeProject')} onClick={props.onCloseProject}><X size={14} /></button></span></div><p className="workspace-path" title={projectRoot}>{projectRoot}</p><Directory key={projectRoot} path={projectRoot} depth={0} selected={activePath} expanded={expanded} toggle={toggle} refresh={props.refresh} onOpen={props.onOpen} locale={locale} /></section>}
  </div>;
}
