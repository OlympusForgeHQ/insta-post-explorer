// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));

const databaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const OWNER_A = "owner-mapview-a";
const OWNER_B = "owner-mapview-b";

let prisma: PrismaClient;
let mapView: typeof import("@/server/places/map-view");
const previousDatabaseUrl = process.env.DATABASE_URL;

describeWithDatabase("Places map view on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("@/server/db"));
    mapView = await import("@/server/places/map-view");
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(resetDatabase);

  it("loads valid post-place links in primary order without leaking another owner's links", async () => {
    const library = await import("@/server/library");
    const post = await seedPost(OWNER_A, "Cuisine");
    const primary = await seedPlace(OWNER_A, { providerPlaceId: "primary", address: "12 rue de l'Église" });
    const secondary = await seedPlace(OWNER_A, { providerPlaceId: "secondary" });
    const rejected = await seedPlace(OWNER_A, { providerPlaceId: "rejected", reviewStatus: "REJECTED" });
    await linkPostPlace(OWNER_A, post, secondary.id, { confidence: 1 });
    await linkPostPlace(OWNER_A, post, primary.id, { isPrimary: true, confidence: 0.8 });
    await linkPostPlace(OWNER_A, post, rejected.id);
    const unlinked = await seedPost(OWNER_A, "Voyages");

    expect(await library.getLibraryPost(post, OWNER_A)).toMatchObject({
      places: [{ id: primary.id, address: "12 rue de l'Église" }, { id: secondary.id }],
    });
    expect(await library.getLibraryPost(unlinked, OWNER_A)).toMatchObject({ places: [] });
    expect(await library.getLibraryPost(post, OWNER_B)).toBeNull();
    expect((await mapView.loadPlacesMapView(OWNER_A)).items.find((place) => place.id === primary.id))
      .toMatchObject({ address: "12 rue de l'Église" });
  });

  it("returns only the requesting owner's places with their post count", async () => {
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-mv-1", category: "catering.cafe" });
    await seedPlace(OWNER_B, { providerPlaceId: "geo-mv-b" });
    await linkPostPlace(OWNER_A, await seedPost(OWNER_A, "Voyages"), place.id);
    await linkPostPlace(OWNER_A, await seedPost(OWNER_A, "Voyages"), place.id);

    const view = await mapView.loadPlacesMapView(OWNER_A);
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ id: place.id, postCount: 2, categoryGroup: "cafe" });
    expect(view.truncated).toBe(false);
  });

  // Regression: sourceThemes used to be derived from a truncated relation, so a
  // second theme appearing after the sixth link was invisible to the theme filter.
  it("collects every source theme even when it appears after the sixth link", async () => {
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-mv-themes" });
    for (let index = 0; index < 8; index += 1) {
      await linkPostPlace(OWNER_A, await seedPost(OWNER_A, "Voyages"), place.id);
    }
    // The ninth link is the only Restaurant one.
    await linkPostPlace(OWNER_A, await seedPost(OWNER_A, "Restaurant"), place.id);

    const view = await mapView.loadPlacesMapView(OWNER_A);
    expect(view.items[0].postCount).toBe(9);
    expect(view.items[0].sourceThemes.sort()).toEqual(["Restaurant", "Voyages"]);
  });

  it("canonicalizes folded theme variants and ignores ineligible themes", async () => {
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-mv-folded" });
    await linkPostPlace(OWNER_A, await seedPost(OWNER_A, "restaurant"), place.id); // folded variant
    await linkPostPlace(OWNER_A, await seedPost(OWNER_A, "Cuisine"), place.id); // not eligible

    const view = await mapView.loadPlacesMapView(OWNER_A);
    expect(view.items[0].sourceThemes).toEqual(["Restaurant"]);
  });

  it("keeps the theme filter and the map view consistent for a many-linked place", async () => {
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-mv-consistency" });
    for (let index = 0; index < 7; index += 1) {
      await linkPostPlace(OWNER_A, await seedPost(OWNER_A, "Voyages"), place.id);
    }
    await linkPostPlace(OWNER_A, await seedPost(OWNER_A, "Restaurant"), place.id);

    const queries = await import("@/server/places/queries");
    const restaurant = await queries.queryPlaces({ limit: 50, sourceTheme: "Restaurant" } as never, OWNER_A);
    const view = await mapView.loadPlacesMapView(OWNER_A);

    // The API filter finds the place through its late Restaurant link; the map
    // view must advertise the same theme, otherwise the two would disagree.
    expect(restaurant.items.map((item) => item.id)).toEqual([place.id]);
    expect(view.items[0].sourceThemes).toContain("Restaurant");
  });

  it("prefers the primary link for the preview thumbnail", async () => {
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-mv-thumb" });
    const secondary = await seedPost(OWNER_A, "Voyages", "https://example.com/secondary.jpg");
    const primary = await seedPost(OWNER_A, "Voyages", "https://example.com/primary.jpg");
    await linkPostPlace(OWNER_A, secondary, place.id, { isPrimary: false, confidence: 0.5 });
    await linkPostPlace(OWNER_A, primary, place.id, { isPrimary: true, confidence: 0.4 });

    const view = await mapView.loadPlacesMapView(OWNER_A);
    expect(view.items[0].previewThumbnailUrl).toBe("https://example.com/primary.jpg");
  });

  it("reports truncation instead of silently dropping places", async () => {
    await seedPlace(OWNER_A, { providerPlaceId: "geo-mv-t1" });
    await seedPlace(OWNER_A, { providerPlaceId: "geo-mv-t2" });
    const view = await mapView.loadPlacesMapView(OWNER_A, 1);
    expect(view.items).toHaveLength(1);
    expect(view.truncated).toBe(true);
  });
});

let placeCounter = 0;
let postCounter = 0;

async function seedPlace(ownerId: string, overrides: Record<string, unknown> = {}) {
  placeCounter += 1;
  return prisma.place.create({
    data: {
      ownerId,
      displayName: "Place",
      normalizedName: "place",
      provider: "geoapify",
      providerPlaceId: `geo-mv-${placeCounter}`,
      latitude: 25.1,
      longitude: 55.1,
      precision: "EXACT",
      confidence: 0.9,
      ...overrides,
    },
  });
}

async function seedPost(ownerId: string, mainTheme: string, thumbnailUrl = "https://example.com/t.jpg"): Promise<string> {
  postCounter += 1;
  const post = await prisma.post.create({
    data: {
      ownerId,
      postUrl: `https://instagram.com/p/MV${postCounter}`,
      thumbnailUrl,
      authorUsername: "alice",
      authorSortKey: "alice",
      caption: "A trip",
      searchText: "alice trip",
      contentType: "IMAGE",
      mainTheme,
    },
    select: { id: true },
  });
  return post.id;
}

async function linkPostPlace(
  ownerId: string,
  postId: string,
  placeId: string,
  overrides: { isPrimary?: boolean; confidence?: number } = {},
): Promise<void> {
  await prisma.postPlace.create({
    data: {
      ownerId,
      postId,
      placeId,
      isPrimary: overrides.isPrimary ?? false,
      precision: "EXACT",
      confidence: overrides.confidence ?? 0.9,
    },
  });
}

async function resetDatabase(): Promise<void> {
  const owners = { ownerId: { in: [OWNER_A, OWNER_B] } };
  await prisma.post.deleteMany({ where: owners });
  await prisma.place.deleteMany({ where: owners });
}
