import {expect, test} from '@playwright/test';

test.use({viewport: {width: 1440, height: 1000}});

test('filter panel reversals preserve the cards and their current visible positions', async ({page}) => {
  await page.goto('/');
  const grid = page.locator('.posts-grid');
  await expect(grid).toHaveAttribute('data-layout-ready', 'true');
  await grid.evaluate(async node => { await Promise.all(node.getAnimations({subtree: true}).map(a => a.finished.catch(() => {}))); });
  const card = page.locator('.post-card').first();
  const original = await card.elementHandle();
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.closest('.posts-grid')) { animation.pause(); animation.currentTime = 0; }
      return animation;
    };
  });
  const toggle = page.getByRole('button', {name: 'Filtres avancés', exact: true});
  const before = (await card.boundingBox())!;
  await toggle.evaluate(button => (button as HTMLButtonElement).click());
  await expect.poll(() => grid.evaluate(node => node.getAnimations({subtree: true}).length)).toBeGreaterThan(0);
  expect(Math.abs((await card.boundingBox())!.x - before.x)).toBeLessThan(2);
  await grid.evaluate(node => node.getAnimations({subtree: true}).forEach(a => { a.currentTime = Number(a.effect!.getTiming().duration) * .3; }));
  const middle = (await card.boundingBox())!;
  await toggle.evaluate(button => (button as HTMLButtonElement).click());
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(Math.abs((await card.boundingBox())!.x - middle.x)).toBeLessThan(2);
  expect(await card.evaluate((node, old) => node === old, original)).toBe(true);
  await grid.evaluate(node => node.getAnimations({subtree: true}).forEach(a => a.finish()));
  await expect.poll(() => grid.evaluate(node => node.getAnimations({subtree: true}).length)).toBe(0);
});

test('Discovery and post navigation restore the opener without scrolling the library', async ({page}) => {
  await page.goto('/');
  const grid = page.locator('.posts-grid');
  await expect(grid).toHaveAttribute('data-layout-ready', 'true');
  const payload = await (await page.request.get('/api/posts?limit=1')).json();
  const discovered = {...payload.items[0], id: 'desktop-discovery', publishedAt: '1990-01-01T00:00:00Z', savedAt: null};
  await page.route('**/api/posts?**', async route => {
    if (new URL(route.request().url()).searchParams.get('random') === '1') return route.fulfill({json: {item: discovered}});
    await route.continue();
  });
  await page.route('**/api/posts/desktop-discovery', route => route.fulfill({json: discovered}));
  const discovery = page.getByRole('button', {name: 'Découverte', exact: true});
  await discovery.click();
  const dialog = page.locator('.detail-dialog');
  await expect(dialog).toBeVisible();
  await expect.soft.poll(() => dialog.evaluate(node => {
    const box = node.getBoundingClientRect();
    return Math.max(Math.abs(box.x + box.width / 2 - innerWidth / 2), Math.abs(box.y + box.height / 2 - innerHeight / 2));
  })).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.soft.poll(() => page.evaluate(() => scrollY)).toBeLessThan(2);
  await expect.soft(discovery).toBeFocused();

  // After navigating, return to the card that opened the dialog, not the last post.
  const opener = page.locator('.post-card-button').nth(7);
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  const scroll = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Suivant', exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - scroll)).toBeLessThan(2);
});
