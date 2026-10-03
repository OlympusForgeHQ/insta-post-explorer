import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const realAuthConfigured = Boolean(adminPassword);
const runDatabaseImport = process.env.E2E_RUN_DB_IMPORT === "true";

test.describe("authentification administrateur réelle", () => {
  test.skip(!realAuthConfigured, "Définir E2E_ADMIN_PASSWORD.");

  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await page.goto("/login");
    await expectRealLoginForm(page);
  });

  test("refuse des identifiants invalides sans révéler le champ incorrect", async ({ page }) => {
    await page.getByLabel("Mot de passe").fill("mot-de-passe-incorrect");
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: /mot de passe incorrect/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("connecte, protège le cookie puis déconnecte depuis l'interface", async ({ context, page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("region", { name: /Publications sauvegardées/i })).toBeVisible();
    await expect(page.locator("button.import-button")).toBeVisible();
    const favoriteButtons = page.getByRole("button", { name: "Ajouter aux favoris" });
    await expect(favoriteButtons).not.toHaveCount(0);
    const favoriteButton = favoriteButtons.first();
    await favoriteButton.click();
    await expect(favoriteButton).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Retirer des favoris" }).first().click();

    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === "mosaic_session");
    expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });

    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Ouvrir la connexion administrateur" })).toBeVisible();
  });

  test("neutralise une cible next externe après connexion", async ({ page }) => {
    await page.goto("/login?next=https://example.net/phishing");
    await expectRealLoginForm(page);
    await login(page);

    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("import PostgreSQL idempotent", () => {
  test.skip(!realAuthConfigured, "Définir E2E_ADMIN_PASSWORD.");
  test.skip(!runDatabaseImport, "Définir E2E_RUN_DB_IMPORT=true sur une base de preview jetable.");

  test("expose un health check public prêt pour Vercel", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      database: "connected",
      authentication: "configured",
    });
  });

  test("supprime uniquement la sélection et conserve suppression et journal après réimport", async ({ context, page }) => {
    await context.clearCookies();
    await page.goto("/login");
    await expectRealLoginForm(page);
    await login(page);
    const nonce = `qa-multi-${randomUUID()}`;
    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === "mosaic_session");
    expect(sessionCookie).toBeDefined();
    const authHeaders = { Cookie: `${sessionCookie!.name}=${sessionCookie!.value}` };
    const payload = ["first", "second", "retained"].map((name) => ({
      post_url: `https://www.instagram.com/p/${nonce}-${name}/`,
      thumbnail_url: "https://scontent.cdninstagram.com/qa-auth-placeholder.jpg",
      username: `qa_multi_${name}`,
      caption: `Multiselection ${nonce}`,
      tags: [nonce],
    }));
    const listUrl = `/api/posts?q=${encodeURIComponent(nonce)}&limit=48`;
    const imported = await page.request.post("/api/import?sourceName=qa-multiselection.json", {
      headers: { ...authHeaders, "Idempotency-Key": `${nonce}:initial` }, data: payload,
    });
    expect(imported.status()).toBe(201);
    expect(await imported.json()).toMatchObject({ imported: 3 });
    const { items } = await (await page.request.get(listUrl, { headers: authHeaders })).json() as {
      items: Array<{ id: string; authorUsername: string }>;
    };
    expect(items).toHaveLength(3);
    const retained = items.find((post) => post.authorUsername === "qa_multi_retained")!;
    const selected = items.filter((post) => post.id !== retained.id);

    try {
      await page.goto(`/?q=${encodeURIComponent(nonce)}`);
      await expect(page.locator(".post-card")).toHaveCount(3);
      await page.getByRole("button", { name: "Sélectionner des publications" }).click();
      for (const post of selected) await page.locator(`[data-selection-id="${post.id}"]`).check();
      await expect(page.getByText("2 publications sélectionnées", { exact: true })).toBeVisible();
      await expect(page.locator(`[data-selection-id="${retained.id}"]`)).not.toBeChecked();
      await page.getByRole("button", { name: "Supprimer la sélection" }).click();
      const dialog = page.getByRole("alertdialog", { name: "Supprimer 2 publications ?" });
      await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
      await expect(page.locator(".post-card")).toHaveCount(1);
      await expect(page.locator(`[data-post-id="${retained.id}"]`)).toBeVisible();

      const reimport = await page.request.post("/api/import?sourceName=qa-multiselection.json", {
        headers: { ...authHeaders, "Idempotency-Key": `${nonce}:retry` }, data: payload,
      });
      expect(reimport.status()).toBe(201);
      expect(await reimport.json()).toMatchObject({ imported: 0, updated: 1, skipped: 2 });
      expect(await (await page.request.get(listUrl, { headers: authHeaders })).json()).toMatchObject({
        total: 1, items: [{ id: retained.id }],
      });
      const journalResponse = await page.request.get("/api/admin/audit?table=posts&operation=DELETE&limit=100", { headers: authHeaders });
      expect(journalResponse.status()).toBe(200);
      const journal = await journalResponse.json() as { items: Array<{ beforeData: { id: string; caption: string }; action: string }> };
      for (const post of selected) expect(journal.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ beforeData: expect.objectContaining({ id: post.id, caption: `Multiselection ${nonce}` }), action: "admin.delete_post" }),
      ]));
    } finally {
      // Only this scenario's unique synthetic posts can be cleanup targets.
      for (const post of items) {
        const removed = await page.request.delete(`/api/posts/${post.id}`, { headers: authHeaders });
        expect([200, 404]).toContain(removed.status());
      }
    }
  });

  test("importe une seule publication puis permet de l'administrer", async ({ context, page }) => {
    await context.clearCookies();
    await page.goto("/login");
    await expectRealLoginForm(page);
    await login(page);

    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === "mosaic_session");
    expect(sessionCookie).toBeDefined();
    const authHeaders = { Cookie: `${sessionCookie!.name}=${sessionCookie!.value}` };

    const nonce = `qa-${randomUUID()}`;
    const postUrl = `https://www.instagram.com/p/${nonce}`;
    const payload = [{
      post_url: postUrl,
      thumbnail_url: "https://scontent.cdninstagram.com/qa-auth-placeholder.jpg",
      username: "qa_auth",
      caption: `Import idempotent ${nonce}`,
      tags: ["qa-auth", nonce],
    }];
    const firstKey = `${nonce}:batch-0`;

    const first = await page.request.post("/api/import?sourceName=qa-auth.json", {
      headers: { ...authHeaders, "Idempotency-Key": firstKey },
      data: payload,
    });
    expect(first.status()).toBe(201);
    const firstReport = await first.json();

    const retry = await page.request.post("/api/import?sourceName=qa-auth.json", {
      headers: { ...authHeaders, "Idempotency-Key": firstKey },
      data: payload,
    });
    expect(retry.status()).toBe(201);
    expect(await retry.json()).toEqual(firstReport);

    const secondJob = await page.request.post("/api/import?sourceName=qa-auth.json", {
      headers: { ...authHeaders, "Idempotency-Key": `${nonce}:batch-1` },
      data: payload,
    });
    expect(secondJob.status()).toBe(201);
    expect(await secondJob.json()).toMatchObject({ imported: 0, updated: 1 });

    const listing = await page.request.get(`/api/posts?q=${encodeURIComponent(nonce)}&limit=48`, {
      headers: authHeaders,
    });
    expect(listing.ok()).toBe(true);
    const pageResult = await listing.json() as {
      items?: Array<{ id: string; postUrl?: string; tags: string[] }>;
    };
    const importedPosts = pageResult.items?.filter((item) => item.postUrl === postUrl) ?? [];
    expect(importedPosts).toHaveLength(1);
    const importedPost = importedPosts[0];

    const addTag = await page.request.post(`/api/posts/${importedPost.id}/tags`, {
      headers: authHeaders,
      data: { tag: "qa-admin" },
    });
    expect(addTag.status()).toBe(201);
    expect(await addTag.json()).toMatchObject({ tags: expect.arrayContaining(["qa-admin"]) });

    const reimportAfterManualTag = await page.request.post("/api/import?sourceName=qa-auth.json", {
      headers: { ...authHeaders, "Idempotency-Key": `${nonce}:batch-2` },
      data: payload,
    });
    expect(reimportAfterManualTag.status()).toBe(201);
    const afterReimport = await page.request.get(`/api/posts?q=${encodeURIComponent(nonce)}&limit=48`, {
      headers: authHeaders,
    });
    expect(await afterReimport.json()).toMatchObject({
      items: [expect.objectContaining({ tags: expect.arrayContaining(["qa-admin"]) })],
    });

    const removeTag = await page.request.delete(`/api/posts/${importedPost.id}/tags`, {
      headers: authHeaders,
      data: { tag: "qa-admin" },
    });
    expect(removeTag.ok()).toBe(true);
    expect(await removeTag.json()).not.toMatchObject({ tags: expect.arrayContaining(["qa-admin"]) });

    const removePost = await page.request.delete(`/api/posts/${importedPost.id}`, {
      headers: authHeaders,
    });
    expect(removePost.ok()).toBe(true);

    const afterDelete = await page.request.get(`/api/posts?q=${encodeURIComponent(nonce)}&limit=48`, {
      headers: authHeaders,
    });
    expect(afterDelete.ok()).toBe(true);
    expect((await afterDelete.json() as { items?: unknown[] }).items).toHaveLength(0);

    const reimportAfterDelete = await page.request.post("/api/import?sourceName=qa-auth.json", {
      headers: { ...authHeaders, "Idempotency-Key": `${nonce}:batch-3` },
      data: payload,
    });
    expect(reimportAfterDelete.status()).toBe(201);
    expect(await reimportAfterDelete.json()).toMatchObject({ imported: 0, updated: 0, skipped: 1 });
    const afterSuppressedImport = await page.request.get(`/api/posts?q=${encodeURIComponent(nonce)}&limit=48`);
    expect(afterSuppressedImport.ok()).toBe(true);
    expect(await afterSuppressedImport.json()).toMatchObject({ items: [], total: 0 });

    await page.getByRole("button", { name: "Gérer la bibliothèque" }).click();
    await page.getByRole("menuitem", { name: "Journal des modifications" }).click();
    const journal = page.getByRole("dialog", { name: "Journal des modifications" });
    await journal.getByLabel("Données", { exact: true }).selectOption("posts");
    await journal.getByLabel("Opération", { exact: true }).selectOption("DELETE");
    await expect(journal.locator("details").first()).toContainText("Suppression manuelle");
    await journal.locator("summary").first().click();
    await expect(journal.locator("pre").first()).toContainText(nonce);
    await journal.getByRole("button", { name: "Fermer le journal" }).click();
  });
});

async function login(page: Page): Promise<void> {
  await page.getByLabel("Mot de passe").fill(adminPassword!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/$/);
}

async function expectRealLoginForm(page: Page): Promise<void> {
  const bypassNotice = page.getByText(/AUTH_DISABLED=true/i);
  if (await bypassNotice.isVisible().catch(() => false)) {
    throw new Error(
      "Le serveur Playwright utilise le bypass. Démarrer npm run dev séparément avec AUTH_DISABLED=false et les vraies variables auth avant ce test.",
    );
  }
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  await expect(page.getByLabel("Adresse e-mail")).toHaveCount(0);
}
