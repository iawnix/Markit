import { syntaxTree } from '@codemirror/language';
import { EditorState, StateEffect, type Range, type StateCommand } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { SyntaxNodeRef } from '@lezer/common';
import 'katex/dist/katex.min.css';
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView } from '@codemirror/view';
import { message } from './i18n';

const markerNames = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'HeaderMark', 'QuoteMark', 'LinkMark']);
const inlineMarkerNames = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark']);
const inlineSyntaxNames = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Link']);
const inlineMathPattern = /(?<!\\)(?<!\$)\$([^\n$]+?)\$(?!\$)/g;
export const refreshLivePreview = StateEffect.define<void>();

function tableCellsInLine(state: EditorState, from: number): TableCellRange[] {
  const line = state.doc.lineAt(from);
  const pipes: number[] = [];
  for (let index = 0; index < line.text.length; index += 1) {
    if (line.text[index] !== '|') continue;
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && line.text[cursor] === '\\'; cursor -= 1) slashes += 1;
    if (slashes % 2 === 0) pipes.push(index);
  }
  const firstContent = line.text.search(/\S/);
  const lastContent = line.text.trimEnd().length - 1;
  const leadingPipe = firstContent >= 0 && line.text[firstContent] === '|';
  const trailingPipe = lastContent >= 0 && line.text[lastContent] === '|';
  const start = leadingPipe ? firstContent + 1 : 0;
  const end = trailingPipe ? lastContent : line.text.length;
  const separators = pipes.filter(position => position >= start && position < end);
  const ranges: TableCellRange[] = [];
  const addCell = (cellStart: number, cellEnd: number) => {
    let trimmedFrom = cellStart;
    let trimmedTo = cellEnd;
    while (trimmedFrom < trimmedTo && /\s/.test(line.text[trimmedFrom])) trimmedFrom += 1;
    while (trimmedTo > trimmedFrom && /\s/.test(line.text[trimmedTo - 1])) trimmedTo -= 1;
    ranges.push(trimmedFrom === trimmedTo
      ? { from: line.from + cellStart, to: line.from + cellEnd }
      : { from: line.from + trimmedFrom, to: line.from + trimmedTo });
  };
  let cellStart = start;
  for (const separator of separators) {
    addCell(cellStart, separator);
    cellStart = separator + 1;
  }
  addCell(cellStart, end);
  return ranges;
}

export function moveToTableCell(backward = false): StateCommand {
  return ({ state, dispatch }) => {
    const position = state.selection.main.head;
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1);
    while (node && node.name !== 'Table') node = node.parent;
    if (!node) return false;

    const cells: TableCellRange[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'TableHeader' || child.name === 'TableRow') cells.push(...tableCellsInLine(state, child.from));
    }
    if (!cells.length) return false;
    const current = cells.reduce((best, cell, index) => {
      const distance = position < cell.from ? cell.from - position : position > cell.to ? position - cell.to : 0;
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
    const next = current + (backward ? -1 : 1);
    if (next >= 0 && next < cells.length) {
      const target = backward ? cells[next].to : cells[next].from;
      dispatch(state.update({ selection: { anchor: target }, scrollIntoView: true }));
      return true;
    }
    if (backward) return true;

    const columns = cells.filter(cell => state.doc.lineAt(cell.from).from === state.doc.lineAt(cells[0].from).from).length;
    if (!columns) return false;
    const row = `\n|${'  |'.repeat(columns)}`;
    const insertAt = node.to;
    const firstCell = insertAt + 3;
    dispatch(state.update({ changes: { from: insertAt, insert: row }, selection: { anchor: firstCell }, scrollIntoView: true }));
    return true;
  };
}

export type TableStructureAction = 'row-above' | 'row-below' | 'row-delete' | 'column-left' | 'column-right' | 'column-delete';

export function editTableStructure(action: TableStructureAction, rowIndex: number, columnIndex: number, tableFrom?: number): StateCommand {
  return ({ state, dispatch }) => {
    const position = state.selection.main.head;
    let table: SyntaxNode | null = syntaxTree(state).resolveInner(tableFrom === undefined ? position : Math.min(tableFrom + 1, state.doc.length), -1);
    while (table && table.name !== 'Table') table = table.parent;
    if (!table) return false;

    const tableStart = state.doc.lineAt(table.from).from;
    const tableEnd = state.doc.lineAt(Math.max(table.from, table.to - 1)).to;
    const lines = state.doc.sliceString(tableStart, tableEnd).split('\n');
    const baseLine = state.doc.lineAt(tableStart).number;
    const rows: Array<{ line: number; cells: TableCellRange[] }> = [];
    let delimiterLine = -1;
    for (let child = table.firstChild; child; child = child.nextSibling) {
      if (child.name === 'TableDelimiter') delimiterLine = state.doc.lineAt(child.from).number - baseLine;
      if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue;
      const cells = tableCellsInLine(state, child.from);
      rows.push({ line: state.doc.lineAt(child.from).number - baseLine, cells });
    }
    if (!rows.length || delimiterLine < 0 || rowIndex < 0 || rowIndex >= rows.length) return false;
    const columnCount = rows[0].cells.length;
    if (!columnCount || columnIndex < 0 || columnIndex >= columnCount) return false;

    const formatRow = (template: string, cells: string[]) => {
      const indent = /^\s*/.exec(template)?.[0] || '';
      const content = template.slice(indent.length);
      const leadingPipe = content.startsWith('|');
      const trailingPipe = /\|\s*$/.test(content);
      return `${indent}${leadingPipe ? '| ' : ''}${cells.join(' | ')}${trailingPipe ? ' |' : ''}`;
    };
    const cellsForRow = (row: typeof rows[number]) => Array.from({ length: columnCount }, (_, index) => {
      const range = row.cells[index];
      return range ? state.doc.sliceString(range.from, range.to).trim() : '';
    });
    const markerLine = lines[delimiterLine];
    const markerIndent = /^\s*/.exec(markerLine)?.[0] || '';
    const markerContent = markerLine.slice(markerIndent.length).trimEnd();
    const leadingMarkerPipe = markerContent.startsWith('|');
    const trailingMarkerPipe = /\|\s*$/.test(markerContent);
    let markers = markerContent.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(marker => marker.trim());
    while (markers.length < columnCount) markers.push('---');

    let targetRow = rowIndex;
    let targetColumn = columnIndex;
    let targetLine = -1;
    let targetCells: string[] = [];

    if (action === 'row-above' || action === 'row-below') {
      if (rowIndex === 0 && action === 'row-above') return false;
      const selectedLine = rows[rowIndex].line;
      const insertAt = rowIndex === 0 ? delimiterLine + 1 : selectedLine + (action === 'row-below' ? 1 : 0);
      targetRow = rowIndex === 0 ? 1 : rowIndex + (action === 'row-below' ? 1 : 0);
      targetLine = insertAt;
      targetCells = Array.from({ length: columnCount }, () => '');
      lines.splice(insertAt, 0, formatRow(lines[selectedLine], targetCells));
    } else if (action === 'row-delete') {
      if (rowIndex === 0) {
        if (rows.length <= 1) return false;
        const promoted = rows[1];
        lines[rows[0].line] = lines[promoted.line];
        lines.splice(promoted.line, 1);
        targetRow = 0;
        targetLine = rows[0].line;
      } else {
        const removeLine = rows[rowIndex].line;
        lines.splice(removeLine, 1);
        targetRow = Math.min(rowIndex - 1, rows.length - 2);
        targetLine = rows[targetRow].line;
        if (removeLine < rows[targetRow].line) targetLine -= 1;
      }
      targetCells = Array.from({ length: columnCount }, (_, index) => {
        const sourceRow = rows[rowIndex === 0 ? 1 : targetRow];
        return sourceRow?.cells[index] ? state.doc.sliceString(sourceRow.cells[index].from, sourceRow.cells[index].to).trim() : '';
      });
    } else if (action === 'column-left' || action === 'column-right') {
      targetColumn = columnIndex + (action === 'column-right' ? 1 : 0);
      for (const row of rows) {
        const cells = cellsForRow(row);
        cells.splice(targetColumn, 0, row === rows[0] ? `Column ${targetColumn + 1}` : '');
        lines[row.line] = formatRow(lines[row.line], cells);
      }
      markers.splice(targetColumn, 0, '---');
      lines[delimiterLine] = `${markerIndent}${leadingMarkerPipe ? '| ' : ''}${markers.join(' | ')}${trailingMarkerPipe ? ' |' : ''}`;
      targetLine = rows[rowIndex].line;
      targetCells = cellsForRow(rows[rowIndex]);
      targetCells.splice(targetColumn, 0, rowIndex === 0 ? `Column ${targetColumn + 1}` : '');
    } else {
      if (columnCount <= 1) return false;
      targetColumn = Math.min(columnIndex, columnCount - 2);
      for (const row of rows) {
        const cells = cellsForRow(row);
        cells.splice(columnIndex, 1);
        lines[row.line] = formatRow(lines[row.line], cells);
      }
      markers.splice(columnIndex, 1);
      lines[delimiterLine] = `${markerIndent}${leadingMarkerPipe ? '| ' : ''}${markers.join(' | ')}${trailingMarkerPipe ? ' |' : ''}`;
      targetLine = rows[rowIndex].line;
      targetCells = cellsForRow(rows[rowIndex]);
      targetCells.splice(columnIndex, 1);
    }

    const targetText = lines[targetLine];
    if (targetText === undefined) return false;
    const targetIndent = /^\s*/.exec(targetText)?.[0] || '';
    const hasLeadingPipe = targetText.slice(targetIndent.length).startsWith('|');
    let cellOffset = targetIndent.length + (hasLeadingPipe ? 2 : 0);
    for (let index = 0; index < targetColumn; index += 1) cellOffset += (targetCells[index]?.length || 0) + 3;
    const precedingLength = lines.slice(0, targetLine).reduce((length, line) => length + line.length + 1, 0);
    const selection = tableStart + precedingLength + cellOffset;
    dispatch(state.update({
      changes: { from: tableStart, to: tableEnd, insert: lines.join('\n') },
      selection: { anchor: selection },
      scrollIntoView: true,
    }));
    return true;
  };
}

export function pasteTableCells(text: string): StateCommand {
  return ({ state, dispatch }) => {
    const inputRows = text.replace(/\r\n?/g, '\n').split('\n');
    if (inputRows.at(-1) === '') inputRows.pop();
    const input = inputRows.map(row => row.split('\t'));
    if (!input.length || !input.some(row => row.length > 1) && input.length < 2) return false;

    const position = state.selection.main.head;
    let table: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1);
    while (table && table.name !== 'Table') table = table.parent;
    if (!table) return false;

    const rows: Array<{ from: number; to: number; cells: TableCellRange[] }> = [];
    let header: { from: number; to: number; cells: TableCellRange[] } | undefined;
    let delimiter: { from: number; to: number } | undefined;
    for (let child = table.firstChild; child; child = child.nextSibling) {
      if (child.name === 'TableDelimiter') delimiter = { from: child.from, to: child.to };
      if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue;
      const row = { from: child.from, to: child.to, cells: tableCellsInLine(state, child.from) };
      if (child.name === 'TableHeader') header = row;
      else rows.push(row);
    }
    if (!header?.cells.length) return false;

    const allRows = [header, ...rows];
    let startRow = -1;
    let startColumn = -1;
    for (let rowIndex = 0; rowIndex < allRows.length; rowIndex += 1) {
      const cellIndex = allRows[rowIndex].cells.findIndex(cell => position >= cell.from && position <= cell.to);
      if (cellIndex >= 0) { startRow = rowIndex; startColumn = cellIndex; break; }
    }
    if (startRow < 0 || startColumn < 0) return false;
    const columnCount = header.cells.length;
    const targetColumnCount = Math.max(columnCount, ...input.map(row => startColumn + row.length));
    const expandsColumns = targetColumnCount > columnCount;

    const replacements: Array<{ from: number; to: number; insert: string }> = [];
    const appendedRows = new Map<number, string[]>();
    const pastedCells = new Map<string, string>();
    let cursor: { kind: 'existing'; from: number; insert: string } | { kind: 'appended'; row: number; column: number; insert: string } | { kind: 'rebuilt'; row: number; column: number; insert: string } | undefined;
    for (let rowOffset = 0; rowOffset < input.length; rowOffset += 1) {
      const targetRowIndex = startRow + rowOffset;
      const target = allRows[targetRowIndex];
      for (let columnOffset = 0; columnOffset < input[rowOffset].length; columnOffset += 1) {
        const raw = input[rowOffset][columnOffset];
        const value = raw.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
        const column = startColumn + columnOffset;
        if (target) {
          const cell = target.cells[column];
          const cellIsBlank = cell !== undefined && !state.doc.sliceString(cell.from, cell.to).trim();
          const inserted = cellIsBlank && !expandsColumns ? ` ${value} ` : value;
          pastedCells.set(`${targetRowIndex}:${column}`, inserted);
          cursor = cell && !expandsColumns
            ? { kind: 'existing', from: cell.from, insert: inserted }
            : { kind: 'rebuilt', row: targetRowIndex, column, insert: value };
        } else {
          const newRowIndex = targetRowIndex - allRows.length;
          const cells = appendedRows.get(newRowIndex) || Array.from({ length: targetColumnCount }, () => '');
          cells[column] = value;
          appendedRows.set(newRowIndex, cells);
          cursor = { kind: 'appended', row: newRowIndex, column, insert: value };
        }
      }
    }

    const rowsToRebuild = new Set<number>();
    if (expandsColumns) allRows.forEach((_, index) => rowsToRebuild.add(index));
    for (const key of pastedCells.keys()) {
      const [rowIndexText, columnText] = key.split(':');
      const rowIndex = Number(rowIndexText);
      const column = Number(columnText);
      if (column >= allRows[rowIndex].cells.length) rowsToRebuild.add(rowIndex);
    }
    const rebuiltRows = new Map<number, { from: number; offsets: number[] }>();
    const rebuildRow = (rowIndex: number, row: { from: number; to: number; cells: TableCellRange[] }) => {
      const line = state.doc.lineAt(row.from);
      const indent = /^\s*/.exec(line.text)?.[0] || '';
      const content = line.text.slice(indent.length);
      const leadingPipe = content.startsWith('|');
      const trailingPipe = /\|\s*$/.test(content);
      const cells = Array.from({ length: targetColumnCount }, (_, column) => {
        const pasted = pastedCells.get(`${rowIndex}:${column}`);
        if (pasted !== undefined) return pasted;
        if (row.cells[column]) return state.doc.sliceString(row.cells[column].from, row.cells[column].to).trim();
        return rowIndex === 0 && expandsColumns && column >= columnCount ? `Column ${column + 1}` : '';
      });
      const offsets: number[] = [];
      let cellOffset = indent.length + (leadingPipe ? 2 : 0);
      for (const cell of cells) {
        offsets.push(cellOffset);
        cellOffset += cell.length + 3;
      }
      const rebuilt = `${indent}${leadingPipe ? '| ' : ''}${cells.join(' | ')}${trailingPipe ? ' |' : ''}`;
      replacements.push({ from: line.from, to: line.to, insert: rebuilt });
      rebuiltRows.set(rowIndex, { from: line.from, offsets });
    };

    for (let rowIndex = 0; rowIndex < allRows.length; rowIndex += 1) {
      if (rowsToRebuild.has(rowIndex)) rebuildRow(rowIndex, allRows[rowIndex]);
    }
    if (expandsColumns && delimiter) {
      const line = state.doc.lineAt(delimiter.from);
      const indent = /^\s*/.exec(line.text)?.[0] || '';
      const content = line.text.slice(indent.length).trimEnd();
      const leadingPipe = content.startsWith('|');
      const trailingPipe = /\|\s*$/.test(content);
      const markers = content.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(marker => marker.trim());
      while (markers.length < targetColumnCount) markers.push('---');
      replacements.push({
        from: line.from,
        to: line.to,
        insert: `${indent}${leadingPipe ? '| ' : ''}${markers.join(' | ')}${trailingPipe ? ' |' : ''}`,
      });
    }
    for (const [key, value] of pastedCells) {
      const [rowIndexText, columnText] = key.split(':');
      const rowIndex = Number(rowIndexText);
      const column = Number(columnText);
      if (rowsToRebuild.has(rowIndex)) continue;
      const cell = allRows[rowIndex].cells[column];
      if (cell) replacements.push({ from: cell.from, to: cell.to, insert: value });
    }

    let appended = '';
    let appendCursorOffset = -1;
    for (const [rowIndex, cells] of [...appendedRows].sort(([left], [right]) => left - right)) {
      const line = `| ${cells.join(' | ')} |`;
      const lineStart = appended.length + (appended ? 1 : 0);
      if (cursor?.kind === 'appended' && rowIndex === cursor.row)
        appendCursorOffset = lineStart + 2 + cells.slice(0, cursor.column).reduce((length, cell) => length + cell.length + 3, 0);
      if (appended) appended += '\n';
      appended += line;
    }
    if (appended) replacements.push({ from: table.to, to: table.to, insert: `\n${appended}` });
    if (!replacements.length) return false;
    replacements.sort((left, right) => left.from - right.from || left.to - right.to);
    const changes = replacements.map(({ from, to, insert }) => ({ from, to, insert }));
    const existingDelta = replacements
      .filter(replacement => replacement.from < table.to)
      .reduce((delta, replacement) => delta + replacement.insert.length - (replacement.to - replacement.from), 0);
    const selection = cursor?.kind === 'appended' && appendCursorOffset >= 0
      ? table.to + existingDelta + 1 + appendCursorOffset + cursor.insert.length
      : cursor?.kind === 'rebuilt'
        ? (() => {
          const rebuilt = rebuiltRows.get(cursor.row);
          if (!rebuilt) return state.selection.main.head;
          const precedingDelta = replacements
            .filter(replacement => replacement.from < rebuilt.from)
            .reduce((delta, replacement) => delta + replacement.insert.length - (replacement.to - replacement.from), 0);
          return rebuilt.from + precedingDelta + rebuilt.offsets[cursor.column] + cursor.insert.length;
        })()
      : cursor?.kind === 'existing'
        ? cursor.from + replacements
          .filter(replacement => replacement.from < cursor.from)
          .reduce((delta, replacement) => delta + replacement.insert.length - (replacement.to - replacement.from), 0)
          + cursor.insert.length
        : state.selection.main.head;
    dispatch(state.update({ changes, selection: { anchor: selection }, scrollIntoView: true }));
    return true;
  };
}

export function externalLinkAt(state: EditorState, position: number): string | undefined {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1);
  while (node && node.name !== 'Link') node = node.parent;
  if (!node) return undefined;
  let destination: string | undefined;
  for (let child = node.node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'URL') destination = state.doc.sliceString(child.from, child.to);
  }
  if (!destination || /[\s<>\\]/.test(destination)) return undefined;
  const decoded = destination.replace(/\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g, '$1');
  try {
    const url = new URL(decoded);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly source: string, readonly display: boolean) { super(); }

  eq(other: MathWidget) { return other.source === this.source && other.display === this.display; }

  toDOM() {
    const element = document.createElement(this.display ? 'div' : 'span');
    element.className = this.display ? 'cm-live-math-display' : 'cm-live-math-inline';
    element.title = this.display ? `$$${this.source}$$` : `$${this.source}$`;
    element.setAttribute('aria-label', element.title);
    element.contentEditable = 'false';
    const source = this.source;
    const display = this.display;
    void import('katex').then(({ default: katex }) => {
      if (!element.isConnected) return;
      try {
        element.innerHTML = katex.renderToString(source, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml', maxExpand: 1000, maxSize: 20 });
      } catch {
        element.textContent = element.title;
      }
    });
    return element;
  }

  ignoreEvent() { return false; }
}

class TaskWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly checked: boolean) { super(); }

  eq(other: TaskWidget) { return other.from === this.from && other.to === this.to && other.checked === this.checked; }

  toDOM(view: EditorView) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cm-live-task-checkbox';
    checkbox.checked = this.checked;
    checkbox.setAttribute('aria-label', this.checked ? 'Completed task' : 'Incomplete task');
    checkbox.addEventListener('mousedown', event => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      const marker = view.state.doc.sliceString(this.from, this.to);
      if (/^\[[ xX]\]$/.test(marker)) view.dispatch({ changes: { from: this.from, to: this.to, insert: checkbox.checked ? '[x]' : '[ ]' } });
    });
    return checkbox;
  }

  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  constructor(readonly source: string, readonly alt: string) { super(); }

  eq(other: ImageWidget) { return other.source === this.source && other.alt === this.alt; }

  toDOM() {
    const image = document.createElement('img');
    image.className = 'cm-live-image';
    image.src = this.source;
    image.alt = this.alt;
    image.loading = 'lazy';
    return image;
  }

  ignoreEvent() { return false; }
}

interface TableCellRange { from: number; to: number }

interface TablePreviewModel {
  from: number;
  source: string;
  header: TableCellRange[];
  rows: TableCellRange[][];
  alignments: Array<'left' | 'center' | 'right'>;
}

let activeTableMenu: HTMLElement | null = null;
let dismissTableMenu: (() => void) | null = null;

function closeTableMenu() {
  activeTableMenu?.remove();
  activeTableMenu = null;
  dismissTableMenu?.();
  dismissTableMenu = null;
}

function showTableMenu(view: EditorView, x: number, y: number, row: number, column: number, columnCount: number, rowCount: number, tableFrom: number) {
  closeTableMenu();
  const locale = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en';
  const menu = document.createElement('div');
  menu.className = 'cm-live-table-menu';
  menu.setAttribute('role', 'menu');

  const actions: Array<{ action: TableStructureAction; label: Parameters<typeof message>[1]; disabled?: boolean; separator?: boolean }> = [
    { action: 'row-above', label: 'tableInsertRowAbove', disabled: row === 0 },
    { action: 'row-below', label: 'tableInsertRowBelow' },
    { action: 'row-delete', label: 'tableDeleteRow', disabled: row === 0 && rowCount < 2 },
    { action: 'column-left', label: 'tableInsertColumnLeft', separator: true },
    { action: 'column-right', label: 'tableInsertColumnRight' },
    { action: 'column-delete', label: 'tableDeleteColumn', disabled: columnCount < 2 },
  ];
  for (const item of actions) {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'cm-live-table-menu-separator';
      separator.setAttribute('role', 'separator');
      menu.append(separator);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = message(locale, item.label);
    button.disabled = Boolean(item.disabled);
    button.addEventListener('click', () => {
      closeTableMenu();
      editTableStructure(item.action, row, column, tableFrom)({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
      view.focus();
    });
    menu.append(button);
  }

  menu.addEventListener('pointerdown', event => event.stopPropagation());
  menu.addEventListener('contextmenu', event => event.preventDefault());
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - bounds.width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - bounds.height - 6))}px`;
  activeTableMenu = menu;

  const onPointerDown = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node)) closeTableMenu();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); closeTableMenu(); view.focus(); }
  };
  dismissTableMenu = () => {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown);
  };
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown);
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}

function inlineElement(name: string): HTMLElement | null {
  if (name === 'StrongEmphasis') return document.createElement('strong');
  if (name === 'Emphasis') return document.createElement('em');
  if (name === 'Strikethrough') return document.createElement('s');
  if (name === 'InlineCode') return document.createElement('code');
  if (name === 'Link') return document.createElement('span');
  return null;
}

function appendInlineChildren(state: EditorState, node: SyntaxNode, parent: HTMLElement) {
  let position = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (position < child.from) parent.append(document.createTextNode(state.doc.sliceString(position, child.from)));
    if (markerNames.has(child.name) || child.name === 'URL' || child.name === 'LinkTitle') {
      position = child.to;
      continue;
    }
    appendInline(state, child, parent);
    position = child.to;
  }
  if (position < node.to) parent.append(document.createTextNode(state.doc.sliceString(position, node.to)));
}

function appendInline(state: EditorState, node: SyntaxNode, parent: HTMLElement) {
  if (markerNames.has(node.name) || node.name === 'URL' || node.name === 'LinkTitle') return;
  if (node.name === 'Escape') {
    parent.append(document.createTextNode(state.doc.sliceString(node.from, node.to).slice(-1)));
    return;
  }
  const element = inlineElement(node.name);
  if (element) {
    if (node.name === 'Link') element.classList.add('cm-live-link');
    if (node.name === 'InlineCode') {
      const marks: Array<{ from: number; to: number }> = [];
      for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === 'CodeMark') marks.push(child);
      const from = marks.length ? marks[0].to : node.from;
      const to = marks.length ? marks[marks.length - 1].from : node.to;
      element.textContent = state.doc.sliceString(from, to);
    } else appendInlineChildren(state, node, element);
    parent.append(element);
    return;
  }
  if (node.firstChild) appendInlineChildren(state, node, parent);
  else {
    parent.append(document.createTextNode(state.doc.sliceString(node.from, node.to)));
  }
}

function appendTableCell(state: EditorState, range: TableCellRange, cell: HTMLElement, alignment: string | undefined, view: EditorView, rowIndex: number, columnIndex: number) {
  cell.dataset.tableCellRow = String(rowIndex);
  cell.dataset.tableCellColumn = String(columnIndex);
  const inlineTree = syntaxTree(state).resolveInner(range.from, 1);
  for (let node: SyntaxNode | null = inlineTree.node; node; node = node.parent) {
    if (node.name === 'TableCell') {
      appendInlineChildren(state, node, cell);
      break;
    }
  }
  if (!cell.childNodes.length) cell.textContent = state.doc.sliceString(range.from, range.to);
  if (alignment) cell.style.textAlign = alignment;
  cell.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    view.dispatch({ selection: { anchor: range.from }, scrollIntoView: true });
    view.focus();
  });
}

class TableWidget extends WidgetType {
  constructor(readonly model: TablePreviewModel) { super(); }

  eq(other: TableWidget) {
    const cells = [this.model.header, ...this.model.rows].flat();
    const otherCells = [other.model.header, ...other.model.rows].flat();
    return other.model.from === this.model.from
      && other.model.source === this.model.source
      && otherCells.length === cells.length
      && otherCells.every((cell, index) => cell.from === cells[index].from && cell.to === cells[index].to)
      && other.model.alignments.join(',') === this.model.alignments.join(',');
  }

  toDOM(view: EditorView) {
    const table = document.createElement('table');
    table.className = 'cm-live-rendered-table';
    table.setAttribute('aria-label', 'Markdown table');
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    this.model.header.forEach((range, index) => {
      const cell = document.createElement('th');
      appendTableCell(view.state, range, cell, this.model.alignments[index], view, 0, index);
      header.append(cell);
    });
    head.append(header);
    table.append(head);
    const body = document.createElement('tbody');
    this.model.rows.forEach((row, rowIndex) => {
      const tableRow = document.createElement('tr');
      for (let index = 0; index < this.model.header.length; index += 1) {
        const range = row[index] || { from: row.at(-1)?.to ?? this.model.header[index].to, to: row.at(-1)?.to ?? this.model.header[index].to };
        const cell = document.createElement('td');
        appendTableCell(view.state, range, cell, this.model.alignments[index], view, rowIndex + 1, index);
        tableRow.append(cell);
      }
      body.append(tableRow);
    });
    table.append(body);
    table.addEventListener('contextmenu', event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-table-cell-row]') : null;
      if (!target) return;
      const row = Number(target.dataset.tableCellRow);
      const column = Number(target.dataset.tableCellColumn);
      if (![row, column].every(Number.isFinite)) return;
      event.preventDefault();
      event.stopPropagation();
      showTableMenu(view, event.clientX, event.clientY, row, column, this.model.header.length, this.model.rows.length + 1, this.model.from);
    });
    return table;
  }

  ignoreEvent() { return false; }
}

function tablePreviewModel(state: EditorState, node: SyntaxNode): TablePreviewModel | null {
  let header: TableCellRange[] = [];
  const rows: TableCellRange[][] = [];
  let alignments: Array<'left' | 'center' | 'right'> = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader' || child.name === 'TableRow') {
      const cells = tableCellsInLine(state, child.from);
      if (child.name === 'TableHeader') header = cells;
      else rows.push(cells);
    } else if (child.name === 'TableDelimiter') {
      const line = state.doc.lineAt(child.from).text;
      alignments = line.split('|').filter((value, index, values) => value.trim() || (index > 0 && index < values.length - 1))
        .map(value => {
          const marker = value.trim();
          return marker.startsWith(':') ? marker.endsWith(':') ? 'center' : 'left' : marker.endsWith(':') ? 'right' : 'left';
        });
    }
  }
  if (!header.length) return null;
  return { from: node.from, source: state.doc.sliceString(node.from, node.to), header, rows, alignments };
}

function lineRange(state: EditorState, from: number, to: number): [number, number] {
  const start = state.doc.lineAt(from).from;
  const end = state.doc.lineAt(Math.max(from, to - 1)).to;
  return [start, end];
}

export function buildLivePreviewDecorations(view: EditorView, imageUrls: Map<string, string>, documentPath: string | null): DecorationSet {
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  const { from: selectionFrom, to: selectionTo } = state.selection.main;
  const lineIsActive = (lineNumber: number) => {
    if (lineNumber === cursorLine) return true;
    const line = state.doc.line(lineNumber);
    return selectionFrom < line.to && selectionTo > line.from;
  };
  const rangeIsActive = (from: number, to: number) =>
    (state.selection.main.head >= from && state.selection.main.head <= to)
    || (selectionFrom < to && selectionTo > from);
  const inlineSyntaxIsActive = (node: SyntaxNodeRef) => {
    let parent = node.node.parent;
    while (parent) {
      if (inlineSyntaxNames.has(parent.name)) return rangeIsActive(parent.from, parent.to);
      parent = parent.parent;
    }
    return rangeIsActive(node.from, node.to);
  };
  const ranges: Range<Decoration>[] = [];
  const protectedRanges: Array<{ from: number; to: number }> = [];
  const addLine = (from: number, to: number, className: string) => {
    const [start, end] = lineRange(state, from, to);
    for (let line = state.doc.lineAt(start).number; line <= state.doc.lineAt(end).number; line += 1) {
      const position = state.doc.line(line).from;
      ranges.push(Decoration.line({ class: className }).range(position));
    }
  };
  const addLineAt = (position: number, className: string) => {
    const lineFrom = state.doc.lineAt(position).from;
    ranges.push(Decoration.line({ class: className }).range(lineFrom));
  };
  const addMark = (from: number, to: number, className: string) => {
    if (from < to) ranges.push(Decoration.mark({ class: className }).range(from, to));
  };
  const hide = (from: number, to: number) => {
    if (from < to) ranges.push(Decoration.replace({}).range(from, to));
  };

  const firstVisibleLine = state.doc.lineAt(view.viewport.from).number;
  const lastVisibleLine = state.doc.lineAt(view.viewport.to).number;
  const longStrikeLines = new Set<number>();
  for (let lineNumber = firstVisibleLine; lineNumber <= lastVisibleLine; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const match = /^(\s*)(~{3,})(?=\S)([^~]+?\S)\2\s*$/.exec(line.text);
    if (!match) continue;
    longStrikeLines.add(lineNumber);
    const from = line.from + match[1].length;
    const contentFrom = from + match[2].length;
    const contentTo = contentFrom + match[3].length;
    addMark(contentFrom, contentTo, 'cm-live-strikethrough');
    if (!rangeIsActive(from, contentTo + match[2].length)) {
      hide(from, contentFrom);
      hide(contentTo, contentTo + match[2].length);
    }
    addLine(from, line.to, 'cm-live-long-strike');
  }

  syntaxTree(state).iterate({
    from: view.viewport.from,
    to: view.viewport.to,
    enter(node) {
      const name = node.name;
      const lineNumber = state.doc.lineAt(node.from).number;
      if (longStrikeLines.has(lineNumber) && (name === 'FencedCode' || name === 'CodeMark' || name === 'CodeInfo' || name === 'CodeText')) return;
      if (name === 'Table' && !rangeIsActive(node.from, node.to)) {
        const model = tablePreviewModel(state, node.node);
        if (model) {
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'TableHeader') {
              ranges.push(Decoration.replace({ widget: new TableWidget(model) }).range(child.from, child.to));
            } else if (child.name === 'TableRow') {
              hide(child.from, child.to);
              addLine(child.from, child.to, 'cm-live-table-hidden-row');
            } else if (child.name === 'TableDelimiter') {
              const line = state.doc.lineAt(child.from);
              hide(line.from, line.to);
              ranges.push(Decoration.line({ class: 'cm-live-table-divider' }).range(line.from));
            }
          }
        }
        return false;
      }
      if (name === 'Image' && !rangeIsActive(node.from, node.to)) {
        const raw = state.doc.sliceString(node.from, node.to);
        const match = /^!\[([^\]]*)\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\)$/.exec(raw);
        const source = match?.[2] || match?.[3];
        if (source) {
          const decoded = (() => { try { return decodeURIComponent(source); } catch { return source; } })();
          const resolved = /^(?:https?:|data:|markit-asset:)/i.test(decoded) ? decoded : documentPath ? imageUrls.get(`${documentPath}\0${decoded}`) : undefined;
          if (resolved) ranges.push(Decoration.replace({ widget: new ImageWidget(resolved, match?.[1] || '') }).range(node.from, node.to));
        }
      }
      if (name === 'InlineCode' || name === 'FencedCode' || name === 'CodeBlock' || name === 'CodeText') {
        protectedRanges.push({ from: node.from, to: node.to });
      }
      if (/^ATXHeading[1-6]$/.test(name) || name === 'SetextHeading1' || name === 'SetextHeading2') {
        const level = /^ATXHeading([1-6])$/.exec(name)?.[1] || (name === 'SetextHeading1' ? '1' : '2');
        addLine(node.from, node.to, `cm-live-heading cm-live-heading-${level}`);
      } else if (name === 'Blockquote') addLine(node.from, node.to, 'cm-live-blockquote');
      else if (name === 'ListItem') {
        let marker = '';
        let task = false;
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === 'ListMark') marker = state.doc.sliceString(child.from, child.to);
          if (child.name === 'Task') task = true;
        }
        addLine(node.from, node.to, `cm-live-list-item ${/^\d/.test(marker) ? 'cm-live-ordered-item' : 'cm-live-unordered-item'}${task ? ' cm-live-task-item' : ''}`);
      }
      else if (name === 'FencedCode' || name === 'CodeBlock') {
        addLine(node.from, node.to, 'cm-live-code-block');
        addLineAt(node.from, 'cm-live-code-start');
        addLineAt(Math.max(node.from, node.to - 1), 'cm-live-code-end');
      }
      else if (name === 'TableHeader') addLine(node.from, node.to, 'cm-live-table-header');
      else if (name === 'TableRow') addLine(node.from, node.to, 'cm-live-table-row');

      const markClass = name === 'StrongEmphasis' ? 'cm-live-strong'
        : name === 'Emphasis' ? 'cm-live-emphasis'
          : name === 'Strikethrough' ? 'cm-live-strikethrough'
            : name === 'InlineCode' ? 'cm-live-inline-code' : null;
      if (markClass) {
        const markers: Array<{ from: number; to: number }> = [];
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (markerNames.has(child.name)) {
            markers.push({ from: child.from, to: child.to });
          }
        }
        if (markers.length) addMark(markers[0].to, markers[markers.length - 1].from, markClass);
      }
      if (name === 'Link') {
        const children: Array<{ name: string; from: number; to: number }> = [];
        for (let child = node.node.firstChild; child; child = child.nextSibling) children.push({ name: child.name, from: child.from, to: child.to });
        const open = children.find(child => child.name === 'LinkMark');
        const close = children.find((child, index) => child.name === 'LinkMark' && index > 0);
        const url = children.find(child => child.name === 'URL');
        if (open && close) addMark(open.to, close.from, 'cm-live-link');
        if (url && !rangeIsActive(node.from, node.to)) hide(url.from, url.to);
      } else if ((name === 'LinkMark' || name === 'LinkTitle') && !inlineSyntaxIsActive(node)) {
        hide(node.from, node.to);
      }

      if (name === 'TableDelimiter') {
        const firstLine = state.doc.lineAt(node.from).number;
        const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
        if (firstLine === lastLine && state.doc.line(firstLine).text.includes('-')) {
          if (!lineIsActive(firstLine)) hide(state.doc.line(firstLine).from, state.doc.line(firstLine).to);
        } else if (!lineIsActive(firstLine)) hide(node.from, node.to);
      } else if (markerNames.has(name) && (inlineMarkerNames.has(name) ? !inlineSyntaxIsActive(node) : !lineIsActive(state.doc.lineAt(node.from).number))) {
        hide(node.from, node.to);
      } else if (name === 'CodeInfo' && !lineIsActive(state.doc.lineAt(node.from).number)) {
        hide(node.from, node.to);
      } else if (name === 'TaskMarker' && !lineIsActive(state.doc.lineAt(node.from).number)) {
        const marker = state.doc.sliceString(node.from, node.to);
        ranges.push(Decoration.replace({ widget: new TaskWidget(node.from, node.to, /x/i.test(marker)) }).range(node.from, node.to));
      } else if (name === 'ListMark' && !lineIsActive(state.doc.lineAt(node.from).number) && !/^\d/.test(state.doc.sliceString(node.from, node.to))) {
        hide(node.from, node.to);
      }
    },
  });

  for (let lineNumber = firstVisibleLine; lineNumber <= lastVisibleLine; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const display = /^\s*\$\$([^$\n]+)\$\$\s*$/.exec(line.text);
    if (display && !lineIsActive(line.number) && !protectedRanges.some(range => range.from < line.to && range.to > line.from)) {
      ranges.push(Decoration.replace({ widget: new MathWidget(display[1].trim(), true) }).range(line.from, line.to));
      continue;
    }
    for (const match of line.text.matchAll(inlineMathPattern)) {
      if (match.index === undefined) continue;
      const from = line.from + match.index;
      const to = from + match[0].length;
      if (rangeIsActive(from, to)) continue;
      if (protectedRanges.some(range => range.from < to && range.to > from)) continue;
      ranges.push(Decoration.replace({ widget: new MathWidget(match[1], false) }).range(from, to));
    }
  }

  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(ranges, true);
}

export function createLivePreviewExtension(imageUrls: Map<string, string>, documentPath: string | null) {
  return ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) { this.decorations = buildLivePreviewDecorations(view, imageUrls, documentPath); }

  update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean; viewportChanged: boolean; transactions: readonly { effects: readonly StateEffect<unknown>[] }[] }) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshLivePreview)))) {
      this.decorations = buildLivePreviewDecorations(update.view, imageUrls, documentPath);
    }
  }
  }, { decorations: value => value.decorations });
}
