import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

export interface SourceEditorHandle {
  focus(): void;
  setSelection(position: number): void;
  getSelectionStart(): number;
}

interface Props {
  source: string;
  onChange(source: string): void;
  onImageFiles?(files: File[]): void;
}

export const CodeMirrorEditor = forwardRef<SourceEditorHandle, Props>(function CodeMirrorEditor({ source, onChange, onImageFiles }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onImageFilesRef = useRef(onImageFiles);
  const syncingRef = useRef(false);
  onChangeRef.current = onChange;
  onImageFilesRef.current = onImageFiles;

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

  return <div ref={host} className="source-editor-codemirror" />;
});
