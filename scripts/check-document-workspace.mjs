import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

export async function checkDocumentWorkspace(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('workspace.fixture')) { localStorage.clear(); localStorage.setItem('workspace.fixture', '1'); }
    localStorage.setItem('markit.locale', 'en');
    const fixture = window.workspaceTest = { pendingPaths: ['/standalone/first.md'], dialogs: [], calls: [], imports: [], copies: [], exports: [], deferImport: false, failCopy: false, saved: [] };
    const png = [...Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))];
    const revision = { hash: 'original', size: 5, modifiedMs: 1 };
    let nextId = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback() { return ++nextId; }, unregisterCallback() {},
      async invoke(command, args = {}) {
        fixture.calls.push({ command, args });
        if (command === 'plugin:event|listen') return ++nextId;
        if (command === 'read_recovery') return [];
        if (command === 'take_open_paths') return fixture.pendingPaths.splice(0);
        if (command === 'extract_outline') return [];
        if (command === 'plugin:dialog|open' || command === 'plugin:dialog|save') return fixture.dialogs.shift() ?? null;
        if (command === 'read_document') return { id: args.path, path: args.path, title: args.path.split('/').at(-1), source: 'Before\n\nAfter\n', savedSource: 'Before\n\nAfter\n', dirty: false, revision, bom: false, lineEnding: 'LF', mode: 'source', selection: { anchor: 0, head: 0 }, scrollTop: 0 };
        if (command === 'get_file_revision') return revision;
        if (command === 'save_document') { fixture.saved.push(args); return revision; }
        if (command === 'save_document_copy') { if (fixture.failCopy) throw new Error('Copy failed'); fixture.copies.push(args); return revision; }
        if (command === 'read_image') return { name: 'shared.png', bytes: png, mime: 'image/png' };
        if (command === 'register_asset') {
          if (args.relativePath.startsWith('../') && !args.roots?.includes('/project')) throw new Error('Image access requires choosing its containing folder');
          return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
        }
        if (command === 'import_images') {
          fixture.imports.push(args);
          if (fixture.deferImport) await new Promise(resolve => { fixture.finishImport = resolve; });
          return [`${args.folder}/image.png`];
        }
        if (command === 'export_html' || command === 'export_zip') { fixture.exports.push({ command, ...args }); return; }
        if (command === 'list_directory') {
          if (args.path === '/project') return [{ name: 'docs', path: '/project/docs', directory: true }, { name: 'assets', path: '/project/assets', directory: true }, { name: 'README.md', path: '/project/README.md', directory: false }];
          if (args.path === '/project/docs') return [{ name: 'note.md', path: '/project/docs/note.md', directory: false }];
          if (args.path === '/project/assets') return [{ name: 'shared.png', path: '/project/assets/shared.png', directory: false }];
          return [];
        }
        if (command === 'plugin:window|inner_size') return { width: 1280, height: 900 };
        if (command === 'plugin:window|outer_position') return { x: 0, y: 0 };
        if (command === 'plugin:window|is_maximized' || command === 'plugin:window|is_fullscreen') return false;
        return null;
      },
    };
  });
  const openPath = async path => {
    await page.evaluate(path => window.dispatchEvent(new CustomEvent('markit:open-path', { detail: path })), path);
    await page.locator('.document-tab.active').filter({ hasText: path.split('/').at(-1) }).waitFor();
  };
  const dialog = value => page.evaluate(value => window.workspaceTest.dialogs.push(value), value);
  const menu = async name => { await page.locator('.menu-trigger').click(); await page.locator('.command-menu').getByRole('button', { name, exact: true }).click(); };
  const edit = async text => {
    await page.locator('.status-mode-option[aria-label="Source"]').click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
  };
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('.document-tab.active', { hasText: 'first.md' }).waitFor();
    assert.equal(await page.locator('.document-tab').count(), 1);
    assert.equal(await page.locator('.project-files').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('markit.projectRoot')), null);
    assert.equal(await page.evaluate(() => window.workspaceTest.calls.filter(call => call.command === 'list_directory').length), 0);

    await dialog('/project');
    await page.getByRole('button', { name: 'Open folder…', exact: true }).click();
    await page.locator('.project-files .workspace-path', { hasText: '/project' }).waitFor();
    await page.locator('.project-files').getByRole('button', { name: 'docs', exact: true }).click();
    await page.locator('.project-files').getByRole('button', { name: 'note.md', exact: true }).click();
    await page.locator('.document-tab.active', { hasText: 'note.md' }).waitFor();
    await openPath('/elsewhere/other.md');
    assert.equal(await page.locator('.workspace-path').innerText(), '/project');
    await page.getByRole('button', { name: 'Close project', exact: true }).click();
    assert.equal(await page.locator('.project-files').count(), 0);
    assert.equal(await page.locator('.document-tab').count(), 3);

    await page.locator('.new-tab').click();
    await edit('alpha\nomega');
    const input = page.locator('input[type="file"][accept="image/*"]');
    const image = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) };
    await input.setInputFiles(image);
    await page.waitForFunction(() => window.workspaceTest.calls.some(call => call.command === 'plugin:dialog|save'));
    assert.equal(await page.evaluate(() => window.workspaceTest.imports.length), 0);
    assert.equal(await page.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n')), 'alpha\nomega');

    await dialog('/notes/旅行笔记.md');
    await page.evaluate(() => { window.workspaceTest.deferImport = true; });
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await input.setInputFiles(image);
    await page.waitForFunction(() => Boolean(window.workspaceTest.finishImport));
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('X');
    await page.locator('.document-tab', { hasText: 'first.md' }).click();
    await page.evaluate(() => window.workspaceTest.finishImport());
    await page.waitForFunction(() => window.workspaceTest.calls.some(call => call.command === 'write_recovery' && call.args.documents.some(doc => doc.path === '/notes/旅行笔记.md' && doc.source.includes('![]'))));
    assert.equal(await page.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n')), 'Before\n\nAfter\n');
    await page.locator('.document-tab', { hasText: '旅行笔记.md' }).click();
    const source = await page.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n'));
    assert.match(source, /^Xa\n!\[\]\(<%E6%97%85%E8%A1%8C%E7%AC%94%E8%AE%B0.assets\/image.png>\)\nlpha\nomega$/);
    assert.equal(await page.evaluate(() => window.workspaceTest.imports[0].folder), '旅行笔记.assets');
    assert.equal(await page.evaluate(() => window.workspaceTest.saved[0].path), '/notes/旅行笔记.md');
    assert.equal(await page.locator('.project-files').count(), 0);

    await edit('![shared][pic]\n\n[pic]: ../assets/shared.png "caption"\n\n[keep](other.md)');
    await page.locator('.image-notice').waitFor();
    await dialog('/project');
    await page.getByRole('button', { name: 'Allow image folder…' }).click();
    await page.locator('.image-notice').waitFor({ state: 'hidden' });
    await dialog('/copy/副本.md');
    await page.evaluate(() => { window.workspaceTest.failCopy = true; });
    await menu('Save as…');
    await page.getByRole('alert').waitFor();
    assert.match(await page.locator('.document-tab.active').innerText(), /旅行笔记.md/);
    await page.evaluate(() => { window.workspaceTest.failCopy = false; });
    await dialog('/copy/副本.md');
    await menu('Save as…');
    await page.locator('.document-tab.active', { hasText: '副本.md' }).waitFor();
    const copy = await page.evaluate(() => window.workspaceTest.copies[0]);
    assert.equal(copy.assets.length, 1);
    assert.match(copy.assets[0].relativePath, /^副本.assets\//);
    assert.match(copy.source, /!\[shared\]\(<%E5%89%AF%E6%9C%AC.assets\/.*> "caption"\)/);
    assert.match(copy.source, /\[keep\]\(other.md\)/);
    assert.equal(copy.path, '/copy/副本.md');

    await dialog('/export/document.html');
    await menu('Export HTML');
    await page.waitForFunction(() => window.workspaceTest.exports.some(item => item.command === 'export_html'));
    const html = await page.evaluate(() => window.workspaceTest.exports.find(item => item.command === 'export_html').html);
    assert.match(html, /src="data:image\/png;base64,/);
    await dialog('/export/document.zip');
    await menu('Export ZIP bundle');
    await page.waitForFunction(() => window.workspaceTest.exports.some(item => item.command === 'export_zip'));
    const bytes = await page.evaluate(() => window.workspaceTest.exports.find(item => item.command === 'export_zip').bytes);
    const files = unzipSync(new Uint8Array(bytes));
    assert.equal(Object.keys(files).length, 2);
    assert.ok(files['副本.md']);
    assert.match(strFromU8(files['副本.md']), /副本.assets|%E5%89%AF%E6%9C%AC.assets/);

    await dialog('/project');
    await page.getByRole('button', { name: 'Open folder…', exact: true }).click();
    await page.locator('.project-files').getByRole('button', { name: 'assets', exact: true }).click();
    await page.locator('.project-files').getByRole('button', { name: 'shared.png', exact: true }).click();
    await page.getByRole('dialog', { name: 'Image preview' }).waitFor();
    await page.getByRole('button', { name: 'Insert into document' }).click();
    await page.waitForFunction(() => window.workspaceTest.calls.some(call => call.command === 'register_asset' && call.args.documentPath === '/copy/副本.md' && call.args.relativePath === '../project/assets/shared.png'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.project-files .workspace-path', { hasText: '/project' }).waitFor();
    await page.locator('.project-files').getByRole('button', { name: 'shared.png', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
