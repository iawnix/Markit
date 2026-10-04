import { useEffect, useRef } from 'react';
import { baseKeymap } from 'prosemirror-commands';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState, Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { registerAsset } from './bridge';
import { markdownParser, markdownSerializer } from '../../../packages/editor/src/prosemirror';

interface Props { source: string; documentPath: string | null; citationMap?: Record<string, number>; onChange(source: string): void }

interface Projection { source: string; mappings: Map<string, string> }

const imagePattern = /!\[[^\]]*\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;
const citationPattern = /\[(?:@[A-Z0-9]{8})(?:\s*;\s*@[A-Z0-9]{8})*\]/gu;

function citationDecorations(state: EditorState, citationMap: Record<string, number>): DecorationSet {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(citationPattern)) {
      const raw = match[0];
      const keys = [...raw.matchAll(/@([A-Z0-9]{8})/gu)].map(item => item[1]);
      const numbers = keys.map(key => citationMap[key]).filter((number): number is number => Number.isInteger(number) && number > 0);
      if (numbers.length !== keys.length || match.index === undefined) continue;
      const from = position + match.index;
      const to = from + raw.length;
      const label = `[${numbers.join(', ')}]`;
      const widget = document.createElement('span');
      widget.className = 'md-citation-inline';
      widget.textContent = label;
      widget.title = keys.map(key => `@${key}`).join('; ');
      widget.setAttribute('aria-label', `${label} ${keys.map(key => `@${key}`).join(', ')}`);
      widget.contentEditable = 'false';
      decorations.push(Decoration.inline(from, to, { class: 'md-citation-source', 'aria-hidden': 'true' }));
      decorations.push(Decoration.widget(from, widget, { side: -1, key: `${from}:${raw}:${label}` }));
    }
  });
  return DecorationSet.create(state.doc, decorations);
}

async function projectImages(source: string, documentPath: string | null): Promise<Projection> {
  const mappings = new Map<string, string>();
  if (!documentPath) return { source, mappings };
  const matches = [...source.matchAll(imagePattern)];
  let projected = source;
  for (const match of matches.reverse()) {
    const original = match[1] || match[2];
    const start = match.index;
    if (!original || start === undefined || /^(?:[a-z][a-z\d+.-]*:|#)/i.test(original)) continue;
    let relative = original;
    try { relative = decodeURIComponent(original); } catch { /* Preserve malformed URLs for the source editor. */ }
    try {
      const url = await registerAsset(documentPath, relative);
      const destinationStart = match[0].indexOf('](');
      const sourceOffset = match[0].indexOf(original, destinationStart + 2);
      if (sourceOffset < 0) continue;
      const absoluteOffset = start + sourceOffset;
      projected = `${projected.slice(0, absoluteOffset)}${url}${projected.slice(absoluteOffset + original.length)}`;
      mappings.set(url, original);
    } catch {
      // A missing image should remain an editable relative Markdown path.
    }
  }
  return { source: projected, mappings };
}

function restoreImages(source: string, mappings: Map<string, string>): string {
  let restored = source;
  for (const [url, original] of mappings) restored = restored.split(url).join(original);
  return restored;
}

export function ProseMirrorEditor({ source, documentPath, citationMap = {}, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const sourceRef = useRef(source);
  const changeRef = useRef(onChange);
  const citationMapRef = useRef(citationMap);
  const projectionRef = useRef({ source: '', documentPath: null as string | null, mappings: new Map<string, string>() });
  changeRef.current = onChange;
  citationMapRef.current = citationMap;

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView(host.current, {
      state: EditorState.create({
        doc: markdownParser.parse(source),
        plugins: [history(), keymap(baseKeymap), new Plugin({ props: { decorations: state => citationDecorations(state, citationMapRef.current) } })],
      }),
      dispatchTransaction(transaction) {
        const next = editor.state.apply(transaction);
        editor.updateState(next);
        if (transaction.docChanged && !transaction.getMeta('markitProjection')) {
          const serialized = restoreImages(markdownSerializer.serialize(next.doc), projectionRef.current.mappings);
          sourceRef.current = serialized;
          projectionRef.current.source = serialized;
          changeRef.current(serialized);
        }
      },
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (editor) editor.dispatch(editor.state.tr.setMeta('markitCitationMap', true));
  }, [citationMap]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.hasFocus() || (source === projectionRef.current.source && documentPath === projectionRef.current.documentPath)) return;
    let cancelled = false;
    void projectImages(source, documentPath).then(projection => {
      if (cancelled || !view.current || editor.hasFocus()) return;
      try {
        const next = markdownParser.parse(projection.source);
        projectionRef.current = { source, documentPath, mappings: projection.mappings };
        editor.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content).setMeta('addToHistory', false).setMeta('markitProjection', true));
        sourceRef.current = source;
      } catch { /* Keep the current semantic projection until the source is valid. */ }
    });
    return () => { cancelled = true; };
  }, [source, documentPath]);

  return <div ref={host} className="pm-editor" aria-label="Markdown editor" />;
}
