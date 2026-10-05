// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));

const databaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const OWNER_A = "owner-queries-a";
const OWNER_B = "owner-queries-b";

let prisma: PrismaClient;
let queries: typeof import("@/server/places/queries");
const previousDatabaseUrl = process.env.DATABASE_URL;

describeWithDatabase("Places read queries on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("@/server/db"));
    queries = await import("@/server/places/queries");
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(resetDatabase);

  it("lists only the requesting owner's places and counts distinct linked posts", async () => {
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-1", city: "Dubai", countryCode: "AE", continentCode: "AS" });
    await seedPlace(OWNER_B, { providerPlaceId: "geo-b" });
    const postA = await seedPost(OWNER_A);
    const postB = await seedPost(OWNER_A);
    await linkPostPlace(OWNER_A, postA, place.id);
    await linkPostPlace(OWNER_A, postB, place.id);
    // Extra evidence must not inflate postCount.
    await seedEvidence(OWNER_A, postA, place.id);
    await seedEvidence(OWNER_A, postA, place.id);

    const page = await queries.queryPlaces({ limit: 50 }, OWNER_A);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(place.id);
    expect(page.items[0].postCount).toBe(2);
    expect(page.nextCursor).toBeNull();
  });

  it("paginates deterministically with no duplicates or omissions", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedPlace(OWNER_A, { isUserConfirmed: true, providerPlaceId: `geo-${i}` });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await queries.queryPlaces({ limit: 2, cursor }, OWNER_A);
      seen.push(...page.items.map((item) => item.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("applies country, continent, precision, review status, and text filters", async () => {
    await seedPlace(OWNER_A, { isUserConfirmed: true, providerPlaceId: "fr", displayName: "Louvre", normalizedName: "louvre", countryCode: "FR", continentCode: "EU", precision: "EXACT", reviewStatus: "UNREVIEWED", city: "Paris" });
    await seedPlace(OWNER_A, { isUserConfirmed: true, providerPlaceId: "jp", displayName: "Kyoto", normalizedName: "kyoto", countryCode: "JP", continentCode: "AS", precision: "APPROXIMATE", approximationRadiusMeters: 25000, reviewStatus: "CONFIRMED", city: "Kyoto" });

    expect((await queries.queryPlaces({ limit: 50, countryCode: "FR" }, OWNER_A)).items).toHaveLength(1);
    expect((await queries.queryPlaces({ limit: 50, continentCode: "AS" }, OWNER_A)).items[0].displayName).toBe("Kyoto");
    expect((await queries.queryPlaces({ limit: 50, precision: "APPROXIMATE" }, OWNER_A)).items[0].displayName).toBe("Kyoto");
    expect((await queries.queryPlaces({ limit: 50, reviewStatus: "CONFIRMED" }, OWNER_A)).items[0].displayName).toBe("Kyoto");
    expect((await queries.queryPlaces({ limit: 50, q: "louvre" }, OWNER_A)).items[0].displayName).toBe("Louvre");
  });

  it("returns a detail DTO with bounded evidence and provider metadata, owner-scoped", async () => {
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-d", metadata: { providerResultType: "amenity", attribution: "Powered by Geoapify", secretKey: "should-not-leak" } });
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, place.id, job);
    await seedEvidence(OWNER_A, post, place.id, job, "Dinner at Nobu");

    const detail = await queries.getPlaceDetail(place.id, OWNER_A);
    expect(detail).not.toBeNull();
    expect(detail!.provider).toBe("geoapify");
    expect(detail!.providerResultType).toBe("amenity");
    expect(detail!.attribution).toBe("Powered by Geoapify");
    expect(detail!.evidence).toHaveLength(1);
    expect(detail!.evidence[0].excerpt).toBe("Dinner at Nobu");
    // Provider metadata never leaks arbitrary keys.
    expect(JSON.stringify(detail)).not.toContain("should-not-leak");

    expect(await queries.getPlaceDetail(place.id, OWNER_B)).toBeNull();
  });

  it("returns a place's linked posts and treats a cross-owner place as absent", async () => {
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-p" });
    const post = await seedPost(OWNER_A);
    await linkPostPlace(OWNER_A, post, place.id);

    const page = await queries.getPlacePosts(place.id, { limit: 50 }, OWNER_A);
    expect(page).not.toBeNull();
    expect(page!.items).toHaveLength(1);
    expect(page!.items[0].postId).toBe(post);

    expect(await queries.getPlacePosts(place.id, { limit: 50 }, OWNER_B)).toBeNull();
  });

  it("lists eligible posts without a place link and excludes linked or ineligible posts", async () => {
    const eligibleUnlinked = await seedPost(OWNER_A, "Voyages");
    const eligibleLinked = await seedPost(OWNER_A, "Restaurant");
    await seedPost(OWNER_A, "Cuisine"); // ineligible
    const place = await seedPlace(OWNER_A, { providerPlaceId: "geo-e" });
    await linkPostPlace(OWNER_A, eligibleLinked, place.id);

    const page = await queries.queryEligiblePosts({ limit: 50 }, OWNER_A);
    const ids = page.items.map((item) => item.postId);
    expect(ids).toContain(eligibleUnlinked);
    expect(ids).not.toContain(eligibleLinked);
    expect(ids).toHaveLength(1);
  });

  it("lists NEEDS_REVIEW jobs and returns a safe job detail without the error message", async () => {
    const post = await seedPost(OWNER_A);
    const job = await prisma.placeAnalysisJob.create({
      data: {
        ownerId: OWNER_A,
        postId: post,
        sourceTheme: "Voyages",
        analysisVersion: "places-v1",
        inputHash: "hash-nr",
        status: "NEEDS_REVIEW",
        errorCode: "SAFE_CODE",
        errorMessage: "sensitive detail should never surface",
      },
    });

    const page = await queries.queryUnresolvedPlaceJobs({ limit: 50 }, OWNER_A);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].jobId).toBe(job.id);

    const detail = await queries.getPlaceAnalysisJob(job.id, OWNER_A);
    expect(detail).not.toBeNull();
    expect(detail!.errorCode).toBe("SAFE_CODE");
    expect(JSON.stringify(detail)).not.toContain("sensitive detail");
    expect(await queries.getPlaceAnalysisJob(job.id, OWNER_B)).toBeNull();
  });

  // --- Phase G additive read-only filters ---

  it("filters owner categories and sends unclassified provider strings to Divers", async () => {
    await seedPlace(OWNER_A,{isUserConfirmed:true,providerPlaceId:"classified-cafe",category:"cafe"});
    await seedPlace(OWNER_A,{isUserConfirmed:true,providerPlaceId:"classified-restaurant",category:"restaurant"});
    await seedPlace(OWNER_A,{isUserConfirmed:true,providerPlaceId:"legacy-cafe",category:"catering.cafe"});
    await seedPlace(OWNER_A,{isUserConfirmed:true,providerPlaceId:"empty",category:null});
    await seedPlace(OWNER_A,{isUserConfirmed:true,providerPlaceId:"other",category:"divers"});
    const food=await queries.queryPlaces({limit:50,categoryGroups:["restaurant","cafe"]} as never,OWNER_A);
    expect(food.items.map(p=>p.category).sort()).toEqual(["cafe","restaurant"]);
    const other=await queries.queryPlaces({limit:50,categoryGroups:["divers"]} as never,OWNER_A);
    expect(other.items.map(p=>p.category)).toEqual(expect.arrayContaining([null,"divers","catering.cafe"]));
    expect(other.items).toHaveLength(3);
  });

  it("keeps the historical single-category filter working", async () => {
    await seedPlace(OWNER_A, { isUserConfirmed: true, providerPlaceId: "geo-c1", category: "catering.cafe" });
    await seedPlace(OWNER_A, { isUserConfirmed: true, providerPlaceId: "geo-c2", category: "catering.restaurant" });
    const page = await queries.queryPlaces({ limit: 50, category: "catering.cafe" } as never, OWNER_A);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].category).toBe("catering.cafe");
  });

  it("filters the list by source theme through post links, never collections", async () => {
    const travel = await seedPlace(OWNER_A, { providerPlaceId: "geo-travel" });
    const food = await seedPlace(OWNER_A, { providerPlaceId: "geo-food" });
    const travelPost = await seedPost(OWNER_A, "Voyages");
    const foodPost = await seedPost(OWNER_A, "restaurant"); // folded variant of Restaurant
    await linkPostPlace(OWNER_A, travelPost, travel.id);
    await linkPostPlace(OWNER_A, foodPost, food.id);

    const voyages = await queries.queryPlaces({ limit: 50, sourceTheme: "Voyages" } as never, OWNER_A);
    expect(voyages.items.map((item) => item.id)).toEqual([travel.id]);

    const restaurant = await queries.queryPlaces({ limit: 50, sourceTheme: "Restaurant" } as never, OWNER_A);
    expect(restaurant.items.map((item) => item.id)).toEqual([food.id]);
  });

  it("combines the place-type and source-theme filters and stays owner-scoped", async () => {
    const mine = await seedPlace(OWNER_A, { providerPlaceId: "geo-mine", category: "cafe" });
    const otherTheme = await seedPlace(OWNER_A, { providerPlaceId: "geo-other-theme", category: "cafe" });
    await seedPlace(OWNER_B, { providerPlaceId: "geo-b-cafe", category: "cafe" });
    const travelPost = await seedPost(OWNER_A, "Voyages");
    const foodPost = await seedPost(OWNER_A, "Restaurant");
    await linkPostPlace(OWNER_A, travelPost, mine.id);
    await linkPostPlace(OWNER_A, foodPost, otherTheme.id);

    const page = await queries.queryPlaces(
      { limit: 50, categoryGroups: ["cafe"], sourceTheme: "Voyages" } as never,
      OWNER_A,
    );
    expect(page.items.map((item) => item.id)).toEqual([mine.id]);
  });
});

let placeCounter = 0;
let postCounter = 0;
let jobCounter = 0;

async function seedPlace(ownerId: string, overrides: Record<string, unknown> = {}) {
  placeCounter += 1;
  return prisma.place.create({
    data: {
      ownerId,
      displayName: "Nobu Dubai",
      normalizedName: "nobu dubai",
      provider: "geoapify",
      providerPlaceId: `geo-${placeCounter}`,
      latitude: 25.1,
      longitude: 55.1,
      precision: "EXACT",
      confidence: 0.9,
      ...overrides,
    },
  });
}

async function seedPost(ownerId: string, mainTheme = "Voyages"): Promise<string> {
  postCounter += 1;
  const post = await prisma.post.create({
    data: {
      ownerId,
      postUrl: `https://instagram.com/p/PQ${postCounter}`,
      thumbnailUrl: "https://example.com/t.jpg",
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

async function seedJob(ownerId: string, postId: string): Promise<string> {
  jobCounter += 1;
  const job = await prisma.placeAnalysisJob.create({
    data: { ownerId, postId, sourceTheme: "Voyages", analysisVersion: "places-v1", inputHash: `qh-${jobCounter}` },
    select: { id: true },
  });
  return job.id;
}

async function linkPostPlace(ownerId: string, postId: string, placeId: string, analysisJobId?: string): Promise<void> {
  await prisma.postPlace.create({
    data: { ownerId, postId, placeId, analysisJobId, precision: "EXACT", confidence: 0.9 },
  });
}

async function seedEvidence(ownerId: string, postId: string, placeId: string, analysisJobId?: string, excerpt = "evidence"): Promise<void> {
  const jobId = analysisJobId ?? (await seedJob(ownerId, postId));
  await prisma.placeEvidence.create({
    data: { ownerId, postId, placeId, analysisJobId: jobId, evidenceType: "CAPTION", excerpt, confidence: 0.8 },
  });
}

async function resetDatabase(): Promise<void> {
  const owners = { ownerId: { in: [OWNER_A, OWNER_B] } };
  await prisma.post.deleteMany({ where: owners });
  await prisma.place.deleteMany({ where: owners });
}
