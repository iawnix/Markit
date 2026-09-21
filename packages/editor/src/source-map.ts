export interface SourceBlock {
  from: number;
  to: number;
  kind: 'paragraph' | 'heading' | 'list' | 'blockquote' | 'code' | 'raw';
}

export function sourceBlocks(source: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let offset = 0;
  for (const raw of source.split(/(?=\n{2,})/)) {
    const text = raw.replace(/^\n+/, '');
    const from = source.indexOf(text, offset);
    const to = from + text.length;
    const kind = /^#{1,6}\s/.test(text) ? 'heading'
      : /^```/.test(text) ? 'code'
      : /^>/.test(text) ? 'blockquote'
      : /^(?:[-*+] |\d+[.)] )/.test(text) ? 'list'
      : /^<!--|^---$/.test(text) ? 'raw' : 'paragraph';
    if (from >= 0) blocks.push({ from, to, kind });
    offset = Math.max(offset + text.length, to);
  }
  return blocks;
}

export function patchSource(source: string, from: number, to: number, replacement: string): string {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > source.length) throw new Error('Invalid source range.');
  return source.slice(0, from) + replacement + source.slice(to);
}
