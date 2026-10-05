import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { SearchQuery, search, setSearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, keymap, MatchDecorator, ViewPlugin } from '@codemirror/view';

export interface SourceEditorHandle {
  focus(): void;
  setSelection(position: number): void;
  getSelectionStart(): number;
}

interface Props {
  source: string;
  searchQuery?: string;
  onChange(source: string): void;
  onImageFiles?(files: File[]): void;
}

export const CodeMirrorEditor = forwardRef<SourceEditorHandle, Props>(function CodeMirrorEditor({ source, searchQuery = '', onChange, onImageFiles }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onImageFilesRef = useRef(onImageFiles);
  const searchQueryRef = useRef(searchQuery);
  const syncingRef = useRef(false);
  onChangeRef.current = onChange;
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
  }), []);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: source,
        extensions: [
          markdown(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          syntaxHighlighting(defaultHighlightStyle),
          search(),
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
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown source editor', spellcheck: 'false', autocapitalize: 'off' }),
          EditorView.domEventHandlers({
            paste(event) {
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
            if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = editor;
    return () => { editor.destroy(); viewRef.current = null; };
  }, []);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor || editor.state.doc.toString() === source) return;
    syncingRef.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } });
    syncingRef.current = false;
  }, [source]);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) return;
    editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: searchQuery })) });
  }, [searchQuery]);

  return <div ref={host} className="source-editor-codemirror" />;
});
