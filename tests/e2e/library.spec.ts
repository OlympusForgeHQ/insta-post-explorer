import { expect, test, type Page } from "@playwright/test";

test.describe("bibliotheque Mosaïque", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Publications sauvegardées" })).toBeVisible();
    await expect(page.locator(".posts-masonry")).toHaveAttribute("data-masonry-ready", "true");
  });

  test("charge les 18 publications du fallback local", async ({ page }) => {
    await expect(page.locator(".brand-logo")).toBeVisible();
    await expect(page.locator(".brand-name")).toContainText("Insta Post Explorer");
    // Two results counters exist (ribbon and mobile sticky toolbar); assert the visible one.
    await expect(page.locator(".results-count:visible")).toHaveText(/^18\b/);
    await expect(page.getByRole("button", { name: "Ouvrir la publication de esncom.fr" })).toBeVisible();
    await expect(page.locator("[data-post-id]")).toHaveCount(18);
  });

  test("expose les totaux exacts sans casser le champ total historique", async ({ request }) => {
    const response = await request.get("/api/posts?limit=5");
    const payload = await response.json() as { items: unknown[]; total: number; totalFiltered: number; totalLibrary: number };
    expect(payload.items).toHaveLength(5);
    expect(payload.total).toBe(18);
    expect(payload.totalFiltered).toBe(18);
    expect(payload.totalLibrary).toBe(18);
  });

  test("demande une découverte au serveur avec les filtres actifs", async ({ page }) => {
    const discovery = page.getByRole("button", { name: "Découverte", exact: true });
    // Discovery is currently only exposed on desktop (header-tab desktop-only).
    test.skip(!(await discovery.isVisible()), "La découverte n'est exposée que sur desktop");
    await page.getByRole("button", { name: "Sucré", exact: true }).click();
    const requestPromise = page.waitForRequest((request) => request.url().includes("/api/posts?") && request.url().includes("random=1"));
    await discovery.click();
    const request = await requestPromise;
    expect(new URL(request.url()).searchParams.get("theme")).toBe("Sucré");
  });

  test("recherche sans accent et restaure la requete dans l'URL", async ({ page }) => {
    const search = page.getByRole("searchbox", { name: "Rechercher dans la bibliothèque" });

    await search.fill("patisserie");

    await expect(page.locator(".results-count:visible")).toHaveText(/^2\b/);
    await expect(page.getByRole("button", { name: "Ouvrir la publication de damienpichon_" })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("patisserie");
  });

  test("combine les tags en ET puis en OU", async ({ page }) => {
    const filters = await openFilters(page);
    await filters.getByRole("button", { name: /Dessert protéiné/ }).click();
    await filters.getByRole("button", { name: "Chocolat 1", exact: true }).click();

    await expect(page.locator(".results-count:visible")).toHaveText(/^1\b/);
    await filters.getByRole("button", { name: "OU", exact: true }).click();
    await expect(page.locator(".results-count:visible")).toHaveText(/^11\b/);
    await expect.poll(() => new URL(page.url()).searchParams.get("tagMode")).toBe("or");
  });

  test("affiche un état de chargement pendant un filtrage lent", async ({ page }) => {
    await page.route("**/api/posts?**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    const filters = await openFilters(page);
    await filters.getByRole("button", { name: /Dessert protéiné/ }).click();
    const loading = page.getByRole("status").filter({ hasText: /Chargement des résultats/i });
    await expect(loading).toBeVisible();
    await expect(loading).toBeHidden();
  });

  test("traite Favoris comme un filtre principal unique", async ({ page }) => {
    const favoriteFilter = page.getByRole("button", { name: "Favoris", exact: true });
    await favoriteFilter.click();
    await expect(favoriteFilter).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".active-tags")).not.toContainText("Favoris");
    await expect.poll(() => new URL(page.url()).searchParams.get("collection")).toBe("favoris");
  });

  test("combine un filtre de type avec les thèmes principaux", async ({ page }) => {
    // Content-type chips live in the filter panel (desktop) or drawer (mobile).
    let filters = await openFilters(page);
    const carousel = filters.getByRole("button", { name: "Carrousel", exact: true });
    await carousel.click();
    await expect(carousel).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("carousel");
    await closeFilters(page);

    const sweet = page.getByRole("button", { name: "Sucré", exact: true });
    await sweet.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("theme")).toBe("Sucré");
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("carousel");

    filters = await openFilters(page);
    await filters.getByRole("button", { name: "Vidéo", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("reel");
    await expect(filters.getByRole("button", { name: "Carrousel", exact: true })).toHaveAttribute("aria-pressed", "false");
    await closeFilters(page);
  });

  test("ouvre le detail et navigue au bouton et au clavier", async ({ page }) => {
    await page.getByRole("button", { name: "Ouvrir la publication de esncom.fr" }).click();
    const dialog = page.getByRole("dialog", { name: "Publication de esncom.fr" });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Photo", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Date", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Commentaires", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Date d’enregistrement inconnue", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Média indisponible", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Inconnue", { exact: true })).toHaveCount(0);
    const firstId = new URL(page.url()).searchParams.get("post");
    expect(firstId).not.toBeNull();
    await dialog.getByRole("button", { name: "Suivant", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const secondId = new URL(page.url()).searchParams.get("post");
    expect(secondId).not.toBe(firstId);

    await page.keyboard.press("ArrowRight");
    await expect.poll(() => new URL(page.url()).searchParams.get("post")).not.toBe(secondId);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => new URL(page.url()).searchParams.get("post")).toBe(secondId);
  });

  test("ne propose plus le tri par commentaires", async ({ page }) => {
    await page.goto("/");
    // Two sort selects exist (ribbon and mobile sticky toolbar); scope to the ribbon.
    const sort = page.getByRole("region", { name: "Filtres et tri", exact: true }).getByLabel("Trier les résultats");
    await expect(sort.locator("option[value='comments']")).toHaveCount(0);
    await expect(sort.locator("option[value='likes']")).toHaveText("Plus likés");
  });

  test("affiche les statistiques globales depuis l'endpoint dédié", async ({ page }) => {
    await page.route("**/api/stats", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        posts: 3379, photos: 1200, carousels: 900, videos: 1270, otherPosts: 9,
        media: 6946, imageMedia: 5600, videoMedia: 1346, tags: 420, mainThemes: 7,
        authors: 210, favorites: 64, totalLikes: 120000, totalComments: 8100,
        averages: { likesPerRatedPost: 210, commentsPerRatedPost: 14, mediaPerPost: 2, tagsPerPost: 3 },
        distributions: {
          themes: [{ name: "Sucré", count: 1200 }],
          years: [{ year: 2026, count: 900 }],
          topAuthors: [{ username: "esncom.fr", postCount: 44 }],
        },
      }),
    }));

    await page.getByRole("button", { name: "Afficher les statistiques de la bibliothèque" }).click();
    const dialog = page.getByRole("dialog", { name: "Statistiques de la bibliothèque" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("3 379", { exact: true })).toBeVisible();
    await expect(dialog.getByText("6 946", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Carrousels", { exact: true })).toBeVisible();
  });

  test("parcourt tous les médias d'un carrousel dans le détail", async ({ page }) => {
    const response = await page.request.get("/api/posts?limit=1");
    const item = (await response.json() as { items: Array<Record<string, unknown>> }).items[0];
    const postId = String(item.id);
    const imageUrl = String(item.thumbnailUrl);
    await page.route(`**/api/posts/${postId}`, (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...item,
        contentType: "carousel",
        media: [
          { id: "carousel-1", type: "image", url: imageUrl, sourcePath: null, thumbnailUrl: imageUrl, position: 0 },
          { id: "carousel-2", type: "image", url: imageUrl, sourcePath: null, thumbnailUrl: imageUrl, position: 1 },
        ],
      }),
    }));

    await page.locator(`[data-post-id="${postId}"]`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Carrousel", { exact: true })).toBeVisible();
    await expect(dialog.getByText("1 / 2", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Média suivant" }).click();
    await expect(dialog.getByText("2 / 2", { exact: true })).toBeVisible();
  });

  test("ouvre un post vidéo au premier clic sans remplacer sa cible tactile @mobile", async ({ page, isMobile }) => {
    const payload = await (await page.request.get('/api/posts?limit=1')).json();
    const post = { ...payload.items[0], thumbnailUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#7c3aed"/></svg>'), media: [{ id: 'preview', type: 'video', url: '/preview-probe.mp4', position: 0 }] };
    await page.route('**/preview-probe.mp4', route => route.fulfill({ status: 204 }));
    await page.route('**/api/posts?**', route => route.fulfill({ json: { items: [post], nextCursor: null, total: 1, totalFiltered: 1, totalLibrary: 18 } }));
    await page.getByRole('searchbox', { name: 'Rechercher dans la bibliothèque' }).fill('preview-probe');
    const card = page.locator('[data-post-id]');
    await expect(card).toHaveCount(1);
    await expect(page.locator('.posts-masonry')).toHaveAttribute('data-masonry-ready', 'true');
    if (isMobile) await card.tap();
    else { await card.hover(); await expect(card.locator('img')).toHaveCount(1); await card.click(); }
    await expect(page.getByRole('dialog', { name: `Publication de ${post.authorUsername}` })).toBeVisible();
  });

  test("prépare la lecture vidéo et le fallback source_path", async ({ page }) => {
    const response = await page.request.get("/api/posts?limit=1");
    const item = (await response.json() as { items: Array<Record<string, unknown>> }).items[0];
    const postId = String(item.id);
    await page.route(`**/api/posts/${postId}`, (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...item,
        contentType: "reel",
        media: [
          { id: "video-1", type: "video", url: "https://cdn.example.com/video.mp4", sourcePath: "auteur/CODE/video.mp4", thumbnailUrl: String(item.thumbnailUrl), position: 0 },
          { id: "local-2", type: "image", url: null, sourcePath: "auteur/CODE/photo.jpg", thumbnailUrl: null, position: 1 },
        ],
      }),
    }));

    await page.locator(`[data-post-id="${postId}"]`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("video[controls][playsinline]")).toBeVisible();
    await dialog.getByRole("button", { name: "Média suivant" }).click();
    await expect(dialog.getByText("Média indisponible", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/source locale/i)).toBeVisible();
  });

  test("applique et persiste les themes clair, sombre et systeme", async ({ page }) => {
    await selectTheme(page, "Clair");
    await expect(page.locator("html")).toHaveClass(/light/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("light");

    await selectTheme(page, "Sombre");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

    await page.emulateMedia({ colorScheme: "dark" });
    await selectTheme(page, "Système");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("system");
  });

  test("reste en lecture seule pour un visiteur", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Ouvrir la connexion administrateur" })).toBeVisible();
    await expect(page.locator("button.import-button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Favoris", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ajouter aux favoris" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retirer des favoris" })).toHaveCount(0);

    await page.getByRole("button", { name: "Ouvrir la publication de esncom.fr" }).click();
    const dialog = page.getByRole("dialog", { name: "Publication de esncom.fr" });
    await expect(dialog.getByRole("button", { name: /Supprimer/ })).toHaveCount(0);
    await expect(dialog.getByLabel(/Ajouter un tag/)).toHaveCount(0);
  });

  test("autorise les lectures publiques et refuse les mutations anonymes", async ({ request }) => {
    await expect((await request.get("/api/brand/logo")).status()).toBe(200);
    await expect((await request.get("/api/posts?limit=1")).status()).toBe(200);
    await expect((await request.post("/api/import", { data: [] })).status()).toBe(401);
    await expect((await request.delete("/api/posts/post-inexistant")).status()).toBe(401);
  });

  test("ne déborde pas horizontalement et garde un Masonry stable", async ({ page }) => {
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      cards: [...document.querySelectorAll<HTMLElement>("[data-post-id]")].map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      }),
    }));

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.cards.length).toBe(18);
    expect(layout.cards.every((card) => card.left >= 0 && card.right <= layout.viewport + 1)).toBe(true);
    expect(layout.cards.every((card) => card.width > 0 && card.height > 0)).toBe(true);
  });

  test("récupère les proportions Pinterest des images chargées avant hydratation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const sources = await page.locator('.post-media img').evaluateAll(nodes => nodes.slice(0, 6).map(n => (n as HTMLImageElement).src));
    const heights = [400, 720, 540, 800, 480, 600];
    let release!: () => void;
    const hydration = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/*', async route => {
      const index = sources.indexOf(route.request().url());
      if (index >= 0) return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${heights[index]}"><rect width="400" height="${heights[index]}" fill="#7c3aed"/></svg>` });
      if (route.request().resourceType() === 'script' && route.request().url().includes('/_next/')) await hydration;
      await route.continue();
    });
    try {
      await page.reload({ waitUntil: 'commit' });
      await expect.poll(() => page.locator('.post-media img').evaluateAll(nodes => nodes.length >= 6 && nodes.slice(0, 6).every(n => (n as HTMLImageElement).complete && (n as HTMLImageElement).naturalWidth > 0))).toBe(true);
      // The images must finish while the client bundles are still blocked.
      await expect(page.locator('.posts-grid')).not.toHaveAttribute('data-layout-ready', 'true');
    } finally { release(); }
    const grid = page.locator('.posts-grid');
    await expect(grid).toHaveAttribute('data-layout-ready', 'true');
    const read = () => page.locator('.post-card').evaluateAll(nodes => nodes.slice(0, 6).map(n => {
      const media = n.querySelector('.post-media')!.getBoundingClientRect(), card = n.getBoundingClientRect();
      return { ratio: media.width / media.height, x: card.x, y: card.y, bottom: card.bottom };
    }));
    const hasNaturalRatios = async () => (await read()).every((box, i) => Math.abs(box.ratio - 400 / heights[i]) < .01);
    await expect.poll(hasNaturalRatios).toBe(true);
    await expect.poll(async () => { const b = await read(); return Math.abs(b[2].y - b[3].y) > 30 && b.every((box, i) => i < 2 || box.y >= b[i - 2].bottom + 5); }).toBe(true);
    await page.getByRole('button', { name: 'Grille régulière' }).click();
    await expect.poll(async () => (await read()).every(box => Math.abs(box.ratio - 1) < .01)).toBe(true);
    await page.getByRole('button', { name: 'Grille masonry' }).click();
    await expect.poll(hasNaturalRatios).toBe(true);
  });

  test("remplit le Pinterest de gauche à droite et recalcule les hauteurs au redimensionnement", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.posts-masonry')).toHaveAttribute('data-masonry-ready', 'true');
    const cards = page.locator('.post-card');
    const ids = await page.locator('[data-post-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-post-id')));
    const geometry = () => cards.evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom };
    }));
    await expect.poll(async () => { const b = await geometry(); return b[1].x > b[0].x; }).toBe(true);
    const checkColumns = async () => {
      const b = await geometry();
      return b.every((r, i) => Math.abs(r.x - b[i % 2].x) < 1 && (i < 2 || r.y >= b[i - 2].bottom + 5));
    };
    await expect.poll(checkColumns).toBe(true);
    // A late media ratio change must move only subsequent rows, never overlap them.
    await cards.first().locator('.post-media').evaluate(node => { (node as HTMLElement).style.aspectRatio = '1 / 2'; });
    await expect.poll(checkColumns).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(async () => { const b = await geometry(); return b[2].x > b[1].x; }).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(checkColumns).toBe(true);
    expect(await page.locator('[data-post-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-post-id')))).toEqual(ids);
    await page.getByRole('button', { name: 'Grille régulière' }).click();
    await expect.poll(async () => { const b = await geometry(); return Math.abs(b[0].y - b[1].y) < 1 && b[2].y >= b[0].bottom; }).toBe(true);
    await page.getByRole('button', { name: 'Grille masonry' }).click();
    await expect.poll(checkColumns).toBe(true);
  });

  for (const width of [390, 1140]) test(`anime la géométrie, les interruptions et les images tardives à ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const payload = await (await page.request.get('/api/posts?limit=1')).json();
    const items = [600, 480, 700, 520, 600, 500].map((height, index) => ({ ...payload.items[0], id: `motion-${index}`, thumbnailUrl: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${height}"><rect width="400" height="${height}" fill="#7c3aed"/></svg>`), media: [] }));
    await page.route('**/api/posts?**', route => route.fulfill({ json: { items, nextCursor: null, total: items.length, totalFiltered: items.length, totalLibrary: 18 } }));
    await page.getByRole('searchbox', { name: 'Rechercher dans la bibliothèque' }).fill('motion-probe');
    await expect(page.locator('[data-post-id]')).toHaveCount(items.length);
    await expect.poll(() => page.locator('.post-media img').evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expect(page.locator('.posts-masonry')).toHaveAttribute('data-masonry-ready', 'true');
    const grid = page.locator('.posts-grid');
    await grid.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))); });
    const read = () => page.locator('.post-card').evaluateAll(nodes => nodes.slice(0, 4).map(node => {
      const r = node.getBoundingClientRect(), m = node.querySelector('.post-media')!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, mediaHeight: m.height };
    }));
    await expect.poll(() => grid.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
    // Freeze newly-created geometry animations before their first paint. This
    // makes frame assertions independent of CI scheduling and CPU speed.
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.closest('.posts-grid')) { animation.pause(); animation.currentTime = 0; }
        return animation;
      };
    });
    const before = await read();
    await page.locator('.post-card').first().evaluate(node => { (window as unknown as { originalCard: Element }).originalCard = node; });
    await page.getByRole('button', { name: 'Grille régulière' }).evaluate(node => (node as HTMLButtonElement).click());
    await expect(page.locator('.posts-regular')).toBeVisible();
    // Freeze the browser's own animations to inspect their real rendered frames.
    const seek = (fraction: number) => grid.evaluate((node, fraction) => {
      const animations = node.getAnimations({ subtree: true }).filter(a => a instanceof Animation && !(a instanceof CSSAnimation));
      for (const animation of animations) { animation.pause(); animation.currentTime = Number(animation.effect!.getTiming().duration) * fraction; }
      return animations.length;
    }, fraction);
    expect(await seek(0)).toBeGreaterThan(0);
    const start = await read();
    expect(Math.abs(start[0].mediaHeight - before[0].mediaHeight)).toBeLessThan(2);
    expect(Math.abs(start[2].y - before[2].y)).toBeLessThan(2);
    await seek(.25);
    const middle = await read();
    expect(Math.abs(middle[0].mediaHeight - before[0].mediaHeight)).toBeGreaterThan(2);
    if (width > 760) expect(Math.abs(middle[0].width - before[0].width)).toBeGreaterThan(2);
    // A reversal must start from the visible intermediate frame, not an endpoint.
    await page.getByRole('button', { name: 'Grille masonry' }).evaluate(node => (node as HTMLButtonElement).click());
    await expect(page.locator('.posts-masonry')).toBeVisible();
    expect(await seek(0)).toBeGreaterThan(0);
    const reverse = await read();
    expect(Math.abs(reverse[0].mediaHeight - middle[0].mediaHeight)).toBeLessThan(2);
    expect(Math.abs(reverse[2].y - middle[2].y)).toBeLessThan(2);
    await grid.evaluate(node => node.getAnimations({ subtree: true }).forEach(a => a.finish()));
    await expect.poll(async () => Math.abs((await read())[0].mediaHeight - before[0].mediaHeight)).toBeLessThan(2);
    expect(await page.locator('.post-card').first().evaluate(node => node === (window as unknown as { originalCard: Element }).originalCard)).toBe(true);
    await expect.poll(() => grid.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
    // Loading a new intrinsic ratio is a child-only React update. Its first
    // animated frame must retain the previous crop and move subsequent cards.
    const oldMedia = (await read())[0].mediaHeight;
    await page.locator('.post-media img').first().evaluate(node => {
      (node as HTMLImageElement).src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#0891b2"/></svg>');
    });
    await expect.poll(() => grid.evaluate(node => node.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);
    expect(Math.abs((await read())[0].mediaHeight - oldMedia)).toBeLessThan(2);
    await seek(.25);
    expect((await read())[0].mediaHeight).toBeGreaterThan(oldMedia + 2);
    await grid.evaluate(node => node.getAnimations({ subtree: true }).forEach(a => a.finish()));
    await expect.poll(() => grid.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
    // Measuring the shorter layout must not synchronously clamp the scroll
    // position to the new page bottom before its animation even starts.
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    const bottom = await page.evaluate(() => scrollY);
    expect(bottom).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Grille régulière' }).evaluate(node => (node as HTMLButtonElement).click());
    await expect(page.locator('.posts-regular')).toBeVisible();
    expect(Math.abs(await page.evaluate(() => scrollY) - bottom)).toBeLessThan(2);
    expect(await seek(0)).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Grille régulière' }).click();
    expect(await grid.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  });

  test("conserve l'ordre DOM au clavier dans le Masonry", async ({ page }) => {
    const expected = await page.locator("[data-post-id]").evaluateAll((cards) => cards.slice(0, 3).map((card) => card.getAttribute("data-post-id")));
    await page.locator("[data-post-id]").first().focus();
    const focused = [await page.locator(":focus").getAttribute("data-post-id")];
    await page.keyboard.press("Tab");
    focused.push(await page.locator(":focus").getAttribute("data-post-id"));
    await page.keyboard.press("Tab");
    focused.push(await page.locator(":focus").getAttribute("data-post-id"));
    expect(focused).toEqual(expected);
  });

  test("déploie les résultats rares et propose le retour en haut", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const backToTop = page.getByRole("button", { name: "Retour en haut de la page" });
    await expect(backToTop).toBeVisible();
    await backToTop.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    const search = page.getByRole("searchbox", { name: "Rechercher dans la bibliothèque" });
    await search.fill("patisserie");
    const sparseGrid = page.locator(".posts-masonry-sparse");
    await expect(sparseGrid).toBeVisible();
    await expect(page.locator(".results-count:visible")).toHaveText(/^2\b/);
    await expect(sparseGrid.locator("[data-post-id]")).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => sparseGrid.locator('.post-card').first().evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(200);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(() => sparseGrid.locator('.post-card').first().evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(240);
  });

  test("structure la toolbar et la grille sans débordement à 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    const trigger = page.getByRole("button", { name: /Ouvrir les filtres/ });
    await expect(trigger).toBeVisible();

    // Author, year, and collection now live in the drawer at mobile widths.
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Filtres avancés" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("combobox", { name: "Filtrer par auteur dans le drawer" })).toBeVisible();
    await expect(drawer.getByLabel("Filtrer par année dans le drawer")).toBeVisible();
    await expect(drawer.getByLabel("Filtrer par collection dans le drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    const controls = await page.locator(".header-actions button:visible, .view-switch button:visible, .mobile-filter-trigger:visible").evaluateAll((items) =>
      items.map((item) => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })),
    );
    expect(controls.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    // The mobile grid is two columns: every card stays inside the viewport.
    const cards = await page.locator("[data-post-id]").evaluateAll((items) => items.slice(0, 4).map((card) => { const rect = card.getBoundingClientRect(); return { width: rect.width, left: rect.left, right: rect.right }; }));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.width > 140 && card.left >= 0 && card.right <= 361)).toBe(true);
  });
});

async function openFilters(page: Page) {
  const desktopPanel = page.locator(".desktop-filter-panel");
  if (await desktopPanel.isVisible()) return desktopPanel;

  // Desktop toggles the side panel; mobile opens the Radix drawer.
  const desktopToggle = page.getByRole("button", { name: "Filtres avancés" });
  if (await desktopToggle.isVisible()) {
    await desktopToggle.click();
    await expect(desktopPanel).toBeVisible();
    return desktopPanel;
  }

  await page.getByRole("button", { name: /Ouvrir les filtres/ }).click();
  const drawer = page.getByRole("dialog", { name: "Filtres avancés" });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function closeFilters(page: Page) {
  const drawer = page.getByRole("dialog", { name: "Filtres avancés" });
  if (await drawer.isVisible()) {
    await drawer.getByRole("button", { name: "Fermer les filtres" }).click();
    await expect(drawer).toBeHidden();
  }
}

async function selectTheme(page: Page, theme: "Clair" | "Sombre" | "Système") {
  await page.getByRole("button", { name: "Changer le thème" }).click();
  await page.getByRole("menuitemradio", { name: theme }).click();
}
