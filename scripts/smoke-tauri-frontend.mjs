import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = 5174;
const url = `http://${host}:${port}/`;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const server = spawn(npmCommand, ['run', 'dev', '--prefix', 'apps/desktop', '--', '--host', host], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CI: '1' },
});
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not start on ${url}.\n${serverOutput}`);
}

const checks = [];
const errors = [];
let browser;
try {
  await waitForServer();
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => existsSync(path));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });

  await page.locator('.empty-state').waitFor();
  await page.locator('.empty-state .primary-command').click();
  await page.locator('.statusbar').waitFor();
  checks.push('empty startup and status bar');

  const sourceMode = page.locator('.status-mode-option[aria-label="源码"]');
  const previewMode = page.locator('.status-mode-option[aria-label="预览"]');
  await sourceMode.click();
  const sourceEditor = page.locator('.cm-content');
  await sourceEditor.waitFor();
  const source = '# Markit\n\n## Writing\n\nSearchable Markit text.\n\n**Bold** and `code`. Inline $x^2$ math.\n\n- [ ] Pending task\n\n$$y = x + 1$$\n\n```javascript\nconst ready = true;\n```\n';
  await sourceEditor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Searchable Markit text.'));
  checks.push('source mode editing');

  await previewMode.click();
  await page.locator('.pm-editor h1', { hasText: 'Markit' }).waitFor();
  await page.locator('.pm-editor h2', { hasText: 'Writing' }).waitFor();
  await page.locator('.pm-editor .md-math-inline').waitFor();
  await page.locator('.pm-editor .md-math-display').waitFor();
  await page.locator('.pm-editor .md-task-checkbox').waitFor();
  await page.locator('.pm-editor pre code').waitFor();
  checks.push('live preview rendering', 'formula, task list and fenced code rendering');

  await page.getByRole('button', { name: '大纲', exact: true }).click();
  await page.locator('.outline-list button', { hasText: 'Writing' }).waitFor();
  await page.locator('.outline-list button', { hasText: 'Writing' }).click();
  checks.push('outline navigation');

  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const searchInput = page.locator('.sidebar-search').first();
  await searchInput.fill('Searchable');
  await page.locator('.md-search-hit').waitFor();
  checks.push('search highlighting');

  await sourceMode.click();
  await sourceEditor.waitFor();
  if (!(await sourceEditor.textContent())?.includes('Searchable Markit text.')) throw new Error('Source changed during live/source mode round-trip.');
  checks.push('source/live round-trip');

  await previewMode.click();
  const liveEditor = page.locator('.pm-editor .ProseMirror');
  await liveEditor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('```javascript');
  await page.keyboard.press('Enter');
  await page.keyboard.type('const typed = true;');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.locator('.pm-editor pre code').waitFor();
  await page.keyboard.type('**typed bold**');
  await page.locator('.pm-editor strong', { hasText: 'typed bold' }).waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('`typed code`');
  await page.locator('.pm-editor code', { hasText: 'typed code' }).waitFor();
  await sourceMode.click();
  const formattedSource = await sourceEditor.innerText();
  if (!formattedSource.includes('**typed bold**') || !formattedSource.includes('`typed code`')) {
    throw new Error(`Live formatting was not serialized to Markdown correctly: ${formattedSource}`);
  }
  await previewMode.click();
  await liveEditor.click();
  checks.push('live code fence and inline formatting input');

  await page.keyboard.press('Control+A');
  await page.keyboard.type('# typed heading');
  await page.locator('.pm-editor h1', { hasText: 'typed heading' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('- typed list');
  await page.locator('.pm-editor ul li', { hasText: 'typed list' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('> typed quote');
  await page.locator('.pm-editor blockquote', { hasText: 'typed quote' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('[typed link](https://example.com)');
  await page.locator('.pm-editor a[href="https://example.com"]', { hasText: 'typed link' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('~~typed strike~~');
  await page.locator('.pm-editor s', { hasText: 'typed strike' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('==typed highlight==');
  await page.locator('.pm-editor mark', { hasText: 'typed highlight' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('***typed combined emphasis***');
  await page.locator('.pm-editor strong', { hasText: 'typed combined emphasis' }).waitFor();
  await page.locator('.pm-editor em', { hasText: 'typed combined emphasis' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('---');
  await page.keyboard.press('Enter');
  await page.locator('.pm-editor hr').waitFor();
  checks.push('live heading, list, quote, link, inline mark and horizontal rule input');

  if (await page.locator('.statusbar').count() !== 1) throw new Error('Expected one visible status bar.');

  await page.locator('.document-tab .tab-close').first().click();
  await page.locator('[data-testid="close-confirm"]').waitFor();
  if (await page.locator('.document-tab').count() !== 1) throw new Error('Dirty document closed before confirmation.');
  await page.getByRole('button', { name: '取消', exact: true }).last().click();
  if (await page.locator('[data-testid="close-confirm"]').count() !== 0) throw new Error('Close confirmation did not close after cancellation.');
  await page.locator('.document-tab .tab-close').first().click();
  await page.getByRole('button', { name: '丢弃修改', exact: true }).click();
  await page.locator('.empty-state').waitFor();
  checks.push('dirty document close confirmation');

  if (errors.length) throw new Error(`Frontend console errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ status: 'passed', checks }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', checks, errors, error: String(error), serverOutput }));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  server.kill('SIGTERM');
}
