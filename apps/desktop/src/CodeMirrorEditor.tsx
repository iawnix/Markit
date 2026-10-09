import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { SearchQuery, search, setSearchQuery } from '@codemirror/search';
import { Compartment, EditorState, Transaction, type Extension, type StateCommand } from '@codemirror/state';
import { Decoration, EditorView, keymap, MatchDecorator, ViewPlugin } from '@codemirror/view';
import { createLivePreviewExtension, externalLinkAt, moveToTableCell, pasteTableCells, refreshLivePreview } from './live-preview';
import { editorHighlightStyle } from './editor-highlighting';
import { codeLanguageForFence } from './markdown-code-languages';
import { imageReferences, localImagePath } from './markdown-assets';
import { openExternalUrl, registerAsset } from './bridge';

export interface SourceEditorHandle {
  focus(): void;
  setSelection(position: number): void;
  getSelectionStart(): number;
  insertMarkdown(markdown: string): void;
  captureInsertion(): { insert(text: string): void; cancel(): void };
}

interface Props {
  documentId: string;
  source: string;
  documentPath: string | null;
  mode: 'source' | 'live';
  searchQuery?: string;
  onRequestLink?(currentHref: string): Promise<string | null>;
  onChange(source: string): void;
  onImageFiles?(files: File[]): void;
  onDocumentChange?(id: string, source: string): void;
  assetRoots?: string[];
  assetRefresh?: number;
  onImageError?(failed: boolean): void;
}

function wrapMarkdown(open: string, close: string): StateCommand {
  return ({ state, dispatch }) => {
    const { from, to } = state.selection.main;
    const selected = state.doc.sliceString(from, to);
    const hasWrapper = from >= open.length
      && state.doc.sliceString(from - open.length, from) === open
      && state.doc.sliceString(to, to + close.length) === close;
    const changes = hasWrapper
      ? { from: from - open.length, to: to + close.length, insert: selected }
      : { from, to, insert: `${open}${selected}${close}` };
    const selection = hasWrapper
      ? { anchor: from - open.length, head: to - open.length }
      : { anchor: from + open.length, head: from + open.length + selected.length };
    dispatch(state.update({ changes, selection, scrollIntoView: true }));
    return true;
  };
}

export const CodeMirrorEditor = forwardRef<SourceEditorHandle, Props>(function CodeMirrorEditor({ documentId, documentPath, source, mode, searchQuery = '', onRequestLink, onChange, onImageFiles, onDocumentChange, assetRoots = [], assetRefresh = 0, onImageError }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;
  const pendingInsertions = useRef(new Map<string, { id: string; position: number }>());
  const onRequestLinkRef = useRef(onRequestLink);
  const onImageFilesRef = useRef(onImageFiles);
  const searchQueryRef = useRef(searchQuery);
  const currentDocumentIdRef = useRef(documentId);
  const currentModeRef = useRef<'source' | 'live' | null>(null);
  const currentDocumentPathRef = useRef<string | null>(documentPath);
  const syncingRef = useRef(false);
  const statesRef = useRef(new Map<string, EditorState>());
  const imageUrlsRef = useRef(new Map<string, string>());
  const imageScopeRef = useRef('');
  const previewCompartmentRef = useRef(new Compartment());
  const extensionsRef = useRef<Extension[] | null>(null);
  onChangeRef.current = onChange;
  onRequestLinkRef.current = onRequestLink;
  onImageFilesRef.current = onImageFiles;
  searchQueryRef.current = searchQuery;

  useImperativeHandle(ref, () => ({
    focus() { viewRef.current?.focus(); },
    setSelection(position) {
      const view = viewRef.current;
      if (!view) return;
      const anchor = Math.max(0, Math.min(position, view.state.doc.length));
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
      view.focus();
    },
    getSelectionStart() { return viewRef.current?.state.selection.main.head || 0; },
    captureInsertion() {
      const token = crypto.randomUUID();
      pendingInsertions.current.set(token, { id: currentDocumentIdRef.current, position: viewRef.current?.state.selection.main.head || 0 });
      return {
        cancel() { pendingInsertions.current.delete(token); },
        insert(text) {
          const pending = pendingInsertions.current.get(token);
          pendingInsertions.current.delete(token);
          if (!pending) return;
          const view = viewRef.current;
          const state = pending.id === currentDocumentIdRef.current ? view?.state : statesRef.current.get(pending.id);
          if (!state) return;
          const position = Math.min(pending.position, state.doc.length);
          const insertion = (position && state.doc.sliceString(position - 1, position) !== '\n' ? '\n' : '') + text + '\n';
          const transaction = state.update({ changes: { from: position, insert: insertion }, selection: { anchor: position + insertion.length } });
          if (view && currentDocumentIdRef.current === pending.id) view.dispatch(transaction);
          else {
            for (const other of pendingInsertions.current.values()) if (other.id === pending.id) other.position = transaction.changes.mapPos(other.position, 1);
            statesRef.current.set(pending.id, transaction.state);
            onDocumentChangeRef.current?.(pending.id, transaction.state.doc.toString());
          }
        },
      };
    },
    insertMarkdown(markdownText) {
      const view = viewRef.current;
      if (!view || !markdownText) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: markdownText }, selection: { anchor: from + markdownText.length }, scrollIntoView: true });
      view.focus();
    },
  }), []);

  useLayoutEffect(() => {
    if (!host.current) return;
    const previewCompartment = previewCompartmentRef.current;
    extensionsRef.current = [
      markdown({ base: markdownLanguage, codeLanguages: codeLanguageForFence }),
      history(),
      keymap.of([
        { key: 'Tab', run: command => currentModeRef.current === 'live' ? moveToTableCell(false)(command) : false },
        { key: 'Shift-Tab', run: command => currentModeRef.current === 'live' ? moveToTableCell(true)(command) : false },
        { key: 'Mod-b', run: wrapMarkdown('**', '**') },
        { key: 'Mod-i', run: wrapMarkdown('*', '*') },
        { key: 'Mod-Shift-x', run: wrapMarkdown('~~', '~~') },
        {
          key: 'Mod-k',
          run: ({ state }) => {
            const requestLink = onRequestLinkRef.current;
            const { from, to } = state.selection.main;
            if (!requestLink || from === to) return false;
            const selected = state.doc.sliceString(from, to);
            const existing = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(selected);
            const label = existing?.[1] || selected;
            const documentAtRequest = currentDocumentIdRef.current;
            void requestLink(existing?.[2] || '').then(href => {
              const view = viewRef.current;
              if (!href || !view || currentDocumentIdRef.current !== documentAtRequest) return;
              const currentFrom = Math.min(from, view.state.doc.length);
              const currentTo = Math.min(to, view.state.doc.length);
              const markdownLink = `[${label}](${href})`;
              view.dispatch({
                changes: { from: currentFrom, to: currentTo, insert: markdownLink },
                selection: { anchor: currentFrom + 1, head: currentFrom + 1 + label.length },
                scrollIntoView: true,
              });
              view.focus();
            }).catch(() => undefined);
            return true;
          },
        },
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      syntaxHighlighting(editorHighlightStyle),
      search(),
      previewCompartment.of(mode === 'live' ? createLivePreviewExtension(imageUrlsRef.current, documentPath) : []),
      ViewPlugin.fromClass(class {
        decorations = Decoration.none;
        query = '';

        constructor(view: EditorView) { this.refresh(view); }

        update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean }) {
          const query = searchQueryRef.current.trim();
          if (query !== this.query || update.docChanged || update.viewportChanged) this.refresh(update.view);
        }

        refresh(view: EditorView) {
          this.query = searchQueryRef.current.trim();
          if (!this.query) { this.decorations = Decoration.none; return; }
          const escaped = this.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          this.decorations = new MatchDecorator({ regexp: new RegExp(escaped, 'giu'), decoration: Decoration.mark({ class: 'cm-search-hit' }) }).createDeco(view);
        }
      }, { decorations: value => value.decorations }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor', spellcheck: 'false', autocapitalize: 'off' }),
      EditorView.domEventHandlers({
        click(event, view) {
          if (currentModeRef.current !== 'live' || event.button !== 0 || (!event.ctrlKey && !event.metaKey) || !(event.target instanceof Element) || !event.target.closest('.cm-live-link')) return false;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const href = position === null ? undefined : externalLinkAt(view.state, position);
          if (!href) return false;
          event.preventDefault();
          void openExternalUrl(href).catch(() => undefined);
          return true;
        },
        paste(event, view) {
          if (currentModeRef.current === 'live') {
            const text = event.clipboardData?.getData('text/plain') || '';
            const handled = pasteTableCells(text)({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
            if (handled) { event.preventDefault(); return true; }
          }
          const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
          if (!files.length || !onImageFilesRef.current) return false;
          event.preventDefault();
          onImageFilesRef.current(files);
          return true;
        },
        drop(event, view) {
          const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
          if (!files.length || !onImageFilesRef.current) return false;
          event.preventDefault();
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position !== null) view.dispatch({ selection: { anchor: position } });
          onImageFilesRef.current(files);
          return true;
        },
        dragover(event) {
          if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); return true; }
          return false;
        },
      }),
      EditorView.updateListener.of(update => {
        for (const pending of pendingInsertions.current.values()) if (pending.id === currentDocumentIdRef.current) pending.position = update.changes.mapPos(pending.position, 1);
        statesRef.current.set(currentDocumentIdRef.current, update.state);
        if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: source, extensions: extensionsRef.current }),
    });
    statesRef.current.set(documentId, editor.state);
    viewRef.current = editor;
    currentModeRef.current = mode;
    currentDocumentPathRef.current = documentPath;
    return () => {
      editor.destroy();
      viewRef.current = null;
      currentModeRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const editor = viewRef.current;
    if (!editor || !extensionsRef.current) return;
    let stateChanged = false;
    if (currentDocumentIdRef.current !== documentId) {
      statesRef.current.set(currentDocumentIdRef.current, editor.state);
      currentDocumentIdRef.current = documentId;
      const nextState = statesRef.current.get(documentId) || EditorState.create({ doc: source, extensions: extensionsRef.current });
      editor.setState(nextState);
      statesRef.current.set(documentId, nextState);
      stateChanged = true;
    }
    if (editor.state.doc.toString() !== source) {
      syncingRef.current = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: source },
        selection: { anchor: Math.min(editor.state.selection.main.head, source.length) },
        annotations: Transaction.addToHistory.of(false),
      });
      syncingRef.current = false;
      statesRef.current.set(documentId, editor.state);
    }
    if (stateChanged || currentModeRef.current !== mode || currentDocumentPathRef.current !== documentPath) {
      editor.dispatch({ effects: previewCompartmentRef.current.reconfigure(mode === 'live' ? [
        createLivePreviewExtension(imageUrlsRef.current, documentPath),
      ] : []) });
      currentModeRef.current = mode;
      currentDocumentPathRef.current = documentPath;
    }
  }, [documentId, documentPath, source, mode]);

  const rootsKey = JSON.stringify(assetRoots);
  useEffect(() => {
    let cancelled = false;
    if (!documentPath) { onImageError?.(false); return; }
    const roots: string[] = JSON.parse(rootsKey);
    // A scope change invalidates previews that were authorized by the previous project.
    const scope = `${rootsKey}:${assetRefresh}`;
    if (imageScopeRef.current !== scope) { imageUrlsRef.current.clear(); imageScopeRef.current = scope; }
    const refs = [...new Set(imageReferences(source).map(ref => ref.destination))];
    void Promise.all(refs.map(async destination => {
      let relative: string | null;
      try { relative = localImagePath(destination); } catch { return true; }
      if (!relative) return false;
      try {
        if (imageUrlsRef.current.has(`${documentPath}\0${relative}`)) return false;
        const url = await registerAsset(documentPath, relative, roots);
        if (!cancelled) imageUrlsRef.current.set(`${documentPath}\0${relative}`, url);
        return false;
      } catch { return true; }
    })).then(failures => {
      if (cancelled) return;
      viewRef.current?.dispatch({ effects: refreshLivePreview.of(undefined) });
      onImageError?.(failures.some(Boolean));
    });
    return () => { cancelled = true; };
  }, [documentPath, source, rootsKey, assetRefresh]);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) return;
    editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: searchQuery })) });
  }, [searchQuery]);

  return <div ref={host} className={`source-editor-codemirror ${mode === 'live' ? 'live-preview' : ''}`} />;
});
