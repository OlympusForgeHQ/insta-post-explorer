#!/usr/bin/env node
// MapLibre globe performance harness (decision D6).
//
// The budgets are measurable, not decorative, so this script measures the real
// page against a real database rather than estimating. It:
//   1. seeds a LOCAL PostgreSQL database with N synthetic places,
//   2. drives the built application in Chromium,
//   3. records the time to first globe render and the frame rate while rotating.
//
// The globe is continuous — there is no "3D" button. The harness navigates
// directly to /places?view=globe and measures from page load to the first
// MapLibre render event.
//
// It never touches a deployed database. `DATABASE_URL` must point at a local
// throwaway database; the script refuses anything that looks remote.
//
//   node scripts/places/measure-globe.mjs --counts 100,500,1000 --url http://127.0.0.1:3000
//
// Build the app with `NEXT_PUBLIC_PLACES_BENCHMARK=1` before starting it; normal
// production builds keep the benchmark-only window instrumentation disabled.
//
// Results are reported as measured. If a budget is missed, report the number —
// do not relax the budget.

import { PrismaClient } from "@prisma/client";
import { chromium, devices } from "@playwright/test";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);

const COUNTS = (args.get("counts") ?? "100,500,1000").split(",").map(Number);
const BASE_URL = args.get("url") ?? "http://127.0.0.1:3000";
const OWNER_ID = args.get("owner") ?? "perf-owner";
const SAMPLE_MS = Number(args.get("sample") ?? 4000);

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1|\/var\/lib\/postgresql/.test(databaseUrl)) {
  throw new Error("Refusing to run: DATABASE_URL must point at a local throwaway database.");
}

const prisma = new PrismaClient();

const PRECISIONS = ["EXACT", "PROBABLE", "APPROXIMATE"];

// Deterministic pseudo-random so two runs measure the same scene.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function seed(count) {
  await prisma.postPlace.deleteMany({ where: { ownerId: OWNER_ID } });
  await prisma.place.deleteMany({ where: { ownerId: OWNER_ID } });

  const random = mulberry32(count);
  const rows = Array.from({ length: count }, (_, index) => {
    const precision = PRECISIONS[index % PRECISIONS.length];
    return {
      ownerId: OWNER_ID,
      displayName: `Lieu de test ${index}`,
      normalizedName: `lieu de test ${index}`,
      category: index % 2 === 0 ? "catering.restaurant" : "catering.cafe",
      provider: "perf",
      providerPlaceId: `perf-${index}`,
      city: `Ville ${index % 120}`,
      country: `Pays ${index % 40}`,
      countryCode: String.fromCharCode(65 + (index % 26), 65 + Math.floor(index / 26) % 26),
      latitude: (random() - 0.5) * 170,
      longitude: (random() - 0.5) * 360,
      precision,
      confidence: 0.5 + random() * 0.5,
      approximationRadiusMeters: precision === "APPROXIMATE" ? 2_000 + Math.floor(random() * 20_000) : null,
    };
  });

  await prisma.place.createMany({ data: rows });
  return count;
}

async function measure(page, count) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("places-benchmark", "1");
    } catch {}
    window.__placesBenchmarkRenderCount = 0;
    window.__placesBenchmarkMap = null;
    window.addEventListener("places-map-ready", (event) => {
      window.__placesBenchmarkMap = event.detail;
    });
    window.addEventListener("places-map-render", () => {
      window.__placesBenchmarkRenderCount += 1;
    });
  });
  // The globe is now the continuous default view (no "3D" button); navigate
  // directly with ?view=globe so the harness works on both vector and raster
  // style paths. The benchmark init script fires before navigation, and the
  // map component dispatches "places-map-ready" + "places-map-render" events
  // when NEXT_PUBLIC_PLACES_BENCHMARK=1 is set.
  const startedAt = Date.now();
  await page.goto(`${BASE_URL}/places?view=globe`, { waitUntil: "domcontentloaded" });
  await page.locator(".places-globe-canvas canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => window.__placesBenchmarkMap && window.__placesBenchmarkRenderCount > 0,
    { timeout: 30_000 },
  );
  const firstRenderMs = Date.now() - startedAt;

  // Animate the real MapLibre camera for a fixed duration and count its render events.
  await page.evaluate(() => {
    window.__placesBenchmarkRenderCount = 0;
  });
  const start = Date.now();
  await page.evaluate((duration) => {
    const map = window.__placesBenchmarkMap;
    if (!map) throw new Error("Benchmark map was not exposed");
    map.easeTo({ bearing: map.getBearing() + 180, duration, easing: (value) => value });
  }, SAMPLE_MS);
  await page.waitForFunction(() => !window.__placesBenchmarkMap?.isMoving(), { timeout: SAMPLE_MS + 5_000 });
  const elapsed = Date.now() - start;
  const frames = await page.evaluate(() => {
    const count = window.__placesBenchmarkRenderCount;
    window.__placesBenchmarkRenderCount = 0;
    return count;
  });
  const fps = Math.round((frames / elapsed) * 1000);

  return { count, firstRenderMs, fps, frames, elapsedMs: elapsed };
}

const profiles = [
  ["desktop", { viewport: { width: 1440, height: 900 } }],
  ["mobile", devices["Pixel 7"]],
];

const results = [];
for (const count of COUNTS) {
  await seed(count);
  for (const [label, options] of profiles) {
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const result = await measure(page, count);
    results.push({ profile: label, ...result });
    console.log(
      `${label.padEnd(8)} ${String(count).padStart(5)} places   first render ${String(result.firstRenderMs).padStart(5)} ms   ${String(result.fps).padStart(3)} fps   ${result.frames} renders / ${result.elapsedMs} ms`,
    );
    await browser.close();
  }
}

const renderer = await (async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  const page = await browser.newPage();
  const info = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "none";
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  });
  await browser.close();
  return info;
})();

console.log("");
console.log(`WebGL renderer: ${renderer}`);
console.log(JSON.stringify(results, null, 2));

await prisma.postPlace.deleteMany({ where: { ownerId: OWNER_ID } });
await prisma.place.deleteMany({ where: { ownerId: OWNER_ID } });
await prisma.$disconnect();
