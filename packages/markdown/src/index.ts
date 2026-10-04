import MarkdownIt from 'markdown-it';

export interface MarkdownHeading {
  id: string;
  level: number;
  text: string;
  offset: number;
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });
const citationPattern = /^\[(?:@[A-Z0-9]{8})(?:\s*;\s*@[A-Z0-9]{8})*\]/u;

markdown.inline.ruler.before('link', 'markit_citation', (state, silent) => {
  const match = citationPattern.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const token = state.push('markit_citation', 'span', 0);
    token.content = match[0];
    token.meta = { keys: [...match[0].matchAll(/@([A-Z0-9]{8})/gu)].map(item => item[1]) };
  }
  state.pos += match[0].length;
  return true;
});
markdown.renderer.rules.markit_citation = (tokens, index, _options, env) => {
  const token = tokens[index];
  const keys = (token.meta as { keys?: string[] } | undefined)?.keys || [];
  const citations = (env as { citations?: Record<string, number> } | undefined)?.citations || {};
  const numbers = keys.map(key => citations[key]).filter((number): number is number => Number.isInteger(number) && number > 0);
  if (numbers.length !== keys.length) return escapeHtml(token.content);
  const label = `[${numbers.join(', ')}]`;
  return `<span class="md-citation-inline" title="${escapeHtml(keys.map(key => `@${key}`).join('; '))}">${label}</span>`;
};

export function extractHeadings(source: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let offset = 0;
  for (const line of source.split(/\n/)) {
    const match = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line.replace(/\r$/, ''));
    if (match) headings.push({ id: `heading-${headings.length}`, level: match[1].length, text: match[2].replace(/[*_`~]/g, '').trim(), offset });
    offset += line.length + 1;
  }
  return headings;
}

export function renderMarkdown(source: string, citations: Record<string, number> = {}): string {
  return markdown.render(source, { citations });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

export function renderHtmlDocument(source: string, title: string, citations: Record<string, number> = {}): string {
  const body = renderMarkdown(source, citations);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #29342e; background: #fff; }
body { max-width: 860px; margin: 0 auto; padding: 56px 32px 96px; line-height: 1.75; }
h1, h2, h3, h4, h5, h6 { color: #1d2922; line-height: 1.28; }
h1 { padding-bottom: 13px; border-bottom: 1px solid #dfe6df; }
h2 { margin-top: 38px; padding-bottom: 8px; border-bottom: 1px solid #e7ece7; }
blockquote { margin: 18px 0; padding: 7px 17px; border-left: 3px solid #74a887; background: #f1f6f2; color: #637069; }
pre { overflow: auto; padding: 13px 15px; border: 1px solid #e1e7e2; border-radius: 5px; background: #f5f7f5; }
code { padding: 2px 4px; border-radius: 3px; background: #eef2ee; }
pre code { padding: 0; background: transparent; }
img { max-width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 7px 9px; border: 1px solid #dce4dd; text-align: left; }
th { background: #f3f6f3; }
a { color: #2c7250; }
.md-citation-inline { padding: 1px 4px; border-radius: 3px; background: #eaf1ec; color: #2d6a52; font-size: .86em; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function slugForHeading(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
}
