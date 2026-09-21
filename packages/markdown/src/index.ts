import MarkdownIt from 'markdown-it';

export interface MarkdownHeading {
  id: string;
  level: number;
  text: string;
  offset: number;
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

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

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

export function renderHtmlDocument(source: string, title: string): string {
  const body = renderMarkdown(source);
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
