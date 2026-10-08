import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { SearchQuery, search, setSearchQuery } from '@codemirror/search';
import { Compartment, EditorState, Transaction, type Extension, type StateCommand } from '@codemirror/state';
import { Decoration, EditorView, keymap, MatchDecorator, ViewPlugin } from '@codemirror/view';
import { createLivePreviewExtension, externalLinkAt, moveToTableCell, pasteTableCells, refreshLivePreview } from './live-preview';
import { codeLanguageForFence } from './markdown-code-languages';
import { openExternalUrl, registerAsset } from './bridge';

export interface SourceEditorHandle {
  focus(): void;
  setSelection(position: number): void;
  getSelectionStart(): number;
  insertMarkdown(markdown: string): void;
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

export const CodeMirrorEditor = forwardRef<SourceEditorHandle, Props>(function CodeMirrorEditor({ documentId, documentPath, source, mode, searchQuery = '', onRequestLink, onChange, onImageFiles }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRequestLinkRef = useRef(onRequestLink);
  const onImageFilesRef = useRef(onImageFiles);
  const searchQueryRef = useRef(searchQuery);
  const currentDocumentIdRef = useRef(documentId);
  const currentModeRef = useRef<'source' | 'live' | null>(null);
  const currentDocumentPathRef = useRef<string | null>(documentPath);
  const syncingRef = useRef(false);
  const statesRef = useRef(new Map<string, EditorState>());
  const imageUrlsRef = useRef(new Map<string, string>());
  const imageRequestsRef = useRef(new Set<string>());
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
      syntaxHighlighting(defaultHighlightStyle),
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
          if (currentModeRef.current !== 'live' || !(event.target instanceof Element) || !event.target.closest('.cm-live-link')) return false;
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
        drop(event) {
          const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
          if (!files.length || !onImageFilesRef.current) return false;
          event.preventDefault();
          onImageFilesRef.current(files);
          return true;
        },
        dragover(event) {
          if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); return true; }
          return false;
        },
      }),
      EditorView.updateListener.of(update => {
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

  useEffect(() => {
    if (!documentPath) return;
    const pattern = /!\[[^\]]*\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;
    for (const match of source.matchAll(pattern)) {
      const original = match[1] || match[2];
      if (!original || /^(?:[a-z][a-z\d+.-]*:|#)/i.test(original)) continue;
      let relative = original;
      try { relative = decodeURIComponent(original); } catch { /* Leave malformed paths in Markdown. */ }
      const key = `${documentPath}\0${relative}`;
      if (imageUrlsRef.current.has(key) || imageRequestsRef.current.has(key)) continue;
      imageRequestsRef.current.add(key);
      void registerAsset(documentPath, relative).then(url => {
        imageUrlsRef.current.set(key, url);
        const editor = viewRef.current;
        if (editor) editor.dispatch({ effects: refreshLivePreview.of(undefined) });
      }).catch(() => undefined).finally(() => imageRequestsRef.current.delete(key));
    }
  }, [documentPath, source]);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) return;
    editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: searchQuery })) });
  }, [searchQuery]);

  return <div ref={host} className={`source-editor-codemirror ${mode === 'live' ? 'live-preview' : ''}`} />;
});
