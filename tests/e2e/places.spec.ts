import { expect, test } from "@playwright/test";

const MAP_LIST_NAME = "Lieux affichés sur la carte";

test.describe("page Places avec le harnais local", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/places");
  });

  test("affiche les 182 lieux synthétiques et les accès de la page", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Places", level: 1 })).toBeVisible();
    await expect(page.getByText("182 lieux identifiés dans vos publications sauvegardées.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Lieux sauvegardés" })).toBeVisible();
    await expect(page.locator(".places-globe-canvas canvas")).toBeVisible();
    await expect(page.getByText("Tuiles locales de démonstration")).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour aux posts" })).toHaveAttribute("href", "/");
  });

  test("applique un filtre réel sans dupliquer les règles de parsing", async ({ page }) => {
    const mapList = page.getByRole("group", { name: MAP_LIST_NAME });
    await expect(mapList).toBeVisible();
    const initialCount = await mapList.getByRole("button").count();

    await page.getByRole("button", { name: "Filtres" }).click();
    const filters = page.getByRole("dialog", { name: "Filtres" });
    await filters.getByText("Voyages", { exact: true }).click();
    await filters.getByText(/Café et brunch/).click();

    await expect(page).toHaveURL(/theme=Voyages/);
    await expect(page).toHaveURL(/categories=cafe/);
    await expect(page.getByRole("button", { name: /Filtres/ })).toContainText("2");
    await expect.poll(() => mapList.getByRole("button").count()).toBeLessThan(initialCount);
    await expect.poll(() => mapList.getByRole("button").count()).toBeGreaterThan(0);
  });

  test("recherche une fixture connue et efface son état partagé", async ({ page }) => {
    const search = page.getByRole("searchbox", { name: "Rechercher un lieu" });
    await search.fill("Santorin");

    await expect(page).toHaveURL(/q=Santorin/);
    await expect(page.getByRole("button", { name: "Sélectionner Terrasse Santorin" })).toBeVisible();
    await expect(page.getByRole("status").first()).toContainText("1 lieu");

    await search.fill("");
    await expect(page).not.toHaveURL(/q=/);
  });

  test("présente les statistiques issues du jeu de données local", async ({ page }) => {
    await page.getByRole("button", { name: /Statistiques/ }).click();
    const stats = page.getByRole("dialog", { name: "Statistiques" });
    await expect(stats).toBeVisible();
    await expect(stats.getByText("Par thème")).toBeVisible();
    await expect(stats.getByText("Par pays")).toBeVisible();
    await expect(stats.getByText("Voyages")).toBeVisible();
    await expect(stats.getByText("Restaurant")).toBeVisible();
  });

  test("restaure une sélection depuis un lien profond", async ({ page }) => {
    await page.goto("/places?placeId=places-visual-paris");

    const detail = page.getByRole("dialog", { name: "Détail de Café du Globe Paris" });
    await expect(detail).toBeVisible();
    await expect(detail.getByText("Paris · France")).toBeVisible();
    await expect(page).toHaveURL(/placeId=places-visual-paris/);

    await detail.getByRole("button", { name: "Fermer le détail" }).click();
    await expect(detail).toBeHidden();
    await expect(page).not.toHaveURL(/placeId=/);
  });

  test("relie le détail du post à son lieu et ouvre son adresse dans un nouvel onglet", async ({ page, context }) => {
    const response = await page.request.get("/api/posts?q=Caf%C3%A9%20du%20Globe%20Paris");
    expect(response.ok()).toBe(true);
    const { items } = await response.json();
    const post = items.find((item: { postUrl: string }) => item.postUrl.endsWith("/places-visual-paris"));
    expect(post).toBeDefined();

    await page.goto("/?q=Caf%C3%A9%20du%20Globe%20Paris");
    await page.locator(`[data-post-id="${post.id}"]`).click();
    const postDetail = page.getByRole("dialog");
    await expect(postDetail.getByRole("link", { name: "Voir dans Places" })).toBeVisible();
    await expect(postDetail.getByRole("link", { name: /dans Google Maps/ })).toContainText("12 rue de l'Église & Café");
    await postDetail.getByRole("link", { name: "Voir dans Places" }).click();

    await expect(page).toHaveURL(/\/places\?placeId=places-visual-paris/);
    const placeDetail = page.getByRole("dialog", { name: "Détail de Café du Globe Paris" });
    await expect(placeDetail).toBeVisible();
    const mapsLink = placeDetail.getByRole("link", { name: /dans Google Maps/ });
    // Intercept only the external destination; app routing and database reads stay real.
    await context.route("https://www.google.com/maps/**", (route) => route.fulfill({ body: "Maps destination" }));
    const popupPromise = page.waitForEvent("popup");
    await mapsLink.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const mapsUrl = new URL(popup.url());
    expect(mapsUrl.origin + mapsUrl.pathname).toBe("https://www.google.com/maps/search/");
    expect(mapsUrl.searchParams.get("query")).toBe("12 rue de l'Église & Café, Paris, France");
    await expect(placeDetail).toBeVisible();
    await popup.close();

    await placeDetail.getByRole("button", { name: "Fermer le détail" }).click();
    await page.getByRole("button", { name: /Liste/ }).click();
    await expect(page.getByRole("complementary", { name: "Liste des lieux" })
      .getByRole("link", { name: /12 rue de l'Église & Café/ })).toBeVisible();
  });

  test("n'affiche qu'un panneau entre filtres et liste", async ({ page }) => {
    await page.getByRole("button", { name: /Liste/ }).click();
    const list = page.getByRole("complementary", { name: "Liste des lieux" });
    await expect(list).toBeVisible();

    await page.getByRole("button", { name: "Filtres" }).click();
    await expect(list).toBeHidden();
    const filters = page.getByRole("dialog", { name: "Filtres" });
    await expect(filters).toBeVisible();

    await page.getByRole("button", { name: /Liste/ }).click();
    await expect(filters).toBeHidden();
    await expect(list).toBeVisible();
  });

  test("reste sélectionnable au clavier sans débordement horizontal", async ({ page }) => {
    const mapList = page.getByRole("group", { name: MAP_LIST_NAME });
    await mapList.focus();
    await expect(mapList).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""))
      .toMatch(/^Sélectionner /);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: /^Détail de / })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
