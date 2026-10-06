import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { inputRules } from 'prosemirror-inputrules';
import type { EditorView } from 'prosemirror-view';
import { createLiveInputRules } from '../apps/desktop/src/ProseMirrorEditor';
import { markdownParser } from '../packages/editor/src/prosemirror';

function applyInput(before: string, text: string) {
  const schema = markdownParser.schema;
  const paragraph = schema.nodes.paragraph.create(null, before ? schema.text(before) : null);
  const doc = schema.topNodeType.create(null, paragraph);
  let state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1 + before.length),
    plugins: [inputRules({ rules: createLiveInputRules(schema) })],
  });
  const plugin = state.plugins.find(item => item.spec.isInputRules);
  if (!plugin?.props.handleTextInput) throw new Error('Input rule plugin is not installed.');
  const view = {
    get state() { return state; },
    composing: false,
    dispatch(transaction: Transaction) { state = state.apply(transaction); },
  } as unknown as EditorView;
  const handled = plugin.props.handleTextInput.call(plugin, view, state.selection.from, state.selection.to, text, () => state.tr.insertText(text, state.selection.from, state.selection.to));
  return { handled, state };
}

describe('live Markdown input rules', () => {
  it('supports paired multi-character code delimiters', () => {
    const result = applyInput('``code`', '`');
    expect(result.handled).toBe(true);
    expect(result.state.doc.firstChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(['code']);
    expect(result.state.doc.textContent).toBe('code');
  });

  it('supports four-star and three-star emphasis delimiters', () => {
    const strong = applyInput('****bold***', '*');
    expect(strong.handled).toBe(true);
    expect(strong.state.doc.firstChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(['strong']);

    const combined = applyInput('***both**', '*');
    expect(combined.handled).toBe(true);
    expect(combined.state.doc.firstChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(['em', 'strong']);
  });
});
