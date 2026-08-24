import { expect, test, type Page } from "@playwright/test";

type CapturedMap = {
  getCanvas(): HTMLCanvasElement;
  getCenter(): { lat: number; lng: number };
  getProjection(): { type: string } | undefined;
  getSource(id: string): { serialize(): { data?: unknown } } | undefined;
  getZoom(): number;
  isMoving(): boolean;
  flyTo(options: { center: [number, number]; duration: number; zoom: number }): void;
  jumpTo(options: { center: [number, number]; zoom: number }): void;
  once(event: string, listener: () => void): void;
  project(coordinates: [number, number]): { x: number; y: number };
  queryRenderedFeatures(options: { layers: string[] }): Array<{
    geometry?: { coordinates?: unknown };
    properties?: { id?: string };
  }>;
};

type MapWindow = Window & { __placesMap?: CapturedMap; __workerUrls?: string[] };

async function prepareMapCapture(page: Page, trackWorker = false) {
  await page.addInitScript((shouldTrackWorker) => {
    const state = window as MapWindow;
    window.localStorage.setItem("places-benchmark", "1");
    state.__placesMap = undefined;
    window.addEventListener("places-map-ready", (event) => {
      state.__placesMap = (event as CustomEvent<CapturedMap>).detail;
    });
    if (!shouldTrackWorker) return;
    state.__workerUrls = [];
    const RealWorker = window.Worker;
    class TrackedWorker extends RealWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        state.__workerUrls?.push(String(url));
        super(url, options);
      }
    }
    window.Worker = TrackedWorker as unknown as typeof Worker;
  }, trackWorker);
}

async function waitForMap(page: Page) {
  await expect(page.locator(".places-globe-canvas canvas")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = (window as MapWindow).__placesMap;
        return Boolean(map?.getSource("places"));
      }),
    )
    .toBe(true);
}

async function waitForInitialViewport(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = (window as MapWindow).__placesMap;
          return Boolean(map && Math.abs(map.getZoom() - 1.4) > 0.01 && !map.isMoving());
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function waitForCamera(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !(window as MapWindow).__placesMap?.isMoving()), { timeout: 10_000 })
    .toBe(true);
}

async function moveTo(page: Page, coordinates: [number, number], zoom: number) {
  await page.evaluate(
    async ({ coordinates: nextCoordinates, zoom: nextZoom }) => {
      const map = (window as MapWindow).__placesMap;
      if (!map) throw new Error("Places map was not captured.");
      await new Promise<void>((resolve) => {
        map.once("moveend", resolve);
        map.flyTo({ center: nextCoordinates, zoom: nextZoom, duration: 0 });
      });
    },
    { coordinates, zoom },
  );
}

async function pointFor(page: Page, placeId: string) {
  await expect
    .poll(
      () =>
        page.evaluate((expectedPlaceId) => {
          const map = (window as MapWindow).__placesMap;
          return Boolean(
            map
              ?.queryRenderedFeatures({ layers: ["places-pins"] })
              .some((candidate) => candidate.properties?.id === expectedPlaceId),
          );
        }, placeId),
      { timeout: 10_000 },
    )
    .toBe(true);
  return page.evaluate((expectedPlaceId) => {
    const map = (window as MapWindow).__placesMap;
    if (!map) throw new Error("Places map was not captured.");
    const feature = map
      .queryRenderedFeatures({ layers: ["places-pins"] })
      .find((candidate) => candidate.properties?.id === expectedPlaceId);
    if (!feature?.geometry?.coordinates || !Array.isArray(feature.geometry.coordinates)) {
      throw new Error(`The expected rendered point is unavailable: ${expectedPlaceId}.`);
    }
    const point = map.project(feature.geometry.coordinates as [number, number]);
    const canvas = map.getCanvas().getBoundingClientRect();
    return { x: canvas.left + point.x, y: canvas.top + point.y };
  }, placeId);
}

test.describe("globe Places continu", () => {
  test("garde un globe unique pour les anciens paramètres de vue avec un style vectoriel sans projection", async ({ page }) => {
    await prepareMapCapture(page);
    let checkedProjectionlessStyle = false;

    for (const legacyView of ["map", "globe"]) {
      await page.goto(`/places?view=${legacyView}&q=Santorin`);
      await waitForMap(page);
      if (!checkedProjectionlessStyle) {
        const styleUrl = await page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .find((url) => new URL(url).pathname === "/style.json"),
        );
        if (!styleUrl) throw new Error("The local vector style was not requested.");
        const styleResponse = await page.request.get(styleUrl);
        expect(styleResponse.ok()).toBe(true);
        expect(await styleResponse.json()).not.toHaveProperty("projection");
        checkedProjectionlessStyle = true;
      }
      await expect(page.getByRole("button", { name: "2D" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "3D" })).toHaveCount(0);
      await expect(page).not.toHaveURL(/view=/);
      await expect(page).toHaveURL(/q=Santorin/);
      await expect.poll(() => page.evaluate(() => (window as MapWindow).__placesMap?.getProjection()?.type)).toBe("globe");
    }
  });

  test("charge le worker et les tuiles locales sans fournisseur distant", async ({ page }) => {
    const networkUrls: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("http")) networkUrls.push(request.url());
    });
    await prepareMapCapture(page, true);
    await page.goto("/places");
    await waitForMap(page);

    const worker = await page.request.get("/maplibre/maplibre-gl-worker.mjs");
    expect(worker.status()).toBe(200);
    await expect
      .poll(() => page.evaluate(() => (window as MapWindow).__workerUrls ?? []))
      .toContainEqual(expect.stringContaining("/maplibre/maplibre-gl-worker.mjs"));
    await expect
      .poll(() => networkUrls.find((url) => /\/tiles\/\d+\/\d+\/\d+\.png(?:\?|$)/.test(url)))
      .toBeTruthy();
    const tileUrl = networkUrls.find((url) => /\/tiles\/\d+\/\d+\/\d+\.png(?:\?|$)/.test(url));
    if (!tileUrl) throw new Error("The local tile server did not receive a raster request.");
    expect((await page.request.get(tileUrl)).status()).toBe(200);
    expect((await page.request.get(`${new URL(tileUrl).origin}/healthz`)).status()).toBe(200);
    expect(networkUrls.every((url) => url.startsWith("http://127.0.0.1:"))).toBe(true);
    await expect(page.getByText("Tuiles locales de démonstration")).toBeVisible();
  });

  test("charge les 182 points dans la source MapLibre du globe", async ({ page }) => {
    await prepareMapCapture(page);
    await page.goto("/places");
    await waitForMap(page);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = (window as MapWindow).__placesMap?.getSource("places");
          const data = source?.serialize().data as { features?: unknown[] } | undefined;
          return data?.features?.length ?? 0;
        }),
      )
      .toBe(182);
  });

  test("affiche le callout puis sélectionne un point isolé", async ({ page }) => {
    await prepareMapCapture(page);
    await page.goto("/places");
    await waitForMap(page);
    await waitForInitialViewport(page);
    await moveTo(page, [2.3522, 48.8566], 13);
    await waitForCamera(page);
    const point = await pointFor(page, "places-visual-paris");

    await page.mouse.move(point.x - 40, point.y - 40);
    await page.mouse.move(point.x, point.y, { steps: 8 });
    await expect(page.locator(".places-callout")).toContainText("Café du Globe Paris");
    await page.mouse.click(point.x, point.y);

    const detail = page.getByRole("dialog", { name: "Détail de Café du Globe Paris" });
    await expect(detail).toBeVisible();
    await page.getByRole("button", { name: /Liste/ }).click();
    await expect(page.locator('[data-place-id="places-visual-paris"]')).toHaveClass(/is-selected/);
  });

  test("agrandit un cluster sans remplacer le canvas", async ({ page }) => {
    await prepareMapCapture(page);
    await page.goto("/places");
    await waitForMap(page);
    await waitForInitialViewport(page);
    const canvas = page.locator(".places-globe-canvas canvas");
    await canvas.evaluate((element) => element.setAttribute("data-harness-canvas", "stable"));

    await page.evaluate(() => {
      const map = (window as MapWindow).__placesMap;
      if (!map) throw new Error("Places map was not captured.");
      map.jumpTo({ center: [139.6503, 35.6762], zoom: 4 });
    });
    await waitForCamera(page);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = (window as MapWindow).__placesMap;
          return Boolean(map?.queryRenderedFeatures({ layers: ["places-clusters"] }).length);
        }),
      )
      .toBe(true);
    const cluster = await page.evaluate(() => {
      const map = (window as MapWindow).__placesMap;
      if (!map) throw new Error("Places map was not captured.");
      const feature = map.queryRenderedFeatures({ layers: ["places-clusters"] })[0];
      if (!feature?.geometry?.coordinates || !Array.isArray(feature.geometry.coordinates)) {
        throw new Error("The deterministic Tokyo cluster was not rendered.");
      }
      const point = map.project(feature.geometry.coordinates as [number, number]);
      const box = map.getCanvas().getBoundingClientRect();
      return { beforeZoom: map.getZoom(), x: box.left + point.x, y: box.top + point.y };
    });

    await page.mouse.click(cluster.x, cluster.y);
    await expect.poll(() => page.evaluate(() => (window as MapWindow).__placesMap?.getZoom() ?? 0)).toBeGreaterThan(cluster.beforeZoom);
    await expect(page.locator('canvas[data-harness-canvas="stable"]')).toBeVisible();
  });

  test("conserve le même canvas pendant rotation et zoom", async ({ page }) => {
    await prepareMapCapture(page);
    await page.goto("/places");
    await waitForMap(page);
    await waitForInitialViewport(page);
    const canvas = page.locator(".places-globe-canvas canvas");
    await canvas.evaluate((element) => element.setAttribute("data-harness-canvas", "gesture"));
    const box = await canvas.boundingBox();
    if (!box) throw new Error("The globe canvas has no bounding box.");
    const before = await page.evaluate(() => {
      const map = (window as MapWindow).__placesMap;
      return map ? { center: map.getCenter(), zoom: map.getZoom() } : null;
    });

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 20);
    await page.mouse.up();
    await page.mouse.wheel(0, -420);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = (window as MapWindow).__placesMap;
          return map ? { center: map.getCenter(), zoom: map.getZoom() } : null;
        }),
      )
      .not.toEqual(before);
    await expect(page.locator('canvas[data-harness-canvas="gesture"]')).toBeVisible();
  });

  test("laisse liste et détail utilisables quand WebGL est indisponible", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
        if (typeof args[0] === "string" && args[0].includes("webgl")) return null;
        return (original as (...values: unknown[]) => unknown).apply(this, args);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto("/places?view=globe&q=Santorin");

    await expect(page.getByTestId("places-map-unavailable")).toContainText("WebGL2 indisponible");
    await expect(page.locator(".places-globe-canvas canvas")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "2D" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "3D" })).toHaveCount(0);
    await expect(page).not.toHaveURL(/view=/);

    await page.getByRole("button", { name: /Liste/ }).click();
    await page
      .getByRole("complementary", { name: "Liste des lieux" })
      .getByRole("button", { name: /Terrasse Santorin/ })
      .click();
    await expect(page.getByRole("dialog", { name: "Détail de Terrasse Santorin" })).toBeVisible();
  });

  test("garde le globe permanent utilisable au toucher @mobile @mobile-only", async ({ page }) => {
    await prepareMapCapture(page);
    await page.goto("/places");
    await waitForMap(page);
    const canvas = page.locator(".places-globe-canvas canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("The globe canvas has no bounding box.");

    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(canvas).toBeVisible();
    await expect(page.getByRole("button", { name: "2D" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "3D" })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});