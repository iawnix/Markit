import assert from 'node:assert/strict';

function luminance(rgb) {
  const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(value => {
    const channel = Number(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

async function colors(locator, pseudo = null) {
  return locator.first().evaluate(async (element, pseudo) => {
    // Measure the settled palette after a theme or hover transition.
    await Promise.all(element.getAnimations()
      .filter(animation => animation instanceof CSSTransition)
      .map(animation => animation.finished.catch(() => undefined)));
    const style = getComputedStyle(element, pseudo);
    let background = style.backgroundColor;
    for (let parent = element; /^(transparent|rgba\([^)]*, 0\))$/.test(background) && parent; parent = parent.parentElement) {
      background = getComputedStyle(parent).backgroundColor;
    }
    return { foreground: style.color, background };
  }, pseudo);
}

export async function checkEditorColors(page) {
  const content = page.locator('.cm-content');
  const sourceMode = page.locator('.status-mode-option[aria-label="源码"]');
  const previewMode = page.locator('.status-mode-option[aria-label="预览"]');
  const source = '# 清晰的写作\n\n正文 **重点内容** and `settings.json`.\n\n[参考资料](https://example.com)\n\n> 引用仍然清晰\n\n公式 $x^2$\n\n```ts\n// Reading time\nfunction readingTime(words: number) {\n  const speed = 300;\n  return "约 " + words / speed;\n}\n```\n';
  const setTheme = async theme => {
    await page.locator('.menu-trigger').click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('.settings-row select').selectOption(theme);
    await page.locator('.settings-modal').getByRole('button', { name: 'Close' }).click();
  };
  const assertContrast = async (selector, minimum = 4.5, pseudo = null) => {
    const value = await colors(page.locator(selector), pseudo);
    const ratio = contrast(value.foreground, value.background);
    assert.ok(ratio >= minimum, `${selector}${pseudo || ''}: contrast ${ratio.toFixed(2)}:1 (${JSON.stringify(value)})`);
    return value.foreground;
  };

  await sourceMode.click();
  await content.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
  await page.keyboard.press('Control+Home');
  await page.locator('.cm-syntax-function', { hasText: 'readingTime' }).waitFor();
  const palettes = {};
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    palettes[theme] = {};
    for (const mode of ['source', 'live']) {
      await (mode === 'source' ? sourceMode : previewMode).click();
      await content.focus();
      await page.keyboard.press('Control+Home');
      palettes[theme][mode] = {};
      await assertContrast('.cm-content', 7);
      for (const kind of ['heading', 'marker', 'comment', 'text', 'keyword', 'string', 'number', 'type', 'function']) {
        palettes[theme][mode][kind] = await assertContrast(`.cm-syntax-${kind}`);
      }
      await assertContrast('.cm-syntax-keyword', 4.5, '::selection');
      await assertContrast('.menu-trigger');
      await assertContrast('.statusbar');
      if (mode === 'source') await assertContrast('.cm-syntax-url');
      else {
        await assertContrast('.cm-live-link');
        await assertContrast('.cm-live-inline-code');
        await assertContrast('.cm-live-blockquote');
        await assertContrast('.cm-live-math-inline');
      }
    }

    // Search must override nested syntax colors, not just paint a background.
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.locator('.sidebar-search').first().fill('return');
    await page.locator('.cm-search-hit').waitFor();
    await assertContrast('.cm-search-hit');
    const nested = page.locator('.cm-search-hit .cm-syntax-keyword');
    if (await nested.count()) {
      const match = await colors(nested);
      assert.ok(contrast(match.foreground, match.background) >= 4.5, 'Nested search match must remain legible');
    }
    await page.locator('.sidebar-search').first().fill('');
    await sourceMode.click();
    assert.equal((await content.locator('.cm-line').allTextContents()).join('\n'), source, 'Theme switching must preserve Markdown');
  }
  assert.notDeepEqual(palettes.dark, palettes.light, 'Syntax colors must change with the theme');

  await content.focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const selected = await page.evaluate(() => getSelection().toString());
  await setTheme('system');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await content.focus();
    assert.equal(await page.evaluate(() => getSelection().toString()), selected, 'System appearance changes must preserve the selection');
    assert.equal((await colors(page.locator('.cm-syntax-keyword'))).foreground, palettes[scheme].source.keyword, 'System appearance must use the matching syntax palette');
  }
  // Dark screen colors must not leak into the white print canvas.
  await setTheme('dark');
  await previewMode.click();
  await page.emulateMedia({ media: 'print' });
  await assertContrast('.cm-syntax-keyword');
  await assertContrast('.cm-syntax-marker');
  await assertContrast('.cm-content', 7);
  await page.emulateMedia({ media: 'screen' });
  await sourceMode.click();
  await content.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('undo-check');
  await setTheme('light');
  await content.focus();
  await page.keyboard.press('Control+Z');
  assert.equal((await content.locator('.cm-line').allTextContents()).join('\n'), source, 'Changing appearance must preserve undo history');
}
