import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

// Stable semantic classes let light, dark and system themes recolor the current
// document without rebuilding the editor or changing its selection/history.
export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, class: 'cm-syntax-heading' },
  { tag: tags.strong, class: 'cm-syntax-strong' },
  { tag: tags.emphasis, class: 'cm-syntax-emphasis' },
  { tag: tags.strikethrough, class: 'cm-syntax-strike' },
  { tag: tags.link, class: 'cm-syntax-link' },
  { tag: tags.url, class: 'cm-syntax-url' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta, tags.labelName], class: 'cm-syntax-marker' },
  { tag: tags.comment, class: 'cm-syntax-comment' },
  { tag: [tags.monospace, tags.variableName, tags.propertyName], class: 'cm-syntax-text' },
  { tag: tags.keyword, class: 'cm-syntax-keyword' },
  { tag: [tags.string, tags.regexp, tags.inserted], class: 'cm-syntax-string' },
  { tag: [tags.number, tags.bool, tags.atom, tags.character, tags.escape], class: 'cm-syntax-number' },
  { tag: [tags.typeName, tags.namespace, tags.className], class: 'cm-syntax-type' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'cm-syntax-function' },
  { tag: [tags.invalid, tags.deleted], class: 'cm-syntax-error' },
]);
