import MarkdownIt from 'markdown-it';
import type { StateBlock } from 'markdown-it';
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import { addListNodes } from 'prosemirror-schema-list';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { tableNodes } from 'prosemirror-tables';
import type { Attrs, Node as ProseMirrorNode, NodeType } from 'prosemirror-model';
import { Schema } from 'prosemirror-model';

type MarkdownToken = { attrGet(name: string): string | null };
type MarkdownParseState = { openNode(type: NodeType, attrs: Attrs | null): void; closeNode(): ProseMirrorNode | null };
type MarkdownParserHandler = (state: MarkdownParseState, token?: MarkdownToken) => void;

/**
 * Markdown remains the durable document format. This schema is the semantic
 * projection used by the live editor; unknown Markdown is kept in the source
 * editor until a dedicated lossless node is added for that syntax.
 */
const tableSchema = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+',
  cellAttributes: { align: { default: null } },
});

const rawFenceLanguages = new Set(['html', 'math', 'mermaid', 'plantuml', 'diagram', 'mdx']);

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line], state.eMarks[line]);
}

function rawBlockToken(state: StateBlock, startLine: number, endLine: number): boolean {
  const token = state.push('markit_raw_block', 'pre', 0);
  token.block = true;
  token.map = [startLine, endLine];
  token.content = state.getLines(startLine, endLine, 0, true);
  state.line = endLine;
  return true;
}

function rawFrontMatterRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (startLine !== 0 || state.level !== 0 || !/^ {0,3}---\s*$/.test(lineText(state, startLine))) return false;
  let closingLine = startLine + 1;
  while (closingLine < endLine && !/^ {0,3}(?:---|\.\.\.)\s*$/.test(lineText(state, closingLine))) closingLine += 1;
  if (closingLine >= endLine) return false;
  if (silent) return true;
  return rawBlockToken(state, startLine, closingLine + 1);
}

function rawCommentRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.level !== 0 || !/^ {0,3}<!--/.test(lineText(state, startLine))) return false;
  let closingLine = startLine;
  while (closingLine < endLine && !lineText(state, closingLine).includes('-->')) closingLine += 1;
  if (closingLine >= endLine) return false;
  if (silent) return true;
  return rawBlockToken(state, startLine, closingLine + 1);
}

function rawFenceRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.level !== 0) return false;
  const opening = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(lineText(state, startLine));
  const language = opening?.[2]?.toLowerCase();
  if (!opening || !language || !rawFenceLanguages.has(language)) return false;
  const fence = opening[1][0];
  const minimum = opening[1].length;
  let closingLine = startLine + 1;
  while (closingLine < endLine) {
    const closing = new RegExp(`^ {0,3}${fence}{${minimum},}\\s*$`);
    if (closing.test(lineText(state, closingLine))) break;
    closingLine += 1;
  }
  if (silent) return true;
  return rawBlockToken(state, startLine, Math.min(closingLine + 1, endLine));
}

export const markitSchema = new Schema({
  nodes: addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block').append(tableSchema).addToEnd('raw_markdown', {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { source: { default: '' } },
    toDOM: node => ['pre', { class: 'md-raw-block', contenteditable: 'false' }, node.attrs.source],
  }),
  marks: basicSchema.spec.marks.addToEnd('strike', {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  }).addToEnd('highlight', {
    parseDOM: [{ tag: 'mark' }, { style: 'background-color' }],
    toDOM: () => ['mark', 0],
  }),
});

const markdownTokenizer = new MarkdownIt({ html: false, linkify: true, breaks: false });
markdownTokenizer.block.ruler.before('hr', 'markit_front_matter', rawFrontMatterRule);
markdownTokenizer.block.ruler.before('html_block', 'markit_comment', rawCommentRule);
markdownTokenizer.block.ruler.before('fence', 'markit_raw_fence', rawFenceRule);
markdownTokenizer.inline.ruler.before('emphasis', 'markit_highlight', (state, silent) => {
  const match = /^==(?=\S)([^=]+?\S)==/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const open = state.push('markit_highlight_open', 'mark', 1);
    open.markup = '==';
    const text = state.push('text', '', 0);
    text.content = match[1];
    const close = state.push('markit_highlight_close', 'mark', -1);
    close.markup = '==';
  }
  state.pos += match[0].length;
  return true;
});
const markdownTokens = {
  ...defaultMarkdownParser.tokens,
  s: { mark: 'strike' },
  markit_highlight: { mark: 'highlight' },
  table: { block: 'table' },
  markit_raw_block: { node: 'raw_markdown', getAttrs: (token: MarkdownToken & { content?: string }) => ({ source: token.content || '' }) },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: (token: MarkdownToken) => ({ align: token.attrGet('style')?.match(/text-align:\s*(left|center|right)/)?.[1] || null }) },
  td: { block: 'table_cell', getAttrs: (token: MarkdownToken) => ({ align: token.attrGet('style')?.match(/text-align:\s*(left|center|right)/)?.[1] || null }) },
};

const markdownMarks = {
  ...defaultMarkdownSerializer.marks,
  strike: { open: '~~', close: '~~', mixable: true },
  highlight: { open: '==', close: '==', mixable: true },
};

function escapeTableText(value: string): string {
  return value.replace(/[\\`*_[\]~]/g, character => `\\${character}`);
}

function serializeTableInline(node: ProseMirrorNode): string {
  let output = '';
  node.forEach(child => {
    if (child.isText) {
      let value = child.marks.some(mark => mark.type.name === 'code') ? child.text || '' : escapeTableText(child.text || '');
      for (const mark of [...child.marks].reverse()) {
        if (mark.type.name === 'code') value = `\`${value}\``;
        else if (mark.type.name === 'strong') value = `**${value}**`;
        else if (mark.type.name === 'em') value = `*${value}*`;
        else if (mark.type.name === 'strike') value = `~~${value}~~`;
        else if (mark.type.name === 'highlight') value = `==${value}==`;
        else if (mark.type.name === 'link') value = `[${value}](${String(mark.attrs.href).replace(/[()\\"]/g, '\\$&')})`;
      }
      output += value;
    } else if (child.type.name === 'hard_break') {
      output += '<br>';
    }
  });
  return output;
}

function serializeTableCell(cell: ProseMirrorNode): string {
  return serializeTableInline(cell.firstChild || cell).replace(/\|/g, '\\|');
}

function tableAlignment(cell: ProseMirrorNode): string {
  if (cell.attrs.align === 'left') return ':---';
  if (cell.attrs.align === 'right') return '---:';
  if (cell.attrs.align === 'center') return ':---:';
  return '---';
}

export const markdownParser = new MarkdownParser(
  markitSchema,
  markdownTokenizer,
  markdownTokens,
);

const openTableCell = (state: MarkdownParseState, token: MarkdownToken, type: NodeType) => {
  const align = token.attrGet('style')?.match(/text-align:\s*(left|center|right)/)?.[1] || null;
  state.openNode(type, { align });
  state.openNode(markitSchema.nodes.paragraph, null);
};
const parserHandlers = (markdownParser as unknown as { tokenHandlers: Record<string, MarkdownParserHandler> }).tokenHandlers;
parserHandlers.th_open = (state, token) => openTableCell(state, token!, markitSchema.nodes.table_header);
parserHandlers.th_close = state => { state.closeNode(); state.closeNode(); };
parserHandlers.td_open = (state, token) => openTableCell(state, token!, markitSchema.nodes.table_cell);
parserHandlers.td_close = state => { state.closeNode(); state.closeNode(); };

export const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    raw_markdown(state, node) {
      state.write(node.attrs.source);
      state.closeBlock(node);
    },
    table(state, node) {
      const rows: string[] = [];
      node.forEach((row, _offset, rowIndex) => {
        const cells: string[] = [];
        row.forEach(cell => cells.push(serializeTableCell(cell)));
        rows.push(`| ${cells.join(' | ')} |`);
        if (rowIndex === 0) rows.push(`| ${row.content.content.map(cell => tableAlignment(cell)).join(' | ')} |`);
      });
      state.write(rows.join('\n'));
      state.closeBlock(node);
    },
  },
  markdownMarks,
);

export interface MarkdownProjection {
  source: string;
  document: ProseMirrorNode;
}

export function parseMarkdown(source: string): MarkdownProjection {
  return { source, document: markdownParser.parse(source) };
}

export function serializeMarkdown(document: ProseMirrorNode): string {
  return markdownSerializer.serialize(document);
}

export function isLosslessCandidate(source: string): boolean {
  return !/^\s*(---|\.\.\.)\s*$/m.test(source)
    && !/^```(?:mermaid|math|html)\b/m.test(source)
    && !/^<!--/m.test(source);
}
