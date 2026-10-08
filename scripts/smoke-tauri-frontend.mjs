import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { checkLiveSelection, checkLivePointer } from './check-live-selection.mjs';

const host = '127.0.0.1';
const port = 5174;
const url = `http://${host}:${port}/`;
// Start Vite directly so cleanup terminates the server, not just its npm parent.
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--config', 'vite.config.ts', '--host', host], {
  cwd: fileURLToPath(new URL('../apps/desktop', import.meta.url)),
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
  await page.addInitScript(() => {
    window.openedExternalUrls = [];
    window.open = (url) => { window.openedExternalUrls.push(String(url)); return null; };
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });

  await page.locator('.empty-state').waitFor();
  await page.locator('.menu-trigger').click();
  await page.getByRole('button', { name: '关于 Markit' }).click();
  await page.locator('[data-testid="about-dialog"]').getByText(/^v\d+\.\d+\.\d+$/).waitFor();
  await page.locator('[data-testid="about-dialog"]').getByRole('button', { name: 'Close' }).click();
  checks.push('about page and application version');
  await page.locator('.empty-state .primary-command').click();
  await page.locator('.statusbar').waitFor();
  checks.push('empty startup and status bar');

  const initialLiveContent = page.locator('.live-editor-column .cm-content');
  await initialLiveContent.waitFor();
  await initialLiveContent.click();
  await page.keyboard.insertText('**First preview**');
  await page.locator('.cm-live-strong', { hasText: 'First preview' }).waitFor();
  checks.push('live preview decorations initialize on first document open');

  const sourceMode = page.locator('.status-mode-option[aria-label="源码"]');
  const previewMode = page.locator('.status-mode-option[aria-label="预览"]');
  await sourceMode.click();
  const sourceEditor = page.locator('.source-editor-column .cm-content');
  await sourceEditor.waitFor();
  const sourceScrollLayout = await page.locator('.editor-scroll').evaluate(element => {
    const editor = element.querySelector('.source-editor-column .cm-scroller');
    if (!editor) throw new Error('The source editor scroll viewport was not found.');
    const outer = element.getBoundingClientRect();
    const inner = editor.getBoundingClientRect();
    return { outerHeight: outer.height, innerHeight: inner.height, topOffset: inner.top - outer.top, outerOverflow: getComputedStyle(element).overflowY };
  });
  if (sourceScrollLayout.outerOverflow !== 'hidden' || Math.abs(sourceScrollLayout.outerHeight - sourceScrollLayout.innerHeight) > 2 || Math.abs(sourceScrollLayout.topOffset) > 1) {
    throw new Error(`Source editor should use one full-panel scroll viewport: ${JSON.stringify(sourceScrollLayout)}`);
  }
  checks.push('source editor scroll viewport fills the full editing panel');
  const source = '# Markit\n\n## Writing\n\nSearchable Markit text.\n\n**Bold** and `code`. Inline $x^2$ math.\n\n- [ ] Pending task\n\n![pixel](data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=)\n\n$$y = x + 1$$\n\n```javascript\nconst ready = true;\n```\n';
  await sourceEditor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Searchable Markit text.'));
  checks.push('source mode editing');

  await previewMode.click();
  const liveContent = page.locator('.live-editor-column .cm-content');
  await page.locator('.cm-line.cm-live-heading-1', { hasText: 'Markit' }).waitFor();
  await page.locator('.cm-line.cm-live-heading-2', { hasText: 'Writing' }).waitFor();
  await page.locator('.cm-live-inline-code', { hasText: 'code' }).waitFor();
  await page.locator('.cm-live-math-inline').waitFor();
  await page.locator('.cm-live-math-display').waitFor();
  await page.locator('.cm-live-math-inline .katex').waitFor();
  await page.locator('.cm-live-task-checkbox').waitFor();
  await page.waitForFunction(() => document.querySelector('.cm-live-image')?.naturalWidth === 1);
  await page.locator('.cm-line.cm-live-code-block').first().waitFor();
  checks.push('live markdown, math, task and GFM decorations');
  const boldPreview = page.locator('.cm-live-strong', { hasText: 'Bold' });
  const formattedLine = boldPreview.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " cm-line ")][1]');
  if ((await formattedLine.innerText()).includes('**Bold**') || (await formattedLine.innerText()).includes('`code`')) {
    throw new Error('Inactive inline Markdown syntax should stay hidden in a preview paragraph.');
  }
  checks.push('inline syntax stays hidden away from the caret');

  await page.locator('.cm-live-task-checkbox').check();
  await sourceMode.click();
  if (!(await sourceEditor.innerText()).includes('- [x] Pending task')) throw new Error('Task checkbox did not update its Markdown source.');
  await previewMode.click();
  checks.push('task checkbox updates canonical Markdown');

  await page.getByRole('button', { name: '大纲', exact: true }).click();
  await page.locator('.outline-list button', { hasText: 'Writing' }).waitFor();
  await page.locator('.outline-list button', { hasText: 'Writing' }).click();
  checks.push('outline navigation');

  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const searchInput = page.locator('.sidebar-search').first();
  await searchInput.fill('Searchable');
  await page.locator('.cm-search-hit').waitFor();
  checks.push('search highlighting');

  await sourceMode.click();
  await sourceEditor.waitFor();
  if (!(await sourceEditor.textContent())?.includes('Searchable Markit text.')) throw new Error('Source changed during live/source mode round-trip.');
  checks.push('source/live round-trip');

  await previewMode.click();
  const liveEditor = liveContent;
  await liveEditor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('**typed bold**');
  await page.locator('.cm-live-strong', { hasText: 'typed bold' }).waitFor();
  if (!(await page.locator('.cm-live-strong', { hasText: 'typed bold' }).locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " cm-line ")][1]').innerText()).includes('**typed bold**')) {
    throw new Error('Typing at the end of bold text should reveal its Markdown markers.');
  }
  await page.keyboard.press('Enter');
  await page.keyboard.type('*typed italic*');
  await page.locator('.cm-live-emphasis', { hasText: 'typed italic' }).waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('`typed code`');
  await page.locator('.cm-live-inline-code', { hasText: 'typed code' }).waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('~~typed strike~~');
  await page.locator('.cm-live-strikethrough', { hasText: 'typed strike' }).waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('[typed link](https://example.com)');
  await page.locator('.cm-live-link', { hasText: 'typed link' }).waitFor();
  await page.locator('.cm-live-link', { hasText: 'typed link' }).click({ modifiers: ['Control'] });
  await page.waitForFunction(() => window.openedExternalUrls?.includes('https://example.com/'));
  checks.push('live preview opens safe external links with Ctrl+click');
  await sourceMode.click();
  const formattedSource = await sourceEditor.innerText();
  if (formattedSource !== '**typed bold**\n*typed italic*\n`typed code`\n~~typed strike~~\n[typed link](https://example.com)') {
    throw new Error(`Preview editing changed the Markdown source: ${formattedSource}`);
  }
  await previewMode.click();
  await liveEditor.click();
  checks.push('live formatting keeps exact Markdown source');

  await page.keyboard.press('Control+A');
  await page.keyboard.type('```ts\nconst answer: number = 42;\n```');
  const highlightedCode = liveEditor.locator('.cm-line').filter({ hasText: 'const answer' });
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-live-code-block span')].some(span => span.textContent === 'const'));
  if (await highlightedCode.locator('span').count() < 3) throw new Error('Fenced TypeScript code did not receive syntax highlighting.');
  checks.push('fenced TypeScript syntax highlighting');
  for (const { fence, code } of [
    { fence: 'python', code: 'def answer():\n    return 42' },
    { fence: 'rust', code: 'fn answer() -> i32 { 42 }' },
    { fence: 'json', code: '{"answer": 42}' },
    { fence: 'yaml', code: 'answer: true' },
    { fence: 'sql', code: 'SELECT id FROM items;' },
    { fence: 'bash', code: 'echo "$HOME"' },
  ]) {
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`\`\`\`${fence}\n${code}\n\`\`\``);
    const codeLine = liveEditor.locator('.cm-line.cm-live-code-block').first();
    await codeLine.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.cm-live-code-block span')].length >= 2);
    checks.push(`fenced ${fence} syntax highlighting`);
  }

  await page.keyboard.press('Control+A');
  await page.keyboard.type('hotkey');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+B');
  await page.locator('.cm-live-strong', { hasText: 'hotkey' }).waitFor();
  await sourceMode.click();
  if ((await sourceEditor.innerText()) !== '**hotkey**') throw new Error('Ctrl+B did not insert Markdown bold syntax.');
  await previewMode.click();
  await liveEditor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('link text');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+K');
  await page.locator('.link-editor-modal').waitFor();
  await page.locator('.link-editor-field input').fill('https://example.com');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await page.locator('.cm-live-link', { hasText: 'link text' }).waitFor();
  await sourceMode.click();
  if ((await sourceEditor.innerText()) !== '[link text](https://example.com)') throw new Error('Link editing did not write Markdown source.');
  await previewMode.click();
  await liveEditor.click();

  await page.keyboard.press('Control+A');
  await page.keyboard.type('****typed strong****');
  await page.locator('.cm-live-strong', { hasText: 'typed strong' }).first().waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('*****typed combined*****');
  await page.locator('.cm-live-strong', { hasText: 'typed combined' }).first().waitFor();
  await page.locator('.cm-live-emphasis', { hasText: 'typed combined' }).first().waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('~~~~typed strike~~~~');
  await page.locator('.cm-live-strikethrough', { hasText: 'typed strike' }).waitFor();
  await sourceMode.click();
  if ((await sourceEditor.innerText()) !== '~~~~typed strike~~~~') throw new Error('Long strikethrough preview changed the source.');
  await previewMode.click();
  await liveEditor.click();

  await page.keyboard.press('Control+A');
  await page.keyboard.type('# typed heading');
  await page.locator('.cm-line.cm-live-heading-1', { hasText: 'typed heading' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('- typed list');
  await page.locator('.cm-line.cm-live-list-item', { hasText: 'typed list' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('> typed quote');
  await page.locator('.cm-line.cm-live-blockquote', { hasText: 'typed quote' }).waitFor();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('| Name | Value |\n| :--- | ---: |\n| **one** | `two` |\n| three \\| and | four |\n| short |\n');
  const renderedTable = page.locator('.cm-live-rendered-table');
  await renderedTable.waitFor();
  if (await renderedTable.locator('thead th').count() !== 2 || await renderedTable.locator('tbody td').count() !== 6) {
    throw new Error('The GFM table did not render its header and body cells.');
  }
  if ((await renderedTable.locator('tbody').innerText()) !== 'one\ttwo\nthree | and\tfour\nshort\t') throw new Error(`Rendered table cell contents changed: ${await renderedTable.locator('tbody').innerText()}`);
  const renderedCells = renderedTable.locator('tbody td');
  if (await renderedCells.nth(5).textContent() !== '') throw new Error('Short GFM rows should render blank cells up to the header column count.');
  if (await renderedCells.nth(0).locator('strong').count() !== 1 || await renderedCells.nth(1).locator('code').count() !== 1) {
    throw new Error('Inline Markdown formatting was not rendered inside table cells.');
  }
  await renderedCells.nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '在下方插入行' }).waitFor();
  await page.keyboard.press('Escape');
  if (await page.locator('.cm-live-table-menu').count()) throw new Error('The table menu did not close with Escape.');
  await renderedCells.nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '在下方插入行' }).click();
  await sourceMode.click();
  const insertedTableSource = await sourceEditor.innerText();
  if (!insertedTableSource.includes('| **one** | `two` |\n|  |  |\n| three \\| and | four |')) {
    throw new Error(`The table menu did not insert a row below the selected row: ${insertedTableSource}`);
  }

  const tableFixture = '| A | B |\n| :--- | ---: |\n| one | two |\n| three | four |\n';
  async function restoreTableFixture() {
    if (!(await sourceEditor.isVisible())) await sourceMode.click();
    await sourceEditor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(tableFixture);
    const sourceAfterReset = await sourceEditor.innerText();
    await previewMode.click();
    try {
      await renderedTable.waitFor({ timeout: 5000 });
    } catch {
      const diagnostic = await page.evaluate(() => ({
        source: document.querySelector('.source-editor-column .cm-content')?.textContent,
        liveTableCount: document.querySelectorAll('.cm-live-rendered-table').length,
        selectedMode: document.querySelector('.status-mode-option.selected')?.getAttribute('aria-label'),
      }));
      throw new Error(`Table fixture did not render after reset: ${JSON.stringify({ sourceAfterReset, ...diagnostic })}`);
    }
  }
  async function applyTableMenuAction(row, column, label, expected) {
    const targetRow = row === 'header' ? renderedTable.locator('thead tr') : renderedTable.locator('tbody tr').nth(row);
    await targetRow.locator(row === 'header' ? 'th' : 'td').nth(column).click({ button: 'right' });
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await sourceMode.click();
    const actual = (await sourceEditor.innerText()).trimEnd();
    if (actual !== expected) throw new Error(`Table action "${label}" wrote unexpected Markdown:\n${actual}`);
    checks.push(`table context menu: ${label}`);
    await previewMode.click();
  }
  await restoreTableFixture();
  await applyTableMenuAction(1, 0, '在上方插入行', '| A | B |\n| :--- | ---: |\n| one | two |\n|  |  |\n| three | four |');
  await restoreTableFixture();
  await applyTableMenuAction(1, 0, '删除行', '| A | B |\n| :--- | ---: |\n| one | two |');
  await restoreTableFixture();
  await applyTableMenuAction(0, 1, '在左侧插入列', '| A | Column 2 | B |\n| :--- | --- | ---: |\n| one |  | two |\n| three |  | four |');
  await restoreTableFixture();
  await applyTableMenuAction(0, 0, '在右侧插入列', '| A | Column 2 | B |\n| :--- | --- | ---: |\n| one |  | two |\n| three |  | four |');
  await restoreTableFixture();
  await applyTableMenuAction(0, 1, '删除列', '| A |\n| :--- |\n| one |\n| three |');
  await restoreTableFixture();
  await applyTableMenuAction('header', 0, '删除行', '| one | two |\n| :--- | ---: |\n| three | four |');

  await sourceMode.click();
  await sourceEditor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('| Name | Value |\n| :--- | ---: |\n| **one** | `two` |\n| three \\| and | four |\n| short |\n');
  await previewMode.click();
  await renderedTable.waitFor();
  if (await renderedCells.nth(0).evaluate(element => getComputedStyle(element).textAlign) !== 'left'
    || await renderedCells.nth(1).evaluate(element => getComputedStyle(element).textAlign) !== 'right') {
    throw new Error('GFM column alignment was not preserved in the rendered table.');
  }
  await renderedCells.last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await sourceMode.click();
  const markdownFeaturesSource = await sourceEditor.innerText();
  if (markdownFeaturesSource.trimEnd() !== '| Name | Value |\n| :--- | ---: |\n| **one** | `two` |\n| three \\| and | four |\n| short |\n|  |  |') {
    throw new Error(`Preview table editing changed the Markdown source: ${markdownFeaturesSource}`);
  }
  await previewMode.click();
  await liveEditor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('---');
  await page.keyboard.press('Enter');
  await sourceMode.click();
  if (!(await sourceEditor.innerText()).includes('---')) throw new Error('Preview editing lost the horizontal rule source.');
  checks.push('live heading, list, quote, rendered table editing, inline marks and source preservation');

  if (await page.locator('.statusbar').count() !== 1) throw new Error('Expected one visible status bar.');

  await page.locator('.new-tab').click();
  await page.locator('.live-editor-column .cm-content').click();
  await page.keyboard.type('Second tab text');
  await page.keyboard.press('Control+Z');
  if ((await page.locator('.cm-content').innerText()).includes('Second tab text')) throw new Error('Undo did not revert preview-mode editing.');
  await page.keyboard.press('Control+Shift+Z');
  if (!(await page.locator('.cm-content').innerText()).includes('Second tab text')) throw new Error('Redo did not restore preview-mode editing.');
  await page.locator('.document-tab').first().click();
  if (!(await page.locator('.cm-content').innerText()).includes('---')) throw new Error('Switching tabs lost the first document state.');
  await page.locator('.document-tab').nth(1).click();
  if (!(await page.locator('.cm-content').innerText()).includes('Second tab text')) throw new Error('Switching tabs lost the second document state.');
  await page.locator('.document-tab').first().click();
  await page.locator('.document-tab').nth(1).locator('.tab-close').click();
  await page.getByRole('button', { name: '丢弃修改', exact: true }).click();
  checks.push('per-document editor and undo state');

  await page.locator('.document-tab .tab-close').first().click();
  await page.locator('[data-testid="close-confirm"]').waitFor();
  if (await page.locator('.document-tab').count() !== 1) throw new Error('Dirty document closed before confirmation.');
  await page.getByRole('button', { name: '取消', exact: true }).last().click();
  if (await page.locator('[data-testid="close-confirm"]').count() !== 0) throw new Error('Close confirmation did not close after cancellation.');
  await page.locator('.document-tab .tab-close').first().click();
  await page.getByRole('button', { name: '丢弃修改', exact: true }).click();
  await page.locator('.empty-state').waitFor();
  checks.push('dirty document close confirmation');

  await page.locator('.menu-trigger').click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const readingWidth = page.getByRole('slider', { name: '阅读宽度' });
  if (await readingWidth.getAttribute('value') !== '1120') throw new Error('The default reading width should be 1120px.');
  await readingWidth.focus();
  await page.keyboard.press('End');
  const readingWidthValue = await readingWidth.getAttribute('value');
  const readingWidthStored = await page.evaluate(() => localStorage.getItem('markit.editorWidth'));
  const readingWidthCss = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--editor-width').trim());
  if (readingWidthValue !== '1600' || readingWidthStored !== '1600' || readingWidthCss !== '1600px') {
    throw new Error(`Reading width did not update and persist: value=${readingWidthValue}, stored=${readingWidthStored}, css=${readingWidthCss}`);
  }
  await page.locator('.settings-modal').getByRole('button', { name: 'Close' }).click();
  await page.locator('.empty-state .primary-command').click();
  await page.locator('.status-mode-option[aria-label="预览"]').click();
  const liveColumnWidth = await page.locator('.live-editor-column').evaluate(element => element.getBoundingClientRect().width);
  if (liveColumnWidth < 900) throw new Error(`The wider reading-width setting did not expand the live editor: ${liveColumnWidth}px`);
  const liveScrollMode = await page.locator('.live-editor-column .cm-scroller').evaluate(element => getComputedStyle(element).overflowY);
  if (liveScrollMode !== 'visible') throw new Error(`Live preview should flow with the main document instead of scrolling in an inner viewport: ${liveScrollMode}`);
  checks.push('reading width setting updates, applies and persists');
  checks.push('live preview uses the main document scroll instead of an inner editor viewport');

  await checkLiveSelection(page);
  checks.push('stable forward, backward and vertical keyboard selection; hidden syntax navigation; source editing and undo');

  await checkLivePointer(page);
  checks.push('precise mouse placement around all heading levels, inline formatting and long links; drag and double-click selection');

  if (errors.length) throw new Error(`Frontend console errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ status: 'passed', checks }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', checks, errors, error: String(error), serverOutput }));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  server.kill('SIGTERM');
}
