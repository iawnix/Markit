import { describe, expect, it } from 'vitest';
import { extractHeadings, renderHtmlDocument, slugForHeading } from '../packages/markdown/src/index';
import { isLosslessCandidate, parseMarkdown, serializeMarkdown } from '../packages/editor/src/prosemirror';
import { normalizePermissions, requiresPrompt } from '../packages/plugin-sdk/src/permissions';
import { PluginRegistry } from '../packages/plugin-sdk/src/registry';
import { validateManifest } from '../packages/plugin-sdk/src/index';

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
  });

  it('exports a complete HTML document without enabling raw HTML', () => {
    const html = renderHtmlDocument('# Title\n\n<script>alert(1)</script>\n', 'A <title>');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>A &lt;title&gt;</title>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
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
});
