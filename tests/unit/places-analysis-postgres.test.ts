// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));

import type { PlaceCandidate, PlaceCandidateRecord } from "@/lib/places/candidates";
import type { PlaceResolutionInput, PlaceResolver, ResolvedPlaceCandidate } from "@/server/places/resolvers/types";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const OWNER_A = "owner-analysis-a";
const OWNER_B = "owner-analysis-b";

let prisma: PrismaClient;
let analysis: typeof import("@/server/places/analysis");
let batch: typeof import("@/server/places/caption-batch");
let jobs: typeof import("@/server/places/jobs");
const previousDatabaseUrl = process.env.DATABASE_URL;

// Build a candidate record carrying the current input_hash + analysis_version,
// exactly as the exporter would stamp them, so the freshness gate passes.
async function freshRecord(ownerId: string, postId: string, candidates: PlaceCandidate[]): Promise<PlaceCandidateRecord> {
  const [line] = await batch.exportCaptionBatch({ ownerId, postId, force: true });
  return { post_id: postId, input_hash: line.input_hash, analysis_version: line.analysis_version, candidates };
}

// In-memory resolver: no network, no real Geoapify. Returns a scripted list per
// candidate name, or throws to simulate a provider failure.
class FakeResolver implements PlaceResolver {
  constructor(
    private readonly byName: Record<string, ResolvedPlaceCandidate[]>,
    private readonly failure?: Error,
  ) {}
  async resolve(input: PlaceResolutionInput): Promise<ResolvedPlaceCandidate[]> {
    if (this.failure) throw this.failure;
    return this.byName[input.candidate.name ?? ""] ?? [];
  }
}

function resolved(overrides: Partial<ResolvedPlaceCandidate> = {}): ResolvedPlaceCandidate {
  return {
    provider: "geoapify",
    providerPlaceId: "geo-nobu",
    displayName: "Nobu Dubai",
    category: "catering.restaurant",
    address: "Atlantis, Dubai",
    city: "Dubai",
    region: null,
    country: "United Arab Emirates",
    countryCode: "AE",
    latitude: 25.13,
    longitude: 55.11,
    providerResultType: "amenity",
    providerRank: 0.95,
    providerMatchType: "full_match",
    attribution: "Powered by Geoapify",
    ...overrides,
  };
}

function candidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    name: "Nobu Dubai",
    address: null,
    city: "Dubai",
    region: null,
    country: "United Arab Emirates",
    category: "restaurant",
    confidence: 0.95,
    evidence: [{ type: "CAPTION", excerpt: "Dinner at Nobu Dubai" }],
    ...overrides,
  };
}

describeWithDatabase("Places metadata analysis persistence on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("@/server/db"));
    analysis = await import("@/server/places/analysis");
    batch = await import("@/server/places/caption-batch");
    jobs = await import("@/server/places/jobs");
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(resetDatabase);

  it("persists a resolved EXACT place with one primary link and evidence", async () => {
    await seedPost("nobu-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    const result = await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "nobu-post", [candidate()]),
      resolver,
      commit: true,
    });

    expect(result.status).toBe("SUCCEEDED");
    const place = await prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(place.precision).toBe("EXACT");
    expect(place.approximationRadiusMeters).toBeNull();
    expect(place.continentCode).toBe("AS");
    const link = await prisma.postPlace.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(link.isPrimary).toBe(true);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "PROVIDER_MATCH" } })).toBe(1);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "CAPTION" } })).toBe(1);
    const job = await prisma.placeAnalysisJob.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(job.status).toBe("SUCCEEDED");
  });

  it("persists post-based cafe classification and timed evidence regardless of Geoapify category", async () => {
    await seedPost("brunch-post", OWNER_A, "Restaurant");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved({ category: "catering.fast_food" })] });
    const proposed = { ...candidate(), category: "cafe", categoryReason: "Brunch and coffee in the caption", evidence: [
      { type: "CAPTION", excerpt: "Brunch and coffee" },
      { type: "AUDIO_TRANSCRIPT", excerpt: "Nobu Dubai", videoTimestampMs: 4000, mediaId: "media-1" },
    ] } as PlaceCandidate;
    const record = await freshRecord(OWNER_A,"brunch-post",[proposed]);
    await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,record,resolver,commit:true});
    const place = await prisma.place.findFirstOrThrow({where:{ownerId:OWNER_A}});
    expect(place.category).toBe("cafe");
    expect(place.metadata).toMatchObject({classification:{source:"post_analysis",category:"cafe",reason:"Brunch and coffee in the caption"}});
    const audio = await prisma.placeEvidence.findFirstOrThrow({where:{ownerId:OWNER_A,evidenceType:"AUDIO_TRANSCRIPT"}});
    expect(audio.videoTimestampMs).toBe(4000);
    expect(audio.metadata).toMatchObject({mediaId:"media-1"});
    await prisma.place.update({where:{id:place.id},data:{isUserConfirmed:true,category:"patisserie"}});
    await analysis.analyzeCandidateBatchRecord({ownerId:OWNER_A,record,resolver,commit:true});
    expect((await prisma.place.findUniqueOrThrow({where:{id:place.id}})).category).toBe("patisserie");
  });

  it("persists an APPROXIMATE city with a mandatory radius", async () => {
    await seedPost("kyoto-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({
      Kyoto: [resolved({ providerPlaceId: "geo-kyoto", displayName: "Kyoto", city: "Kyoto", country: "Japan", countryCode: "JP", providerResultType: "city" })],
    });

    await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "kyoto-post", [candidate({ name: "Kyoto", city: "Kyoto", country: "Japan", confidence: 0.7 })]),
      resolver,
      commit: true,
    });

    const place = await prisma.place.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(place.precision).toBe("APPROXIMATE");
    expect(place.approximationRadiusMeters).toBe(10_000);
    expect(place.continentCode).toBe("AS");
  });

  it("keeps matching APPROXIMATE areas isolated to their source posts", async () => {
    await seedPost("kyoto-first", OWNER_A, "Voyages");
    await seedPost("kyoto-second", OWNER_A, "Restaurant");
    const resolver = new FakeResolver({
      Kyoto: [resolved({ providerPlaceId: "geo-kyoto", displayName: "Kyoto", city: "Kyoto", country: "Japan", countryCode: "JP", providerResultType: "city" })],
    });

    for (const postId of ["kyoto-first", "kyoto-second"]) {
      await analysis.analyzeCandidateBatchRecord({
        ownerId: OWNER_A,
        record: await freshRecord(OWNER_A, postId, [candidate({ name: "Kyoto", city: "Kyoto", country: "Japan", confidence: 0.7 })]),
        resolver,
        commit: true,
      });
    }

    expect(await prisma.place.count({ where: { ownerId: OWNER_A, precision: "APPROXIMATE" } })).toBe(2);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, precision: "APPROXIMATE" } })).toBe(2);
  });

  it("records an UNKNOWN candidate as evidence only and creates no place", async () => {
    await seedPost("country-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({
      Japan: [resolved({ providerPlaceId: "geo-jp", displayName: "Japan", city: null, country: "Japan", countryCode: "JP", providerResultType: "country" })],
    });

    const result = await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "country-post", [candidate({ name: "Japan", city: null, country: "Japan", evidence: [{ type: "CAPTION", excerpt: "Somewhere in Japan" }] })]),
      resolver,
      commit: true,
    });

    expect(result.status).toBe("NEEDS_REVIEW");
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(0);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(0);
    const evidence = await prisma.placeEvidence.findFirstOrThrow({ where: { ownerId: OWNER_A, evidenceType: "CAPTION" } });
    expect(evidence.placeId).toBeNull();
    const job = await prisma.placeAnalysisJob.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(job.status).toBe("NEEDS_REVIEW");
  });

  it("links multiple distinct places with exactly one primary", async () => {
    await seedPost("multi-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({
      "Nobu Dubai": [resolved()],
      "Louvre Abu Dhabi": [resolved({ providerPlaceId: "geo-louvre", displayName: "Louvre Abu Dhabi", city: "Abu Dhabi", country: "United Arab Emirates", countryCode: "AE", providerResultType: "amenity" })],
    });

    await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "multi-post", [
        candidate({ confidence: 0.95 }),
        candidate({ name: "Louvre Abu Dhabi", city: "Abu Dhabi", confidence: 0.8 }),
      ]),
      resolver,
      commit: true,
    });

    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(2);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(2);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, isPrimary: true } })).toBe(1);
  });

  it("deduplicates the same place mentioned twice in one post", async () => {
    await seedPost("dup-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "dup-post", [
        candidate({ evidence: [{ type: "CAPTION", excerpt: "Nobu again" }] }),
        candidate({ evidence: [{ type: "HASHTAG", excerpt: "#nobu" }] }),
      ]),
      resolver,
      commit: true,
    });

    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(1);
  });

  it("cancels non-terminal jobs when the post left an eligible theme", async () => {
    await seedPost("stale-post", OWNER_A, "Voyages");
    const record = await freshRecord(OWNER_A, "stale-post", [candidate()]);
    const job = await jobs.createMetadataAnalysisJob({ ownerId: OWNER_A, postId: "stale-post" });
    await prisma.post.update({ where: { id: "stale-post" }, data: { mainTheme: "Cuisine" } });
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    await expect(
      analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true }),
    ).rejects.toMatchObject({ code: "POST_NOT_PLACES_ELIGIBLE" });

    const refreshed = await prisma.placeAnalysisJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshed.status).toBe("CANCELLED");
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("never overwrites a user-confirmed link", async () => {
    await seedPost("confirmed-post", OWNER_A, "Voyages");
    const place = await prisma.place.create({
      data: {
        ownerId: OWNER_A,
        displayName: "Nobu Dubai",
        normalizedName: "nobu dubai",
        provider: "geoapify",
        providerPlaceId: "geo-nobu",
        latitude: 25.13,
        longitude: 55.11,
        precision: "EXACT",
        confidence: 1,
      },
    });
    await prisma.postPlace.create({
      data: { ownerId: OWNER_A, postId: "confirmed-post", placeId: place.id, isPrimary: true, isUserConfirmed: true, precision: "EXACT", confidence: 1 },
    });

    const resolver = new FakeResolver({ "Nobu Dubai": [resolved({ providerRank: 0.5 })] });
    await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "confirmed-post", [candidate({ confidence: 0.6 })]),
      resolver,
      commit: true,
    });

    const link = await prisma.postPlace.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(link.isUserConfirmed).toBe(true);
    expect(link.confidence).toBe(1);
    expect(link.isPrimary).toBe(true);
  });

  it("supersedes only the previous automatic approximate primary when an exact primary is persisted", async () => {
    for (const [postId, confirmed] of [
      ["upgrade-auto-post", false],
      ["upgrade-confirmed-post", true],
    ] as const) {
      await seedPost(postId, OWNER_A, "Voyages");
      const oldPlace = await prisma.place.create({
        data: {
          ownerId: OWNER_A,
          displayName: "Dubai",
          normalizedName: "dubai",
          provider: "geoapify",
          providerPlaceId: `geo-old-${postId}`,
          city: "Dubai",
          latitude: 25.2,
          longitude: 55.3,
          precision: "APPROXIMATE",
          confidence: 0.7,
          approximationRadiusMeters: 10_000,
        },
      });
      await prisma.postPlace.create({
        data: {
          ownerId: OWNER_A,
          postId,
          placeId: oldPlace.id,
          isPrimary: true,
          isUserConfirmed: confirmed,
          precision: "APPROXIMATE",
          confidence: 0.7,
        },
      });

      await analysis.analyzeCandidateBatchRecord({
        ownerId: OWNER_A,
        record: await freshRecord(OWNER_A, postId, [candidate()]),
        resolver: new FakeResolver({
          "Nobu Dubai": [resolved({ providerPlaceId: `geo-exact-${postId}` })],
        }),
        commit: true,
      });
    }

    const automaticLinks = await prisma.postPlace.findMany({
      where: { ownerId: OWNER_A, postId: "upgrade-auto-post" },
      orderBy: { precision: "asc" },
    });
    expect(automaticLinks).toHaveLength(1);
    expect(automaticLinks[0]).toMatchObject({
      precision: "EXACT",
      isPrimary: true,
      isUserConfirmed: false,
    });

    const confirmedLinks = await prisma.postPlace.findMany({
      where: { ownerId: OWNER_A, postId: "upgrade-confirmed-post" },
    });
    expect(confirmedLinks).toHaveLength(2);
    expect(confirmedLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          precision: "APPROXIMATE",
          isPrimary: true,
          isUserConfirmed: true,
        }),
        expect.objectContaining({
          precision: "EXACT",
          isPrimary: false,
          isUserConfirmed: false,
        }),
      ]),
    );
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(4);
  });

  it("rolls back and marks the job FAILED on a provider failure", async () => {
    await seedPost("fail-post", OWNER_A, "Voyages");
    const record = await freshRecord(OWNER_A, "fail-post", [candidate()]);
    const resolver = new FakeResolver({}, Object.assign(new Error("GEOAPIFY_UNAVAILABLE"), { code: "GEOAPIFY_UNAVAILABLE" }));

    await expect(
      analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true }),
    ).rejects.toThrow();

    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(0);
    const job = await prisma.placeAnalysisJob.findFirstOrThrow({ where: { ownerId: OWNER_A } });
    expect(job.status).toBe("FAILED");
    expect(job.errorCode).toBe("GEOAPIFY_UNAVAILABLE");
  });

  it("isolates analysis by owner", async () => {
    await seedPost("owned-post", OWNER_A, "Voyages");
    const record = await freshRecord(OWNER_A, "owned-post", [candidate()]);
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    await expect(
      analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_B, record, resolver, commit: true }),
    ).rejects.toMatchObject({ code: "POST_NOT_FOUND" });
    expect(await prisma.place.count({ where: { ownerId: OWNER_B } })).toBe(0);
  });

  it("writes nothing in dry-run mode", async () => {
    await seedPost("dry-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });

    const result = await analysis.analyzeCandidateBatchRecord({
      ownerId: OWNER_A,
      record: await freshRecord(OWNER_A, "dry-post", [candidate()]),
      resolver,
      commit: false,
    });

    expect(result.status).toBe("SKIPPED_DRY_RUN");
    expect(result.placesPersisted).toBe(1);
    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(0);
    expect(await prisma.placeAnalysisJob.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("is idempotent when committed twice", async () => {
    await seedPost("idem-post", OWNER_A, "Voyages");
    const resolver = new FakeResolver({ "Nobu Dubai": [resolved()] });
    const record = await freshRecord(OWNER_A, "idem-post", [candidate()]);

    await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true });
    await analysis.analyzeCandidateBatchRecord({ ownerId: OWNER_A, record, resolver, commit: true });

    expect(await prisma.place.count({ where: { ownerId: OWNER_A } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(1);
    expect(await prisma.placeAnalysisJob.count({ where: { ownerId: OWNER_A } })).toBe(1);
    // Evidence is rebuilt, not duplicated: one CAPTION + one PROVIDER_MATCH.
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A } })).toBe(2);
  });
});

let postCounter = 0;

async function seedPost(id: string, ownerId: string, mainTheme: string): Promise<void> {
  postCounter += 1;
  await prisma.post.create({
    data: {
      id,
      ownerId,
      postUrl: `https://instagram.com/p/PA${postCounter}`,
      thumbnailUrl: "https://example.com/t.jpg",
      authorUsername: "alice",
      authorSortKey: "alice",
      caption: "A trip",
      searchText: "alice trip",
      contentType: "IMAGE",
      mainTheme,
    },
  });
}

async function resetDatabase(): Promise<void> {
  const owners = { ownerId: { in: [OWNER_A, OWNER_B] } };
  await prisma.post.deleteMany({ where: owners });
  await prisma.place.deleteMany({ where: owners });
}
