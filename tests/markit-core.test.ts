import { describe, expect, it } from 'vitest';
import { extractHeadings, renderHtmlDocument, slugForHeading } from '../packages/markdown/src/index';
import { isLosslessCandidate, parseMarkdown, serializeMarkdown, serializeMarkdownLike } from '../packages/editor/src/prosemirror';
import { normalizePermissions, requiresPrompt } from '../packages/plugin-sdk/src/permissions';
import { PluginRegistry } from '../packages/plugin-sdk/src/registry';
import { validateManifest } from '../packages/plugin-sdk/src/index';
import { parsePluginPackage } from '../packages/plugin-sdk/src/package';
import { strToU8, zipSync } from 'fflate';
import { replaceText } from '../packages/editor/src/source-map';

describe('Markit Markdown core', () => {
  it('extracts a stable heading outline with source offsets', () => {
    const headings = extractHeadings('# Intro\n\n## Design\n');
    expect(headings.map(item => [item.level, item.text])).toEqual([[1, 'Intro'], [2, 'Design']]);
    expect(headings[1].offset).toBeGreaterThan(headings[0].offset);
    expect(slugForHeading('A useful section')).toBe('a-useful-section');
  });

  it('round-trips standard Markdown through the semantic projection', () => {
    const source = '# Title\n\nA paragraph with **emphasis**.\n';
    expect(serializeMarkdown(parseMarkdown(source).document)).toContain('# Title');
    expect(isLosslessCandidate(source)).toBe(true);
    expect(isLosslessCandidate('<!-- custom -->\n')).toBe(false);
    expect(serializeMarkdownLike(parseMarkdown('# Title').document, '# Title\n')).toBe('# Title\n');
  });

  it('keeps GFM tables and strikethrough in the live projection', () => {
    const source = '| Name | Value |\n| :--- | ---: |\n| ~~Old~~ | **42** |\n';
    const serialized = serializeMarkdown(parseMarkdown(source).document);
    expect(serialized).toContain('| Name | Value |');
    expect(serialized).toContain('| :--- | ---: |');
    expect(serialized).toContain('~~Old~~');
    expect(serialized).toContain('**42**');
  });

  it('round-trips highlight marks in the live projection', () => {
    const source = 'A ==highlight== and ~~removed~~.';
    expect(serializeMarkdown(parseMarkdown(source).document)).toContain('==highlight==');
    expect(serializeMarkdown(parseMarkdown(source).document)).toContain('~~removed~~');
  });

  it('preserves front matter, comments, and special fenced blocks as raw nodes', () => {
    const source = '---\ntitle: Demo\n---\n\n<!-- generated -->\n\n```mermaid\nflowchart LR\nA-->B\n```\n';
    const document = parseMarkdown(source).document;
    expect(document.content.content.map(node => node.type.name)).toEqual(['raw_markdown', 'raw_markdown', 'raw_markdown']);
    expect(serializeMarkdown(document)).toBe(source);
  });

  it('round-trips footnote references and renders the footnote section', () => {
    const source = 'A note[^source].\n\n[^source]: Supporting *detail*.\n';
    const serialized = serializeMarkdown(parseMarkdown(source).document);
    expect(serialized).toContain('A note[^source].');
    expect(serialized).toContain('[^source]: Supporting *detail*.');
    const html = renderHtmlDocument(source, 'Footnotes');
    expect(html).toContain('class="footnote-ref"');
    expect(html).toContain('Supporting <em>detail</em>.');
  });

  it('round-trips inline footnotes without converting them to empty references', () => {
    const source = 'Inline note^[Read this later].';
    expect(serializeMarkdown(parseMarkdown(source).document)).toContain(source);
  });

  it('keeps common inline HTML and custom directive text stable', () => {
    const source = 'Use <kbd>Ctrl</kbd> here.\n\n:::note\nKeep this block.\n:::\n';
    const document = parseMarkdown(source).document;
    const serialized = serializeMarkdown(document);
    expect(serialized).toBe(source);
    expect(document.firstChild?.firstChild?.type.name).toBe('text');
    expect(document.firstChild?.child(1).type.name).toBe('raw_inline');
  });

  it('exports a complete HTML document without enabling raw HTML', () => {
    const html = renderHtmlDocument('# Title\n\n<script>alert(1)</script>\n', 'A <title>');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>A &lt;title&gt;</title>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('replaces one or all case-insensitive source matches without interpreting replacement syntax', () => {
    expect(replaceText('Alpha alpha $1', 'alpha', '$2')).toBe('$2 alpha $1');
    expect(replaceText('Alpha alpha', 'alpha', '$&', true)).toBe('$& $&');
  });

  it('normalizes plugin permissions and identifies prompts', () => {
    expect(normalizePermissions(['document.read', 'network', 'network', 'unknown'])).toEqual(['document.read', 'network']);
    expect(requiresPrompt('network')).toBe(true);
    expect(requiresPrompt('document.read')).toBe(false);
  });

  it('registers, enables and removes versioned plugins without duplicate IDs', () => {
    const registry = new PluginRegistry();
    const manifest = { id: 'markit.example', name: 'Example', version: '1.0.0', apiVersion: 1, entry: 'dist/index.js', permissions: ['document.read'], contributions: [{ type: 'panel', id: 'example' }] };
    expect(registry.install(manifest).enabled).toBe(false);
    expect(registry.setEnabled('markit.example', true).enabled).toBe(true);
    expect(() => registry.install(manifest)).toThrow('already installed');
    expect(registry.remove('markit.example')).toBe(true);
  });

  it('rejects undeclared plugin permissions at manifest validation time', () => {
    expect(validateManifest({ id: 'markit.bad', name: 'Bad', version: '1.0.0', apiVersion: 1, entry: 'index.js', permissions: ['network.elevated'], contributions: [] })).toBe(false);
  });

  it('validates plugin archives and rejects integrity tampering', async () => {
    const manifest = JSON.stringify({ id: 'markit.archive', name: 'Archive', version: '1.0.0', apiVersion: 1, entry: 'dist/index.js', permissions: [], contributions: [] });
    const entry = strToU8('export default {};');
    const valid = zipSync({ 'manifest.json': strToU8(manifest), 'dist/index.js': entry });
    await expect(parsePluginPackage(valid)).resolves.toMatchObject({ manifest: { id: 'markit.archive' }, entrySource: 'export default {};', integrityVerified: false });
    const tampered = zipSync({ 'manifest.json': strToU8(manifest), 'dist/index.js': entry, 'integrity.json': strToU8(JSON.stringify({ 'dist/index.js': '0'.repeat(64) })) });
    await expect(parsePluginPackage(tampered)).rejects.toThrow('integrity check failed');
  });

  it('persists plugin enablement through a fresh registry', () => {
    const registry = new PluginRegistry();
    registry.install({ id: 'markit.persist', name: 'Persist', version: '1.0.0', apiVersion: 1, entry: 'index.js', permissions: [], contributions: [] });
    registry.setEnabled('markit.persist', true);
    expect(new PluginRegistry(registry.toJSON()).get('markit.persist')?.enabled).toBe(true);
  });
});
