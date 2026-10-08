import assert from 'node:assert/strict';

export async function checkLiveSelection(page) {
  const content = page.locator('.cm-content');
  const sourceMode = page.locator('.status-mode-option[aria-label="源码"]');
  const previewMode = page.locator('.status-mode-option[aria-label="预览"]');
  const firstLine = 'Start **bold words** and [link](https://example.com/' + 'long-path/'.repeat(40) + ') end.';
  const source = `${firstLine}\n中文 😀 and $x^2$ here.\nFinal line.`;
  const visibleFirstLine = 'Start bold words and link end.';
  const selected = () => page.evaluate(() => window.getSelection().toString());
  const geometry = () => content.evaluate(element => ({ text: element.innerText, height: element.getBoundingClientRect().height }));
  const settle = () => page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const press = async (key, count) => {
    for (let index = 0; index < count; index++) await page.keyboard.press(key);
  };
  const assertStable = async (before, label) => {
    const after = await geometry();
    assert.equal(after.text, before.text, `${label}: selection revealed hidden Markdown`);
    assert.ok(Math.abs(after.height - before.height) < 1, `${label}: selection reflowed the document`);
  };

  await previewMode.click();
  await content.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
  await page.keyboard.press('Control+Home');
  await settle();
  const before = await geometry();
  // One step per visible character, plus one per group of hidden delimiters.
  const firstLineSteps = visibleFirstLine.length + 4;
  await press('Shift+ArrowRight', firstLineSteps);
  assert.equal(await selected(), visibleFirstLine, 'Forward selection should skip the long hidden URL');
  await assertStable(before, 'Forward selection');
  await press('Shift+ArrowLeft', firstLineSteps);
  assert.equal(await selected(), '', 'Shrinking the selection should return to its original anchor');
  await assertStable(before, 'Shrinking selection');

  await page.keyboard.press('Shift+ArrowDown');
  assert.ok((await selected()).startsWith(visibleFirstLine), 'Shift+Down should reach the next visual line');
  await assertStable(before, 'Vertical selection');
  await page.keyboard.press('Shift+ArrowUp');
  assert.equal(await selected(), '', 'Shift+Up should return to the original column');

  await page.keyboard.press('End');
  const reverseLine = await geometry();
  await press('Shift+ArrowLeft', firstLineSteps);
  assert.equal(await selected(), visibleFirstLine, 'Backward selection should skip the long hidden URL');
  await assertStable(reverseLine, 'Backward line selection');

  await page.keyboard.press('Control+End');
  const backward = await geometry();
  await page.keyboard.press('Control+Shift+Home');
  await assertStable(backward, 'Backward document selection');
  assert.ok((await selected()).includes('中文 😀'), 'Selection should preserve Unicode text');
  // Shrinking a range back through a rendered formula must skip its source as one unit.
  await press('Shift+ArrowRight', firstLineSteps + 1 + 7);
  const beforeMath = await selected();
  await page.keyboard.press('Shift+ArrowRight');
  const afterMath = await selected();
  assert.notEqual(afterMath, beforeMath, 'Arrow selection should move across the rendered formula');
  await assertStable(backward, 'Selection across math');

  await sourceMode.click();
  assert.equal(await content.innerText(), source, 'Selection must not change the Markdown source');
  await content.focus();
  await page.keyboard.press('Control+Home');
  await press('Shift+ArrowRight', 9);
  assert.equal(await selected(), 'Start **b', 'Source mode must allow selecting individual Markdown characters');

  await previewMode.click();
  await content.focus();
  await page.keyboard.press('Control+Home');
  await press('Shift+ArrowRight', 8);
  assert.equal(await selected(), 'Start b');
  await page.keyboard.press('ArrowRight');
  assert.ok((await content.innerText()).includes('**bold words**'), 'Collapsing the range must restore syntax editing at the caret');
  await page.keyboard.insertText('X');
  await sourceMode.click();
  assert.equal(await content.innerText(), source.replace('bold', 'bXold'), 'Typing after selection must edit the intended source position');
  await content.focus();
  await page.keyboard.press('Control+Z');
  assert.equal(await content.innerText(), source, 'Undo must preserve the original Markdown');
}

export async function checkLivePointer(page) {
  const content = page.locator('.cm-content');
  const sourceMode = page.locator('.status-mode-option[aria-label="源码"]');
  const previewMode = page.locator('.status-mode-option[aria-label="预览"]');
  const source = 'Anchor\n\n' + Array.from({ length: 6 }, (_, index) => `${'#'.repeat(index + 1)} Heading${index + 1}\n\nParagraph${index + 1} ordinary text.\n\n`).join('')
    + 'Before **boldtarget** and `codetarget` after.\n\n'
    + '[linktarget](https://example.com/' + 'long-path/'.repeat(40) + ') landingzone.\n\nFinal';
  const settle = () => page.evaluate(async () => {
    await document.fonts.ready;
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
  });
  const pointAt = async (text, offset) => {
    await content.locator('.cm-line').filter({ hasText: text }).scrollIntoViewIfNeeded();
    await settle();
    return content.evaluate((element, { text, offset }) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.textContent.indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index + offset);
        range.setEnd(node, index + offset + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 0.1, y: (rect.top + rect.bottom) / 2 };
      }
      throw new Error(`Missing pointer target: ${text}`);
    }, { text, offset });
  };
  const targets = Array.from({ length: 6 }, (_, index) => [`Heading${index + 1}`, `Paragraph${index + 1}`]).flat();
  targets.push('boldtarget', 'codetarget', 'linktarget', 'landingzone');
  const openedBefore = await page.evaluate(() => window.openedExternalUrls?.length || 0);
  for (const target of targets) {
    await sourceMode.click();
    await content.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(source);
    await page.keyboard.press('Control+Home');
    await previewMode.click();
    const point = await pointAt(target, 4);
    await page.mouse.click(point.x, point.y);
    await settle();
    const caret = await page.evaluate(() => {
      const selection = window.getSelection();
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      return { empty: selection.isCollapsed, x: rect.left, y: (rect.top + rect.bottom) / 2 };
    });
    assert.ok(caret.empty && Math.abs(caret.x - point.x) < 2 && Math.abs(caret.y - point.y) < 2,
      `${target}: caret missed the clicked character (${JSON.stringify({ point, caret })})`);
    // Repeating a click must keep the same source position.
    await page.mouse.click(point.x, point.y);
    await page.keyboard.insertText('X');
    await sourceMode.click();
    const position = source.indexOf(target) + 4;
    assert.equal((await content.locator('.cm-line').allTextContents()).join('\n'), source.slice(0, position) + 'X' + source.slice(position), `${target}: typing edited the wrong source position`);
  }
  assert.equal(await page.evaluate(() => window.openedExternalUrls?.length || 0), openedBefore, 'Plain clicks on links must position the caret without opening a browser');

  await previewMode.click();
  const link = await pointAt('linktarget', 4);
  await page.mouse.click(link.x, link.y);
  await page.keyboard.press('ArrowRight');
  assert.ok((await content.innerText()).includes('long-path/'), 'Keyboard navigation should still expose link source for editing');
  await page.keyboard.press('Control+A');
  const outside = await pointAt('Final', 2);
  await page.mouse.click(outside.x, outside.y);
  await settle();
  const outsideCaret = await page.evaluate(() => {
    const selection = window.getSelection();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { empty: selection.isCollapsed, x: rect.left, y: (rect.top + rect.bottom) / 2 };
  });
  assert.ok(outsideCaret.empty && Math.abs(outsideCaret.x - outside.x) < 2 && Math.abs(outsideCaret.y - outside.y) < 2,
    'Clicking outside an existing selection must preserve the clicked visual position');

  const start = await pointAt('boldtarget', 0);
  const end = await pointAt('boldtarget', 8);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), 'boldtarg', 'Dragging from formatted text must retain the clicked range');
  const middle = await pointAt('boldtarget', 4);
  await page.mouse.dblclick(middle.x, middle.y);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), 'boldtarget', 'Double-click should select the visible word');
}
