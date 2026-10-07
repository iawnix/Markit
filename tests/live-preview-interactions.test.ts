import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { buildLivePreviewDecorations, editTableStructure, externalLinkAt, moveToTableCell, pasteTableCells } from '../apps/desktop/src/live-preview';
import { codeLanguageForFence } from '../apps/desktop/src/markdown-code-languages';

function editor(source: string) {
  return EditorState.create({ doc: source, extensions: [markdown({ base: markdownLanguage })] });
}

describe('live preview interactions', () => {
  it('recognizes and lazily loads supported fenced-code languages', async () => {
    const typescript = codeLanguageForFence('ts');
    const css = codeLanguageForFence('css');
    const html = codeLanguageForFence('html');
    expect(typescript?.name).toBe('JavaScript');
    expect(css?.name).toBe('CSS');
    expect(html?.name).toBe('HTML');
    expect(codeLanguageForFence('unknown-language')).toBeNull();

    for (const [fence, name] of [
      ['python', 'Python'], ['rs', 'Rust'], ['json', 'JSON'], ['sql', 'SQL'],
      ['yaml', 'YAML'], ['bash', 'Shell'], ['zsh', 'Shell'],
    ]) {
      const language = codeLanguageForFence(fence);
      expect(language?.name).toBe(name);
      expect(language?.load).toBeDefined();
      expect((await language?.load())?.language.parser).toBeDefined();
    }
    expect((await typescript?.load())?.language.parser).toBeDefined();
  });

  it('reveals inline markers only for the syntax range containing the caret', () => {
    const source = '**Bold** and `code`';
    const state = editor(source).update({ selection: { anchor: source.length } }).state;
    const decorations = buildLivePreviewDecorations(
      { state, viewport: { from: 0, to: source.length } } as EditorView,
      new Map(),
      null,
    );
    const ranges: Array<[number, number]> = [];
    decorations.between(0, source.length, (from, to) => { ranges.push([from, to]); });
    expect(ranges).toContainEqual([0, 2]);
    expect(ranges).toContainEqual([6, 8]);

    const boldState = editor(source).update({ selection: { anchor: 3 } }).state;
    const boldDecorations = buildLivePreviewDecorations(
      { state: boldState, viewport: { from: 0, to: source.length } } as EditorView,
      new Map(),
      null,
    );
    const boldRanges: Array<[number, number]> = [];
    boldDecorations.between(0, source.length, (from, to) => { boldRanges.push([from, to]); });
    expect(boldRanges).not.toContainEqual([0, 2]);
    expect(boldRanges).not.toContainEqual([6, 8]);
    expect(boldRanges).toContainEqual([13, 14]);
  });

  it('opens only absolute links with an allowed protocol', () => {
    const safe = editor('[site](https://example.com/path) and [mail](mailto:a@example.com)');
    expect(externalLinkAt(safe, safe.doc.toString().indexOf('site'))).toBe('https://example.com/path');
    expect(externalLinkAt(safe, safe.doc.toString().indexOf('mail'))).toBe('mailto:a@example.com');

    for (const source of ['[bad](javascript:alert(1))', '[local](notes.md)', '[file](file:///secret)']) {
      const state = editor(source);
      expect(externalLinkAt(state, source.indexOf('bad') >= 0 ? source.indexOf('bad') : source.indexOf('local') >= 0 ? source.indexOf('local') : source.indexOf('file'))).toBeUndefined();
    }
  });

  it('moves through Markdown table cells and appends a source row', () => {
    const source = '| A | B |\n| --- | --- |\n| one | two |';
    let state = editor(source);
    const firstCell = source.indexOf('one');
    state = state.update({ selection: { anchor: firstCell } }).state;
    expect(moveToTableCell(false)({ state, dispatch: transaction => { state = transaction.state; } })).toBe(true);
    expect(state.selection.main.head).toBe(source.indexOf('two'));

    const lastCell = state.doc.toString().indexOf('two');
    state = state.update({ selection: { anchor: lastCell } }).state;
    expect(moveToTableCell(false)({ state, dispatch: transaction => { state = transaction.state; } })).toBe(true);
    expect(state.doc.toString()).toBe(`${source}\n|  |  |`);
    expect(state.doc.sliceString(state.selection.main.head, state.selection.main.head)).toBe('');
    expect(state.selection.main.head).toBe(source.length + 3);
  });

  it('moves backward within a table and stays in the first cell', () => {
    const source = '| A | B |\n| --- | --- |\n| one | two |';
    let state = editor(source);
    const lastCell = source.indexOf('two');
    state = state.update({ selection: { anchor: lastCell } }).state;
    expect(moveToTableCell(true)({ state, dispatch: transaction => { state = transaction.state; } })).toBe(true);
    expect(state.selection.main.head).toBe(source.indexOf('one') + 'one'.length);
  });

  it('pastes tabular text across cells and appends missing rows', () => {
    const source = '| A | B |\n| --- | --- |\n| one | two |';
    let state = editor(source).update({ selection: { anchor: source.indexOf('one') } }).state;
    const handled = pasteTableCells('first\tsecond\nthird\tfourth\nfifth\tsixth')({
      state,
      dispatch: transaction => { state = transaction.state; },
    });

    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe('| A | B |\n| --- | --- |\n| first | second |\n| third | fourth |\n| fifth | sixth |');
    expect(state.doc.sliceString(state.selection.main.head - 5, state.selection.main.head)).toBe('sixth');
  });

  it('escapes table separators pasted as cell text', () => {
    const source = '| A | B |\n| --- | --- |\n| one | two |';
    let state = editor(source).update({ selection: { anchor: source.indexOf('one') } }).state;
    const handled = pasteTableCells('left|right\tvalue')({
      state,
      dispatch: transaction => { state = transaction.state; },
    });

    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe('| A | B |\n| --- | --- |\n| left\\|right | value |');
  });

  it('adds columns for a wider TSV paste and preserves existing alignment', () => {
    const source = '| A | B |\n| :--- | ---: |\n| one | two |\n| three | four |';
    let state = editor(source).update({ selection: { anchor: source.indexOf('one') } }).state;
    const handled = pasteTableCells('first\tsecond\tthird\nnext\tvalue\tlast')({
      state,
      dispatch: transaction => { state = transaction.state; },
    });

    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe([
      '| A | B | Column 3 |',
      '| :--- | ---: | --- |',
      '| first | second | third |',
      '| next | value | last |',
    ].join('\n'));
    expect(state.doc.sliceString(state.selection.main.head - 4, state.selection.main.head)).toBe('last');
  });

  it('keeps pipe-less tables valid when adding columns to short rows', () => {
    const source = 'A | B\n--- | ---\none | two\nshort';
    let state = editor(source).update({ selection: { anchor: source.indexOf('one') } }).state;
    const handled = pasteTableCells('new\tmore\tthird')({
      state,
      dispatch: transaction => { state = transaction.state; },
    });

    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe('A | B | Column 3\n--- | --- | ---\nnew | more | third\nshort |  | ');
    expect(syntaxTree(editor(state.doc.toString())).topNode.firstChild?.name).toBe('Table');
  });

  it('pastes into an empty middle cell without shifting following cells', () => {
    const source = '| A | B | C |\n| --- | --- | --- |\n| one |  | three |';
    const emptyCell = source.indexOf('|  |', source.indexOf('one')) + 3;
    let state = editor(source).update({ selection: { anchor: emptyCell } }).state;
    const handled = pasteTableCells('middle\tlast')({
      state,
      dispatch: transaction => { state = transaction.state; },
    });

    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe('| A | B | C |\n| --- | --- | --- |\n| one | middle | last |');
  });

  it('inserts and deletes table rows and columns without changing untouched cells', () => {
    const source = '| A | B |\n| :--- | ---: |\n| one | two |\n| three | four |';
    let state = editor(source).update({ selection: { anchor: source.indexOf('one') } }).state;
    const insertColumn = editTableStructure('column-right', 1, 0)({
      state,
      dispatch: transaction => { state = transaction.state; },
    });
    expect(insertColumn).toBe(true);
    expect(state.doc.toString()).toBe('| A | Column 2 | B |\n| :--- | --- | ---: |\n| one |  | two |\n| three |  | four |');

    const deleteColumn = editTableStructure('column-delete', 1, 1)({
      state,
      dispatch: transaction => { state = transaction.state; },
    });
    expect(deleteColumn).toBe(true);
    expect(state.doc.toString()).toBe(source);

    const insertRow = editTableStructure('row-below', 1, 0)({
      state,
      dispatch: transaction => { state = transaction.state; },
    });
    expect(insertRow).toBe(true);
    expect(state.doc.toString()).toBe('| A | B |\n| :--- | ---: |\n| one | two |\n|  |  |\n| three | four |');

    const deleteRow = editTableStructure('row-delete', 2, 0)({
      state,
      dispatch: transaction => { state = transaction.state; },
    });
    expect(deleteRow).toBe(true);
    expect(state.doc.toString()).toBe(source);

    const deleteHeader = editTableStructure('row-delete', 0, 0)({
      state,
      dispatch: transaction => { state = transaction.state; },
    });
    expect(deleteHeader).toBe(true);
    expect(state.doc.toString()).toBe('| one | two |\n| :--- | ---: |\n| three | four |');
  });
});
