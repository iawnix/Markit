import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export async function checkWindowClose(browser, url) {
  const { permissions } = JSON.parse(readFileSync(new URL('../apps/desktop/src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  const scenarios = ['empty', 'saved', 'cancel', 'discard', 'save', 'save-cancel', 'save-error', 'close-error', 'destroy-error'];
  for (const scenario of scenarios) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(({ permissions, scenario }) => {
        localStorage.setItem('markit.locale', 'en');
        const callbacks = new Map();
        const listeners = new Map();
        let nextId = 0;
        window.closeTest = { destroyed: 0, saved: [], failures: [], closeRequests: 0 };
        const revision = { hash: 'saved', size: 5, modifiedMs: 1 };
        const dirty = !['empty', 'saved', 'close-error'].includes(scenario);
        const documents = scenario === 'empty' || scenario === 'close-error' ? [] : Array.from({ length: scenario === 'save' ? 2 : 1 }, (_, index) => ({
          id: `document-${index}`, path: scenario === 'save-cancel' ? null : `/workspace/note-${index}.md`, title: `Note ${index}`,
          source: dirty ? 'Edited note' : 'Saved note', savedSource: 'Saved note', dirty, revision,
          bom: false, lineEnding: 'LF', mode: 'source', selection: { anchor: 0, head: 0 }, scrollTop: 0,
        }));
        window.confirm = () => true;
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => listeners.delete(id) };
        window.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          transformCallback(callback) { const id = ++nextId; callbacks.set(id, callback); return id; },
          unregisterCallback(id) { callbacks.delete(id); },
          async invoke(command, args = {}) {
            if (command === 'plugin:event|listen') { const id = ++nextId; listeners.set(id, args); return id; }
            if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
            if (command === 'plugin:window|close' || command === 'plugin:window|destroy') {
              const action = command.split('|')[1];
              if (!permissions.includes(`core:window:allow-${action}`)) {
                const error = `Window permission denied: ${action}`;
                window.closeTest.failures.push(error);
                throw new Error(error);
              }
              if (scenario === `${action}-error`) throw new Error(`${action} failed`);
              if (action === 'destroy') { window.closeTest.destroyed++; return; }
              window.closeTest.closeRequests++;
              for (const [id, listener] of listeners) {
                if (listener.event === 'tauri://close-requested') await callbacks.get(listener.handler)({ event: listener.event, id, payload: null });
              }
              return;
            }
            if (command === 'read_recovery') return documents;
            if (command === 'extract_outline' || command === 'list_directory') return [];
            if (command === 'get_file_revision') return revision;
            if (command === 'save_document') {
              if (scenario === 'save-error') throw new Error('Save failed');
              window.closeTest.saved.push(args.path);
              return revision;
            }
            if (command === 'plugin:dialog|save') return null;
            if (command === 'plugin:window|inner_size') return { width: 1280, height: 800 };
            if (command === 'plugin:window|outer_position') return { x: 0, y: 0 };
            if (command === 'plugin:window|is_maximized' || command === 'plugin:window|is_fullscreen') return false;
            return null;
          },
        };
      }, { permissions, scenario });
      await page.goto(url, { waitUntil: 'networkidle' });
      if (!['empty', 'close-error'].includes(scenario)) await page.locator('.source-editor-column .cm-content').waitFor();
      await page.locator('.window-control-close svg').click();
      const dialog = page.getByTestId('close-confirm');
      if (!['empty', 'saved', 'close-error'].includes(scenario)) {
        await dialog.waitFor();
        assert.equal(await page.evaluate(() => window.closeTest.destroyed), 0, `${scenario}: closed before confirmation`);
        const label = scenario === 'cancel' ? 'Cancel' : ['discard', 'destroy-error'].includes(scenario) ? 'Discard changes' : 'Save and close';
        await dialog.locator('footer').getByRole('button', { name: label, exact: true }).click();
        if (scenario === 'save-cancel') await dialog.waitFor();
      }
      if (scenario.endsWith('-error')) await page.getByRole('alert').waitFor();
      const closes = ['empty', 'saved', 'discard', 'save'].includes(scenario);
      if (closes) await page.waitForFunction(() => window.closeTest.destroyed > 0);
      const result = await page.evaluate(() => window.closeTest);
      assert.equal(result.destroyed, closes ? 1 : 0, `${scenario}: window destruction count`);
      assert.equal(result.saved.length, scenario === 'save' ? 2 : 0, `${scenario}: saved documents`);
      assert.deepEqual(result.failures, [], `${scenario}: missing runtime permission`);
      assert.deepEqual(errors, [], `${scenario}: browser errors`);
    } finally { await page.close(); }
  }
}
