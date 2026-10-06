import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { baseKeymap, chainCommands, createParagraphNear, exitCode, liftEmptyBlock, newlineInCode, splitBlock, toggleMark } from 'prosemirror-commands';
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { MarkType } from 'prosemirror-model';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { addRowAfter, goToNextCell, isInTable, selectedRect, tableEditing } from 'prosemirror-tables';
import { Slice } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { registerAsset } from './bridge';
import { markdownParser, safeLinkHref, serializeMarkdownLike } from '../../../packages/editor/src/prosemirror';

export interface LiveEditorHandle {
  focus(): void;
  insertMarkdown(markdown: string): void;
}

interface Props { source: string; documentPath: string | null; citationMap?: Record<string, number>; searchQuery?: string; linkPrompt?: string; onChange(source: string): void; onImageFiles?(files: File[], position?: number): void }

interface Projection { source: string; mappings: Map<string, string> }

const imagePattern = /!\[[^\]]*\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;
const citationPattern = /\[(?:@[A-Z0-9]{8})(?:\s*;\s*@[A-Z0-9]{8})*\]/gu;

function markInputRule(regexp: RegExp, markType: MarkType): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const boundary = match[1]?.length || 0;
    const content = match[3];
    if (!match[2] || !content) return null;
    const from = start + boundary;
    return state.tr.replaceWith(from, end, state.schema.text(content, [markType.create()]));
  });
}

function linkInputRule(linkType: MarkType): InputRule {
  return new InputRule(/(^|[^\w])\[([^\]\n]+)\]\(([^\s)]+)\)$/, (state, match, start, end) => {
    const boundary = match[1]?.length || 0;
    const content = match[2];
    const href = safeLinkHref(match[3]);
    if (!content || !href) return null;
    const from = start + boundary;
    return state.tr.replaceWith(from, end, state.schema.text(content, [linkType.create({ href, title: null })]));
  });
}

function editLink(state: EditorState, dispatch: ((transaction: Transaction) => void) | undefined, promptText: string): boolean {
  const { from, to } = state.selection;
  if (from === to) return false;
  const link = state.schema.marks.link;
  let current = '';
  state.doc.nodesBetween(from, to, node => {
    const mark = node.marks.find(item => item.type === link);
    if (mark && typeof mark.attrs.href === 'string') current = mark.attrs.href;
  });
  const href = window.prompt(promptText, current || 'https://');
  if (href === null) return true;
  if (dispatch) {
    const transaction = state.tr.removeMark(from, to, link);
    if (href) transaction.addMark(from, to, link.create({ href, title: null }));
    dispatch(transaction.scrollIntoView());
  }
  return true;
}

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

function searchDecorations(state: EditorState, query: string): DecorationSet {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLocaleLowerCase();
    let offset = text.indexOf(needle);
    while (offset >= 0) {
      decorations.push(Decoration.inline(position + offset, position + offset + needle.length, { class: 'md-search-hit' }));
      offset = text.indexOf(needle, offset + Math.max(1, needle.length));
    }
  });
  return DecorationSet.create(state.doc, decorations);
}

function taskDecorations(state: EditorState, onToggle: (from: number, checked: boolean) => void): DecorationSet {
  const decorations: Decoration[] = [];
  const selectionFrom = state.selection.from;
  const selectionTo = state.selection.to;
  state.doc.descendants((node, position, parent) => {
    if (!node.isText || !node.text || parent?.type.name !== 'paragraph') return;
    const match = /^\[([ xX])\]\s/.exec(node.text);
    if (!match) return;
    const from = position;
    const to = from + match[0].length;
    if (selectionFrom <= to && selectionTo >= from) return;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'md-task-checkbox';
    checkbox.checked = match[1].toLowerCase() === 'x';
    checkbox.setAttribute('aria-label', checkbox.checked ? 'Completed task' : 'Incomplete task');
    checkbox.addEventListener('mousedown', event => event.stopPropagation());
    checkbox.addEventListener('change', () => onToggle(from, checkbox.checked));
    decorations.push(Decoration.inline(from, to, { class: 'md-task-source', 'aria-hidden': 'true' }));
    decorations.push(Decoration.widget(from, checkbox, { side: -1, key: `task:${from}:${checkbox.checked}` }));
  });
  return DecorationSet.create(state.doc, decorations);
}

const inlineMathPattern = /(?<!\\)(?<!\$)\$([^\n$]+?)\$(?!\$)/g;

function mathWidget(source: string, display: boolean) {
  const widget = document.createElement('span');
  widget.className = display ? 'md-math-display' : 'md-math-inline';
  widget.title = display ? `$$${source}$$` : `$${source}$`;
  widget.setAttribute('aria-label', widget.title);
  widget.contentEditable = 'false';
  try {
    widget.innerHTML = katex.renderToString(source, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml', maxExpand: 1000, maxSize: 20 });
  } catch {
    widget.textContent = display ? `$$${source}$$` : `$${source}$`;
  }
  return widget;
}

function mathDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const selectionFrom = state.selection.from;
  const selectionTo = state.selection.to;
  const selectionTouches = (from: number, to: number) => selectionFrom === selectionTo
    ? selectionFrom >= from && selectionFrom <= to
    : selectionFrom < to && selectionTo > from;
  state.doc.descendants((node, position) => {
    if (node.type.name === 'code_block') return false;
    if (node.type.name === 'paragraph') {
      const blockMatch = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(node.textContent);
      if (blockMatch && node.content.size > 0) {
        const from = position + 1;
        const to = from + node.content.size;
        if (selectionTouches(from, to)) return false;
        decorations.push(Decoration.inline(from, to, { class: 'md-math-source', 'aria-hidden': 'true' }));
        decorations.push(Decoration.widget(from, mathWidget(blockMatch[1].trim(), true), { side: -1, key: `display:${from}:${blockMatch[1]}` }));
        return false;
      }
    }
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(inlineMathPattern)) {
      if (match.index === undefined) continue;
      const from = position + match.index;
      const to = from + match[0].length;
      if (selectionTouches(from, to)) continue;
      decorations.push(Decoration.inline(from, to, { class: 'md-math-source', 'aria-hidden': 'true' }));
      decorations.push(Decoration.widget(from, mathWidget(match[1], false), { side: -1, key: `inline:${from}:${match[0]}` }));
    }
  });
  return DecorationSet.create(state.doc, decorations);
}

function deleteEmptyHeading(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  const cursor = state.selection.$cursor;
  if (!cursor || cursor.parent.type !== state.schema.nodes.heading || cursor.parent.content.size > 0) return false;
  if (dispatch) dispatch(state.tr.setBlockType(cursor.before(), cursor.after(), state.schema.nodes.paragraph).scrollIntoView());
  return true;
}

function exitCodeOnEmptyLine(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  const cursor = state.selection.$cursor;
  if (!cursor || cursor.parent.type !== state.schema.nodes.code_block || cursor.parentOffset !== cursor.parent.content.size) return false;
  if (!cursor.parent.textContent.endsWith('\n')) return false;
  return exitCode(state, dispatch);
}

function tabThroughTable(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  const rect = selectedRect(state);
  if (!dispatch) return true;
  const rowPosition = rect.tableStart + Array.from({ length: rect.bottom }, (_, index) => rect.table.child(index).nodeSize).reduce((sum, size) => sum + size, 0);
  addRowAfter(state, transaction => {
    const cell = transaction.doc.resolve(rowPosition + 1);
    dispatch(transaction.setSelection(TextSelection.near(cell)).scrollIntoView());
  });
  return true;
}

function createLiveInputRules(schema: typeof markdownParser['schema']) {
  const heading = schema.nodes.heading;
  const codeBlock = schema.nodes.code_block;
  const blockquote = schema.nodes.blockquote;
  const bulletList = schema.nodes.bullet_list;
  const orderedList = schema.nodes.ordered_list;
  const strong = schema.marks.strong;
  const em = schema.marks.em;
  const code = schema.marks.code;
  const link = schema.marks.link;
  const strike = schema.marks.strike;
  const highlight = schema.marks.highlight;
  return [
    textblockTypeInputRule(/^(#{1,6})\s$/, heading, match => ({ level: match[1].length })),
    textblockTypeInputRule(/^```([A-Za-z0-9_-]+)?\s?$/, codeBlock, match => ({ params: match[1] || null })),
    wrappingInputRule(/^\s*>\s$/, blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, bulletList),
    wrappingInputRule(/^\s*(\d+)\.\s$/, orderedList, match => ({ order: Number(match[1]) })),
    markInputRule(/(^|[^\w])(\*\*)(?=\S)([^*_]+?\S)\2$/, strong),
    markInputRule(/(^|[^\w])(__)(?=\S)([^*_]+?\S)\2$/, strong),
    markInputRule(/(^|[^\w])(\*)(?=\S)([^*_]+?\S)\2$/, em),
    markInputRule(/(^|[^\w])(_)(?=\S)([^*_]+?\S)\2$/, em),
    markInputRule(/(^|[^\w])(`)(?=\S)([^`]+?\S)\2$/, code),
    linkInputRule(link),
    markInputRule(/(^|[^\w])(~~)(?=\S)([^~]+?\S)\2$/, strike),
    markInputRule(/(^|[^\w])(==)(?=\S)([^=]+?\S)\2$/, highlight),
  ];
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

export const ProseMirrorEditor = forwardRef<LiveEditorHandle, Props>(function ProseMirrorEditor({ source, documentPath, citationMap = {}, searchQuery = '', linkPrompt = 'Link URL', onChange, onImageFiles }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const sourceRef = useRef(source);
  const changeRef = useRef(onChange);
  const citationMapRef = useRef(citationMap);
  const searchQueryRef = useRef(searchQuery);
  const onImageFilesRef = useRef(onImageFiles);
  const linkPromptRef = useRef(linkPrompt);
  const projectionRef = useRef({ source: '', documentPath: null as string | null, mappings: new Map<string, string>() });
  changeRef.current = onChange;
  citationMapRef.current = citationMap;
  searchQueryRef.current = searchQuery;
  onImageFilesRef.current = onImageFiles;
  linkPromptRef.current = linkPrompt;

  useImperativeHandle(ref, () => ({
    focus() { view.current?.focus(); },
    insertMarkdown(markdown) {
      const editor = view.current;
      if (!editor || !markdown) return;
      const parsed = markdownParser.parse(markdown);
      editor.dispatch(editor.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView());
      editor.focus();
    },
  }), []);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView(host.current, {
      state: EditorState.create({
        doc: markdownParser.parse(source),
        plugins: [
          history(),
          inputRules({ rules: createLiveInputRules(markdownParser.schema) }),
          tableEditing(),
          keymap({
            ...baseKeymap,
            Enter: chainCommands(exitCodeOnEmptyLine, newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
            Backspace: chainCommands(undoInputRule, deleteEmptyHeading, baseKeymap.Backspace),
            Tab: tabThroughTable,
            'Shift-Tab': goToNextCell(-1),
            'Mod-b': toggleMark(markdownParser.schema.marks.strong),
            'Mod-i': toggleMark(markdownParser.schema.marks.em),
            'Mod-Shift-x': toggleMark(markdownParser.schema.marks.strike),
            'Mod-k': (state, dispatch) => editLink(state, dispatch, linkPromptRef.current),
            'Mod-z': undo,
            'Mod-y': redo,
            'Mod-Shift-z': redo,
          }),
          new Plugin({ props: { decorations: state => {
          const citations = citationDecorations(state, citationMapRef.current).find();
          const math = mathDecorations(state).find();
          const matches = searchDecorations(state, searchQueryRef.current).find();
          const tasks = taskDecorations(state, (from, checked) => {
            const currentEditor = view.current;
            if (!currentEditor) return;
            currentEditor.dispatch(currentEditor.state.tr.insertText(checked ? '[x] ' : '[ ] ', from, from + 4));
          }).find();
          return DecorationSet.create(state.doc, [...citations, ...math, ...matches, ...tasks]);
          } } }),
        ],
      }),
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
        if (files.length && onImageFilesRef.current) {
          event.preventDefault();
          onImageFilesRef.current(files);
          return true;
        }
        const clipboard = event.clipboardData;
        if (!clipboard || clipboard.types.includes('text/html')) return false;
        const text = clipboard.getData('text/plain');
        if (!text) return false;
        const parsed = markdownParser.parse(text);
        event.preventDefault();
        view.dispatch(view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView());
        view.focus();
        return true;
      },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
        if (!files.length || !onImageFilesRef.current) return false;
        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (position !== undefined) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
        onImageFilesRef.current(files, position);
        return true;
      },
      handleDOMEvents: {
        dragover(_view, event) {
          if (!event.dataTransfer?.types.includes('Files')) return false;
          event.preventDefault();
          return true;
        },
      },
      dispatchTransaction(transaction) {
        const next = editor.state.apply(transaction);
        editor.updateState(next);
        if (transaction.docChanged && !transaction.getMeta('markitProjection')) {
          const serialized = restoreImages(serializeMarkdownLike(next.doc, sourceRef.current), projectionRef.current.mappings);
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
    if (editor) editor.dispatch(editor.state.tr.setMeta('markitSearchQuery', true));
  }, [searchQuery]);

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
});
