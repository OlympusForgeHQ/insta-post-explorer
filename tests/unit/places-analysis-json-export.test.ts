// @vitest-environment node

import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_CANDIDATES_PER_POST } from "@/lib/places/candidates";

vi.mock("server-only", () => ({}));

const batchMocks = vi.hoisted(() => ({
  postFindMany: vi.fn(),
  postCount: vi.fn(),
  postGroupBy: vi.fn(),
  jobFindFirst: vi.fn(),
  loadAnalysisPostInputs: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  prisma: {
    post: {
      findMany: batchMocks.postFindMany,
      count: batchMocks.postCount,
      groupBy: batchMocks.postGroupBy,
    },
    placeAnalysisJob: {
      findFirst: batchMocks.jobFindFirst,
    },
  },
}));

vi.mock("@/server/places/repository", () => ({
  loadAnalysisPostInputs: batchMocks.loadAnalysisPostInputs,
}));

import {
  buildPlacesAnalysisInput,
  parsePlacesAnalysisExportArgs,
  placesAnalysisInputSchema,
  resolvePlacesTargetDatabase,
  resolveSafeAnalysisOutputPath,
  sanitizePlacesAnalysisExportError,
  writePlacesAnalysisInputFile,
} from "@/server/places/analysis-json-export";
import type { CaptionBatchRecord } from "@/server/places/caption-batch";
import { computePlacesInputHash } from "@/server/places/hash";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function captionRecord(overrides: Partial<CaptionBatchRecord> = {}): CaptionBatchRecord {
  return {
    post_id: "post-1",
    main_theme: "Voyages",
    caption: "Café à Paris\nEncore #Paris #Été @Guide_Paris @guide_paris 😀",
    hashtags: ["Paris", "Été"],
    internal_tags: ["été", "favori"],
    author_username: "alice",
    instagram_location: "Paris, France",
    input_hash: "a".repeat(64),
    analysis_version: "places-v1",
    ...overrides,
  };
}

function source() {
  return {
    repository: "L1nK4R1M/insta-saved-post-explorer" as const,
    branch: "develop" as const,
    commit: "1".repeat(40),
    target: "production" as const,
    owner_id: "local",
    analysis_version: "places-v1",
  };
}

async function makeRepositoryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "places-analysis-export-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".tmp", "places"), { recursive: true });
  return root;
}

describe("Places analysis JSON document", () => {
  it("preserves complete text and emits the exact strict record contract", () => {
    const document = buildPlacesAnalysisInput([captionRecord()], source(), new Date("2026-07-28T12:34:56.000Z"));

    expect(document.schema_version).toBe("places-caption-analysis-input-v3");
    expect(document.generated_at).toBe("2026-07-28T12:34:56.000Z");
    expect(document.summary).toEqual({ record_count: 1, voyages_count: 1, restaurant_count: 0 });
    expect(document.records[0]).toEqual({
      post_id: "post-1",
      main_theme: "Voyages",
      caption: "Café à Paris\nEncore #Paris #Été @Guide_Paris @guide_paris 😀",
      hashtags: ["#Paris", "#Été"],
      mentions: ["@Guide_Paris"],
      internal_tags: ["été", "favori"],
      author_username: "alice",
      instagram_location: "Paris, France",
      input_hash: "a".repeat(64),
      analysis_version: "places-v1",
    });
    expect(Object.keys(document.records[0])).toEqual([
      "post_id",
      "main_theme",
      "caption",
      "hashtags",
      "mentions",
      "internal_tags",
      "author_username",
      "instagram_location",
      "input_hash",
      "analysis_version",
    ]);
    expect(document.candidate_output_contract).toEqual({
      format: "jsonl",
      maximum_candidates_per_post: MAX_CANDIDATES_PER_POST,
      coordinates_forbidden: true,
      provider_fields_forbidden: true,
      precision_field_forbidden: true,
      required_identity_fields: ["post_id", "input_hash", "analysis_version"],
      required_candidate_fields: [
        "name",
        "address",
        "city",
        "region",
        "country",
        "category",
        "confidence",
        "evidence",
      ],
      nullable_candidate_fields: ["name", "address", "city", "region", "country"],
    });
    expect(placesAnalysisInputSchema.parse(document)).toEqual(document);
  });

  it("gives places-v2 a distinct re-analysis identity from places-v1", () => {
    const common = {
      postId: "post-1",
      sourceTheme: "Voyages",
      caption: "12 rue de l'Independance Americaine, 78000 Versailles",
      authorUsername: "hungryconsti",
      internalTags: [],
      structuredLocation: null,
      verifiedMedia: [],
    };

    expect(
      computePlacesInputHash({ ...common, analysisVersion: "places-v2" }),
    ).not.toBe(computePlacesInputHash({ ...common, analysisVersion: "places-v1" }));
  });

  it.each([
    ["duplicate post id", [captionRecord(), captionRecord({ main_theme: "Restaurant" })]],
    ["invalid hash", [captionRecord({ input_hash: "ABC" })]],
    ["empty analysis version", [captionRecord({ analysis_version: "" })]],
  ])("rejects %s", (_label, records) => {
    expect(() => buildPlacesAnalysisInput(records, source())).toThrow();
  });

  it.each([
    "latitude",
    "longitude",
    "coordinates",
    "provider",
    "providerPlaceId",
    "precision",
    "objectKey",
    "signedUrl",
    "secret",
    "DATABASE_URL",
    "GEOAPIFY_API_KEY",
  ])("rejects the forbidden or unknown record field %s", (field) => {
    const document = buildPlacesAnalysisInput([captionRecord()], source());
    const withUnknownField = structuredClone(document) as unknown as {
      records: Array<Record<string, unknown>>;
    };
    withUnknownField.records[0][field] = "forbidden";
    expect(() => placesAnalysisInputSchema.parse(withUnknownField)).toThrow();
  });
});

describe("Places analysis target and arguments", () => {
  it("parses the reusable command flags", () => {
    expect(
      parsePlacesAnalysisExportArgs([
        "--all",
        "--target",
        "production",
        "--owner",
        "owner-a",
        "--post-id",
        "post-a",
        "--output",
        ".tmp/places/custom.json",
      ]),
    ).toEqual({
      all: true,
      target: "production",
      owner: "owner-a",
      postId: "post-a",
      output: ".tmp/places/custom.json",
    });
  });

  it.each([
    [["--target", "production", "--all", "--limit", "3"], "ARGUMENT_INVALID"],
    [["--target", "staging"], "TARGET_INVALID"],
    [["--all"], "TARGET_REQUIRED"],
    [["--target", "develop", "--limit", "0"], "ARGUMENT_INVALID"],
    [["--target", "develop", "--wat"], "ARGUMENT_INVALID"],
  ] as const)("rejects invalid arguments %j", (argv, code) => {
    expect(() => parsePlacesAnalysisExportArgs([...argv])).toThrow(expect.objectContaining({ code }));
  });

  it("selects only the explicit production variable and never falls back to DATABASE_URL", () => {
    const environment = {
      DATABASE_URL: "postgresql://fallback:secret@fallback.invalid/db?sslmode=require",
      PLACES_PRODUCTION_DATABASE_URL:
        "postgresql://reader:secret@production.example/db?sslmode=require",
    };
    const target = resolvePlacesTargetDatabase("production", environment);
    expect(target.databaseUrl).toBe(environment.PLACES_PRODUCTION_DATABASE_URL);
    expect(target.sanitized).toEqual({
      target: "production",
      hostname: "production.example",
      database: "db",
      ssl: "require",
    });
  });

  it("fails closed for a missing target variable or remote URL without SSL", () => {
    expect(() =>
      resolvePlacesTargetDatabase("production", {
        DATABASE_URL: "postgresql://fallback:secret@fallback.invalid/db?sslmode=require",
      }),
    ).toThrow(expect.objectContaining({ code: "TARGET_DATABASE_NOT_CONFIGURED" }));
    expect(() =>
      resolvePlacesTargetDatabase("develop", {
        PLACES_DEVELOP_DATABASE_URL: "postgresql://reader:secret@develop.example/db",
      }),
    ).toThrow(expect.objectContaining({ code: "TARGET_SSL_REQUIRED" }));
  });

  it("reduces unexpected errors to a stable code without leaking content or secrets", () => {
    const secret = "Secret caption DATABASE_URL=postgresql://user:password@host/db";
    const code = sanitizePlacesAnalysisExportError(new Error(secret));
    expect(code).toBe("EXPORT_FAILED");
    expect(code).not.toContain("Secret caption");
    expect(code).not.toContain("password");
  });
});

describe("Places analysis output safety", () => {
  it("accepts only files below the repository .tmp directory", async () => {
    const root = await makeRepositoryRoot();
    await expect(
      resolveSafeAnalysisOutputPath(root, ".tmp/places/places-analysis-input.json"),
    ).resolves.toBe(path.join(root, ".tmp", "places", "places-analysis-input.json"));

    await expect(resolveSafeAnalysisOutputPath(root, "../escape.json")).rejects.toMatchObject({
      code: "OUTPUT_PATH_UNSAFE",
    });
    await expect(resolveSafeAnalysisOutputPath(root, "src/escape.json")).rejects.toMatchObject({
      code: "OUTPUT_PATH_UNSAFE",
    });
    await expect(resolveSafeAnalysisOutputPath(root, ".")).rejects.toMatchObject({
      code: "OUTPUT_PATH_UNSAFE",
    });
  });

  it("rejects a symlink that escapes the repository", async () => {
    const root = await makeRepositoryRoot();
    const outside = await mkdtemp(path.join(os.tmpdir(), "places-analysis-outside-"));
    temporaryRoots.push(outside);
    const link = path.join(root, ".tmp", "outside");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");

    await expect(resolveSafeAnalysisOutputPath(root, ".tmp/outside/export.json")).rejects.toMatchObject({
      code: "OUTPUT_PATH_UNSAFE",
    });
  });

  it("writes, validates, hashes, and atomically renames the primary JSON", async () => {
    const root = await makeRepositoryRoot();
    const document = buildPlacesAnalysisInput([captionRecord()], source());
    const report = await writePlacesAnalysisInputFile({
      repositoryRoot: root,
      outputPath: ".tmp/places/places-analysis-input.json",
      document,
    });

    expect(report.relativePath).toBe(".tmp\\places\\places-analysis-input.json".replaceAll("\\", path.sep));
    expect(report.bytes).toBeGreaterThan(0);
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.parts).toEqual([]);
    expect(JSON.parse(await readFile(report.absolutePath, "utf8"))).toEqual(document);
    expect((await readdir(path.dirname(report.absolutePath))).filter((name) => name.includes(".partial-"))).toEqual([]);
  });

  it("cleans temporary files when validation fails", async () => {
    const root = await makeRepositoryRoot();
    const invalid = buildPlacesAnalysisInput([captionRecord()], source()) as unknown as {
      records: Array<Record<string, unknown>>;
    };
    invalid.records[0].coordinates = [1, 2];

    await expect(
      writePlacesAnalysisInputFile({
        repositoryRoot: root,
        outputPath: ".tmp/places/places-analysis-input.json",
        document: invalid,
      }),
    ).rejects.toMatchObject({ code: "EXPORT_VALIDATION_FAILED" });
    expect(await readdir(path.join(root, ".tmp", "places"))).toEqual([]);
  });

  it("keeps the primary file and creates autonomous parts above the threshold", async () => {
    const root = await makeRepositoryRoot();
    const records = [
      captionRecord({ post_id: "post-1", caption: "A".repeat(256) }),
      captionRecord({
        post_id: "post-2",
        main_theme: "Restaurant",
        caption: "B".repeat(256),
        input_hash: "b".repeat(64),
      }),
    ];
    const document = buildPlacesAnalysisInput(records, source());
    const report = await writePlacesAnalysisInputFile({
      repositoryRoot: root,
      outputPath: ".tmp/places/places-analysis-input.json",
      document,
      partThresholdBytes: 700,
    });

    expect(report.parts.length).toBeGreaterThan(1);
    expect(JSON.parse(await readFile(report.absolutePath, "utf8")).summary.record_count).toBe(2);
    const partCounts = await Promise.all(
      report.parts.map(async (part) => {
        const parsed = placesAnalysisInputSchema.parse(JSON.parse(await readFile(part.absolutePath, "utf8")));
        return parsed.summary.record_count;
      }),
    );
    expect(partCounts.reduce((sum, count) => sum + count, 0)).toBe(2);
  });
});

describe("complete owner-scoped caption source", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("exports all eligible posts with implicit force and theme/date/id ordering", async () => {
    batchMocks.postFindMany
      .mockResolvedValueOnce([
        { id: "voyage-old", mainTheme: "voyages", savedAt: new Date("2025-01-01T00:00:00Z") },
        { id: "restaurant-b", mainTheme: "Restaurant", savedAt: new Date("2026-01-01T00:00:00Z") },
        { id: "cuisine", mainTheme: "Cuisine", savedAt: new Date("2026-07-01T00:00:00Z") },
        { id: "restaurant-a", mainTheme: "restaurant", savedAt: new Date("2026-01-01T00:00:00Z") },
        { id: "voyage-new", mainTheme: "Voyages", savedAt: new Date("2026-07-01T00:00:00Z") },
      ])
      .mockResolvedValueOnce([]);
    batchMocks.loadAnalysisPostInputs.mockImplementation(async (ownerId: string, postId: string) => ({
      id: postId,
      mainTheme: postId.startsWith("restaurant") ? "Restaurant" : "Voyages",
      caption: `caption-${postId}`,
      authorUsername: "alice",
      internalTags: [],
      structuredLocation: null,
      verifiedMedia: [],
      ownerId,
    }));

    const { exportCaptionBatch } = await import("@/server/places/caption-batch");
    const records = await exportCaptionBatch({ ownerId: "owner-a", all: true });

    expect(records.map((record) => record.post_id)).toEqual([
      "restaurant-a",
      "restaurant-b",
      "voyage-new",
      "voyage-old",
    ]);
    expect(batchMocks.loadAnalysisPostInputs).toHaveBeenCalledTimes(4);
    expect(batchMocks.loadAnalysisPostInputs).toHaveBeenCalledWith("owner-a", "voyage-old");
    expect(batchMocks.jobFindFirst).not.toHaveBeenCalled();
    expect(batchMocks.postFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { ownerId: "owner-a", mainTheme: { not: null } },
        orderBy: { id: "asc" },
      }),
    );
  });

  it("fails instead of truncating a complete export above the safety ceiling", async () => {
    const posts = Array.from({ length: 10_001 }, (_, index) => ({
      id: `post-${String(index).padStart(5, "0")}`,
      mainTheme: "Voyages",
      savedAt: null,
    }));
    batchMocks.postFindMany.mockImplementation(async (query: { cursor?: { id: string }; take: number }) => {
      const start = query.cursor ? posts.findIndex((post) => post.id === query.cursor!.id) + 1 : 0;
      return posts.slice(start, start + query.take);
    });
    batchMocks.loadAnalysisPostInputs.mockImplementation(async (_ownerId: string, postId: string) => ({
      id: postId,
      mainTheme: "Voyages",
      caption: "",
      authorUsername: "alice",
      internalTags: [],
      structuredLocation: null,
      verifiedMedia: [],
    }));

    const { exportCaptionBatch } = await import("@/server/places/caption-batch");
    await expect(exportCaptionBatch({ ownerId: "owner-a", all: true })).rejects.toMatchObject({
      code: "EXPORT_LIMIT_EXCEEDED",
    });
  });

  it("counts all posts and canonical eligible themes without a collection query", async () => {
    batchMocks.postCount.mockResolvedValue(12);
    batchMocks.postGroupBy.mockResolvedValue([
      { mainTheme: "Voyages", _count: { _all: 3 } },
      { mainTheme: "restaurant", _count: { _all: 4 } },
      { mainTheme: "Cuisine", _count: { _all: 5 } },
    ]);

    const { loadPlacesExportPreflightCounts } = await import("@/server/places/caption-batch");
    await expect(loadPlacesExportPreflightCounts("owner-a")).resolves.toEqual({
      totalPosts: 12,
      voyagesCount: 3,
      restaurantCount: 4,
      eligibleCount: 7,
    });
    expect(batchMocks.postCount).toHaveBeenCalledWith({ where: { ownerId: "owner-a" } });
    expect(batchMocks.postGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["mainTheme"], where: { ownerId: "owner-a" } }),
    );
  });
});
