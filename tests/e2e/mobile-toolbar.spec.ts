import { expect, test, type Page } from "@playwright/test";

// Exercise the narrowest supported phone and the mobile layout breakpoint.
// Explicit viewports run once on the default browser project.
const mobileWidths = [320, 760];

for (const width of mobileWidths) {
  test.describe(`toolbar mobile ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("reste compacte, accessible et sans overflow document", async ({ page }) => {
      await openLibrary(page);

      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const ribbon = page.locator(".control-ribbon");
      const stickyToolbar = page.locator(".mobile-sticky-toolbar");
      const firstPost = page.locator("[data-post-id]").first();
      await expect(ribbon).toBeVisible();
      await expect(stickyToolbar).toBeVisible();
      await expect(firstPost).toBeVisible();
      await expect(page.getByRole('link', { name: 'Places', exact: true })).toBeVisible();

      const compactControls = [
        page.getByRole("button", { name: /Ouvrir les filtres/ }),
        stickyToolbar.getByLabel("Trier les résultats"),
        page.getByRole("button", { name: "Grille régulière" }),
        page.getByRole("button", { name: "Grille masonry" }),
      ];
      for (const control of compactControls) {
        await expect(control).toBeVisible();
        expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }

      await expect(page.locator(".ribbon-end .author-control")).toBeHidden();
      await expect(page.locator(".ribbon-end .year-control")).toBeHidden();
      await expect(page.locator(".ribbon-end .collection-control")).toBeHidden();
      await expect(page.locator(".main-theme-filters")).toHaveCSS("overflow-x", "auto");
      await expect(page.locator(".app-header")).toHaveCSS("position", "static");
      await expect(ribbon).toHaveCSS("position", "static");
      await expect(stickyToolbar).toHaveCSS("position", "sticky");

      const brandBox = await page.locator(".brand").boundingBox();
      const actionsBox = await page.locator(".header-actions").boundingBox();
      expect(brandBox).not.toBeNull();
      expect(actionsBox).not.toBeNull();
      expect(Math.abs(brandBox!.y - actionsBox!.y)).toBeLessThan(10);
      expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(actionsBox!.x);
      expect((await page.locator('.app-header').boundingBox())!.height).toBeLessThan(140);

      await page.evaluate(() => window.scrollTo(0, 700));
      await expect.poll(() => page.locator(".app-header").evaluate((node) => node.getBoundingClientRect().bottom < 0)).toBe(true);
      await expect.poll(() => stickyToolbar.evaluate((node) => Math.abs(node.getBoundingClientRect().top) < 2)).toBe(true);
      await expect.poll(() => page.locator(".main-theme-filters").evaluate((node) => node.getBoundingClientRect().bottom < 0)).toBe(true);

      const ribbonBottom = await ribbon.evaluate((node) => node.getBoundingClientRect().bottom);
      const postTop = await firstPost.evaluate((node) => node.getBoundingClientRect().top);
      expect(postTop - ribbonBottom).toBeLessThanOrEqual(16);
    });

    test("place auteur, année et collection dans le drawer Radix", async ({ page }) => {
      await openLibrary(page);
      const trigger = page.getByRole("button", { name: /Ouvrir les filtres/ });
      await trigger.focus();
      await trigger.click();

      const drawer = page.getByRole("dialog", { name: "Filtres avancés" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("combobox", { name: "Filtrer par auteur dans le drawer" })).toBeVisible();
      await expect(drawer.getByLabel("Filtrer par année dans le drawer")).toBeVisible();
      await expect(drawer.getByLabel("Filtrer par collection dans le drawer")).toBeVisible();

      await drawer.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect(drawer.getByRole('button', { name: 'Fermer les filtres' })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });
}

test.describe("retour visuel des filtres sur mobile", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("respecte la réduction des animations et conserve les commandes de la fiche", async ({ page }, testInfo) => {
    await openLibrary(page);
    await page.screenshot({ path: testInfo.outputPath('mobile-library-light.png') });
    await page.getByRole('button', { name: 'Changer le thème' }).click();
    await page.getByRole('menuitemradio', { name: 'Sombre' }).click();
    await expect(page.getByRole('menu')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('mobile-library-dark.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.post-card').first()).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.post-card-button').first()).toHaveCSS('transition-duration', '0s');
    const card = page.locator('[data-post-id]').first();
    await card.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCSS('animation-name', 'none');
    await dialog.locator('.detail-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(dialog.getByRole('button', { name: 'Fermer le détail' })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('mobile-detail.png') });
    await dialog.getByRole('button', { name: 'Fermer le détail' }).click();
    await expect(card).toBeFocused();
  });

  test("affiche les filtres actifs et permet de les retirer rapidement", async ({ page }) => {
    await openLibrary(page);
    await page.getByRole("button", { name: /Ouvrir les filtres/ }).click();
    const drawer = page.getByRole("dialog", { name: "Filtres avancés" });
    const firstTag = drawer.locator(".tag-option").first();
    const tag = (await firstTag.locator("span").nth(1).textContent())?.trim();
    expect(tag).toBeTruthy();
    await firstTag.click();
    await drawer.getByRole("button", { name: "Fermer les filtres" }).click();

    const chip = page.getByRole("button", { name: `Retirer le filtre ${tag}` });
    await expect(chip).toBeVisible();
    await expect(page.locator(".mobile-sticky-toolbar .mobile-filter-trigger")).toHaveClass(/is-active/);
    await chip.click();
    await expect(chip).toBeHidden();
  });

  test("maintient les suggestions d’auteur sous le champ dans le drawer", async ({ page }) => {
    await openLibrary(page);
    await page.getByRole("button", { name: /Ouvrir les filtres/ }).click();
    const input = page.getByRole("combobox", { name: "Filtrer par auteur dans le drawer" });
    await input.fill("a");
    const suggestions = page.locator(".author-suggestions");
    await expect(suggestions).toBeVisible();
    await expect(suggestions).toHaveAttribute("data-side", "bottom");
    await expect(suggestions).toHaveCSS("z-index", "70");
  });
});

test("préserve la structure du ruban desktop à 1280px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);

  await expect(page.getByRole("button", { name: "Filtres avancés" })).toBeVisible();
  // Two mobile triggers exist in the DOM (ribbon and sticky toolbar); both must stay hidden on desktop.
  await expect(page.locator(".control-ribbon .mobile-filter-trigger")).toBeHidden();
  await expect(page.locator(".mobile-sticky-toolbar .mobile-filter-trigger")).toBeHidden();
  await expect(page.locator(".ribbon-end .author-control")).toBeVisible();
  await expect(page.locator(".ribbon-end .year-control")).toBeVisible();
  await expect(page.locator(".ribbon-end .collection-control")).toBeVisible();
  await expect(page.locator(".control-ribbon")).toHaveCSS("display", "flex");
  await expect(page.locator(".ribbon-end")).toHaveCSS("display", "flex");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

async function openLibrary(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Publications sauvegardées" })).toBeVisible();
  await expect(page.locator('.posts-masonry')).toHaveAttribute('data-masonry-ready', 'true');
}
