import { parser } from '@lezer/markdown';
import MarkdownIt from 'markdown-it';
import type { SyntaxNode } from '@lezer/common';

const markdown = new MarkdownIt();
export interface ImageReference { from: number; to: number; destination: string; prefix: string; suffix: string }
const labelKey = (label: string) => markdown.utils.unescapeAll(label).trim().replace(/\s+/g, ' ').toUpperCase();
const destination = (raw: string) => markdown.utils.unescapeAll(raw.startsWith('<') ? raw.slice(1, -1) : raw);

/** Source spans keep unrelated Markdown byte-for-byte, including reference definitions shared with links. */
export function imageReferences(source: string): ImageReference[] {
  const tree = parser.parse(source);
  const definitions = new Map<string, { url: string; title: string }>();
  const images: SyntaxNode[] = [];
  tree.iterate({ enter(node) {
    if (node.name === 'Image') images.push(node.node);
    if (node.name !== 'LinkReference') return;
    const label = node.node.getChild('LinkLabel');
    const url = node.node.getChild('URL');
    const title = node.node.getChild('LinkTitle');
    if (label && url) {
      const key = labelKey(source.slice(label.from + 1, label.to - 1));
      if (!definitions.has(key)) definitions.set(key, { url: destination(source.slice(url.from, url.to)), title: title ? ` ${source.slice(title.from, title.to)}` : '' });
    }
  } });
  return images.flatMap(node => {
    const url = node.getChild('URL');
    if (url) return [{ from: url.from, to: url.to, destination: destination(source.slice(url.from, url.to)), prefix: '<', suffix: '>' }];
    const label = node.getChild('LinkLabel');
    const marks = node.getChildren('LinkMark');
    const close = marks.find(mark => source.slice(mark.from, mark.to) === ']');
    if (!close) return [];
    const alt = source.slice(node.from + 2, close.from);
    const explicit = label ? source.slice(label.from + 1, label.to - 1) : '';
    const definition = definitions.get(labelKey(explicit || alt));
    return definition ? [{ from: node.from, to: node.to, destination: definition.url, prefix: `![${alt}](<`, suffix: `>${definition.title})` }] : [];
  });
}
export function localImagePath(value: string): string | null {
  if (/^file:/i.test(value)) {
    const url = new URL(value);
    if (url.hostname && url.hostname !== 'localhost') throw new Error(`Network image paths are not supported: ${value}`);
    const path = decodeURIComponent(url.pathname);
    return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
  }
  if (/^[a-z]:[\\/]/i.test(value)) return value;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return null;
  try { return decodeURIComponent(value.split(/[?#]/)[0]); } catch { throw new Error(`Invalid image path: ${value}`); }
}
export function rewriteImages(source: string, replacements: Map<string, string>): string {
  for (const ref of imageReferences(source).sort((a, b) => b.from - a.from)) {
    const replacement = replacements.get(ref.destination);
    if (replacement !== undefined) source = source.slice(0, ref.from) + ref.prefix + replacement + ref.suffix + source.slice(ref.to);
  }
  return source;
}
