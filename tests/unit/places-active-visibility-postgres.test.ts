// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));

const databaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const OWNER = "owner-active-visibility";
const OTHER = "owner-active-visibility-other";
const previousDatabaseUrl = process.env.DATABASE_URL;
let prisma: PrismaClient;
let queries: typeof import("@/server/places/queries");
let mapView: typeof import("@/server/places/map-view");
let stats: typeof import("@/server/places/stats");
let sequence = 0;

async function place(overrides: Partial<Prisma.PlaceUncheckedCreateInput> = {}) {
  return prisma.place.create({ data: {
    ownerId: OWNER, displayName: "Historic place", normalizedName: "historic place",
    provider: "geoapify", providerPlaceId: `active-${++sequence}`,
    latitude: 48.8, longitude: 2.3, precision: "EXACT", confidence: 0.9,
    countryCode: "FR", continentCode: "EU", ...overrides,
  } });
}

async function post(ownerId = OWNER) {
  return prisma.post.create({ data: {
    ownerId, postUrl: `https://instagram.com/p/ACTIVE${++sequence}`,
    thumbnailUrl: "", authorUsername: "test", authorSortKey: "test",
    caption: "Historical evidence", searchText: "historical evidence",
    contentType: "IMAGE", mainTheme: "Cuisine",
  } });
}

async function link(postId: string, placeId: string, ownerId = OWNER) {
  await prisma.postPlace.create({ data: { ownerId, postId, placeId, precision: "EXACT", confidence: 0.9 } });
}

async function fixture() {
  const historicPost = await post();
  const linked = await place();
  const conflict = await place({ reviewStatus: "CONFLICT" });
  const confirmed = await place({ reviewStatus: "CONFIRMED", isUserConfirmed: true, countryCode: "JP", continentCode: "AS", precision: "APPROXIMATE", approximationRadiusMeters: 5000 });
  const legacyConfirmed = await place({ reviewStatus: "CONFIRMED" });
  const orphan = await place({ countryCode: "US", continentCode: "NA" });
  const orphanConflict = await place({ reviewStatus: "CONFLICT", countryCode: "US", continentCode: "NA" });
  const rejected = await place({ reviewStatus: "REJECTED", isUserConfirmed: true, countryCode: "AU", continentCode: "OC" });
  await link(historicPost.id, linked.id);
  await link(historicPost.id, conflict.id);
  await link(historicPost.id, rejected.id);
  const otherPost = await post(OTHER);
  const other = await place({ ownerId: OTHER, isUserConfirmed: true, countryCode: "CA", continentCode: "NA" });
  await link(otherPost.id, other.id, OTHER);
  const job = await prisma.placeAnalysisJob.create({ data: {
    ownerId: OWNER, postId: historicPost.id, sourceTheme: "Voyages",
    analysisVersion: "active-visibility", inputHash: "historic-unknown", status: "NEEDS_REVIEW",
  } });
  await prisma.placeEvidence.create({ data: {
    ownerId: OWNER, postId: historicPost.id, placeId: orphan.id, analysisJobId: job.id,
    evidenceType: "CAPTION", excerpt: "Historical evidence", confidence: 0.8,
  } });
  return { linked, conflict, confirmed, legacyConfirmed, orphan, orphanConflict, rejected, other };
}

async function resetDatabase() {
  const where = { ownerId: { in: [OWNER, OTHER] } };
  await prisma.post.deleteMany({ where });
  await prisma.place.deleteMany({ where });
}

describeWithDatabase("Active Places visibility on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("@/server/db"));
    queries = await import("@/server/places/queries");
    mapView = await import("@/server/places/map-view");
    stats = await import("@/server/places/stats");
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("keeps owner links across theme changes and manual confirmations in the default list and map", async () => {
    const f = await fixture();
    const expected = [f.linked.id, f.conflict.id, f.confirmed.id, f.legacyConfirmed.id].sort();
    expect((await queries.queryPlaces({ limit: 50 }, OWNER)).items.map(p => p.id).sort()).toEqual(expected);
    const view = await mapView.loadPlacesMapView(OWNER);
    expect(view.items.map(p => p.id).sort()).toEqual(expected);
    expect(view.items.find(p => p.id === f.linked.id)).toMatchObject({ postCount: 1, sourceThemes: [] });
    expect(view.items.find(p => p.id === f.confirmed.id)).toMatchObject({ postCount: 0, isUserConfirmed: true });
    expect((await queries.queryPlaces({ limit: 50 }, OTHER)).items.map(p => p.id)).toEqual([f.other.id]);
    expect((await queries.queryPlaces({ limit: 50, sourceTheme: "Voyages" }, OWNER)).items).toEqual([]);
  });

  it("retains explicit review queries and historical details with evidence", async () => {
    const f = await fixture();
    expect((await queries.queryPlaces({ limit: 50, reviewStatus: "UNREVIEWED" }, OWNER)).items.map(p => p.id).sort())
      .toEqual([f.linked.id, f.orphan.id].sort());
    expect((await queries.queryPlaces({ limit: 50, reviewStatus: "REJECTED" }, OWNER)).items.map(p => p.id)).toEqual([f.rejected.id]);
    expect(await queries.getPlaceDetail(f.orphan.id, OWNER)).toMatchObject({
      id: f.orphan.id, postCount: 0, evidence: [{ excerpt: "Historical evidence" }],
    });
    expect(await queries.getPlaceDetail(f.orphan.id, OTHER)).toBeNull();
    expect(await prisma.place.count({ where: { ownerId: OWNER } })).toBe(7);
  });

  it("uses the same active presence for Prisma and SQL statistics while retaining historical job counts", async () => {
    await fixture();
    const result = await stats.getPlacesStats({}, OWNER);
    expect(result.totals).toEqual({ eligiblePosts: 0, identifiedPlaces: 4, countries: 2, continents: 2, postsWithPlaces: 1, needsReview: 2 });
    expect(result.byCountry.map(({ countryCode, placeCount, postCount }) => ({ countryCode, placeCount, postCount })))
      .toEqual([{ countryCode: "FR", placeCount: 3, postCount: 1 }, { countryCode: "JP", placeCount: 1, postCount: 0 }]);
    expect(result.byContinent).toEqual([
      { continentCode: "EU", placeCount: 3, countryCount: 1, postCount: 1 },
      { continentCode: "AS", placeCount: 1, countryCount: 1, postCount: 0 },
    ]);
    expect(result.byPrecision).toEqual(expect.arrayContaining([{ precision: "EXACT", placeCount: 3 }, { precision: "APPROXIMATE", placeCount: 1 }]));
    expect(result.byReviewStatus).toEqual(expect.arrayContaining([
      { reviewStatus: "UNREVIEWED", placeCount: 1 }, { reviewStatus: "CONFLICT", placeCount: 1 },
      { reviewStatus: "CONFIRMED", placeCount: 2 }, { reviewStatus: "REJECTED", placeCount: 1 },
    ]));
    expect(result.byReviewStatus).toHaveLength(4);
    expect(result.byTheme).toEqual([{ theme: "Voyages", placeCount: 0, postCount: 0 }, { theme: "Restaurant", placeCount: 0, postCount: 0 }]);
    expect((await stats.getPlacesStats({ countryCode: "US" }, OWNER)).totals.identifiedPlaces).toBe(0);
    expect((await stats.getPlacesStats({}, OTHER)).totals.identifiedPlaces).toBe(1);
  });

  it("excludes inactive and rejected rows before the map cap and keeps true active overflow visible", async () => {
    const historicPost = await post();
    const linked = await place({ updatedAt: new Date("2020-01-01") });
    const confirmed = await place({ isUserConfirmed: true, updatedAt: new Date("2020-01-01") });
    await link(historicPost.id, linked.id);
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `active-inactive-${index}`, ownerId: OWNER, displayName: "Inactive", normalizedName: "inactive",
      provider: "geoapify", providerPlaceId: `inactive-${index}`,
      latitude: 48.8, longitude: 2.3, precision: "EXACT" as const, confidence: 0.9,
      reviewStatus: index % 2 ? "REJECTED" as const : "UNREVIEWED" as const,
      isUserConfirmed: index % 2 === 1, updatedAt: new Date("2026-01-01"),
    }));
    await prisma.place.createMany({ data: rows });
    // Rejections with genuine links must also be filtered before take.
    await prisma.postPlace.createMany({ data: rows.filter(r => r.reviewStatus === "REJECTED").map(r => ({
      ownerId: OWNER, placeId: r.id, postId: historicPost.id, precision: "EXACT" as const, confidence: 0.9,
    })) });
    const view = await mapView.loadPlacesMapView(OWNER);
    expect(view.items.map(p => p.id).sort()).toEqual([linked.id, confirmed.id].sort());
    expect(view.truncated).toBe(false);
    const smallView = await mapView.loadPlacesMapView(OWNER, 1);
    expect(smallView.items).toHaveLength(1);
    expect(smallView.truncated).toBe(true);
    const first = await queries.queryPlaces({ limit: 1 }, OWNER);
    const second = await queries.queryPlaces({ limit: 1, cursor: first.nextCursor! }, OWNER);
    expect([...first.items, ...second.items].map(p => p.id).sort()).toEqual([linked.id, confirmed.id].sort());
    expect(second.nextCursor).toBeNull();
  });
});
