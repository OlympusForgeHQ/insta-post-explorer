import "server-only";

import type { Prisma } from "@prisma/client";

import { foldForSearch } from "@/lib/import/normalize";
import { PLACE_CATEGORY_KEYS } from "@/lib/places/categories";
import { canonicalPlacesTheme, isPlacesEligibleTheme } from "@/lib/places/eligibility";
import { decodePlacesCursor, encodePlacesCursor } from "@/lib/places/cursor";
import type {
  CursorPageInput,
  EligiblePostDto,
  PlaceAnalysisJobDto,
  PlaceDetailDto,
  PlaceListItemDto,
  PlacePage,
  PlacePostSummaryDto,
  PlacesListInput,
  UnresolvedJobDto,
} from "@/contracts/api/places";
import { prisma } from "@/server/db";
import { activePlaceWhere } from "@/server/places/visibility";

// Owner-scoped read services for the Places domain. Every query filters by
// ownerId, uses the opaque F1 cursor for keyset pagination, and returns explicit
// DTOs — never raw Prisma rows, provider payloads, or another owner's data.

const PLACE_LIST_SELECT = {
  id: true,
  displayName: true,
  category: true,
  city: true,
  region: true,
  country: true,
  countryCode: true,
  continentCode: true,
  latitude: true,
  longitude: true,
  precision: true,
  confidence: true,
  approximationRadiusMeters: true,
  reviewStatus: true,
  isUserConfirmed: true,
  updatedAt: true,
  _count: { select: { postLinks: true } },
} satisfies Prisma.PlaceSelect;

type PlaceListRow = Prisma.PlaceGetPayload<{ select: typeof PLACE_LIST_SELECT }>;

function toPlaceListItemDto(row: PlaceListRow): PlaceListItemDto {
  return {
    id: row.id,
    displayName: row.displayName,
    category: row.category,
    city: row.city,
    region: row.region,
    country: row.country,
    countryCode: row.countryCode,
    continentCode: row.continentCode,
    latitude: row.latitude,
    longitude: row.longitude,
    precision: row.precision,
    confidence: row.confidence,
    approximationRadiusMeters: row.approximationRadiusMeters,
    reviewStatus: row.reviewStatus,
    isUserConfirmed: row.isUserConfirmed,
    postCount: row._count.postLinks,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Keyset predicate for the default (updatedAt DESC, id DESC) ordering.
function updatedAtIdCursorWhere(token: string): Prisma.PlaceWhereInput {
  const cursor = decodePlacesCursor(token);
  return {
    OR: [
      { updatedAt: { lt: cursor.updatedAt } },
      { AND: [{ updatedAt: cursor.updatedAt }, { id: { lt: cursor.id } }] },
    ],
  };
}

export async function queryPlaces(input: PlacesListInput, ownerId: string): Promise<PlacePage<PlaceListItemDto>> {
  const and: Prisma.PlaceWhereInput[] = [];
  // Explicit review filters retain access to historical canonicals.
  if (!input.reviewStatus) and.push(activePlaceWhere(ownerId));
  if (input.q) {
    const folded = foldForSearch(input.q);
    and.push({
      OR: [
        { displayName: { contains: input.q, mode: "insensitive" } },
        { normalizedName: { contains: folded } },
        { city: { contains: input.q, mode: "insensitive" } },
      ],
    });
  }

  // Match the owner taxonomy only. Unclassified legacy/provider strings are
  // visible in Divers until evidence-based reanalysis supplies a category.
  if (input.categoryGroups?.length) {
    const selected: Prisma.PlaceWhereInput[] = input.categoryGroups.map(category => ({ category: { equals: category, mode: "insensitive" } }));
    if (input.categoryGroups.includes("divers")) selected.push({ category: null }, {
      NOT: PLACE_CATEGORY_KEYS.map(category => ({ category: { equals: category, mode: "insensitive" as const } })),
    });
    and.push({ OR: selected });
  }

  // Restrict to places linked to at least one post of the requested canonical
  // theme, reusing the shared eligibility variants (never a collection join).
  if (input.sourceTheme) {
    const variants = (await eligibleThemeVariants(ownerId)).filter(
      (variant) => canonicalPlacesTheme(variant) === input.sourceTheme,
    );
    and.push(
      variants.length > 0
        ? { postLinks: { some: { post: { mainTheme: { in: variants } } } } }
        : { id: { in: [] } },
    );
  }

  if (input.cursor) and.push(updatedAtIdCursorWhere(input.cursor));

  const where: Prisma.PlaceWhereInput = {
    ownerId,
    ...(input.countryCode ? { countryCode: input.countryCode } : {}),
    ...(input.continentCode ? { continentCode: input.continentCode } : {}),
    ...(input.reviewStatus ? { reviewStatus: input.reviewStatus } : {}),
    ...(input.precision ? { precision: input.precision } : {}),
    ...(input.city ? { city: { equals: input.city, mode: "insensitive" } } : {}),
    ...(input.category ? { category: { equals: input.category, mode: "insensitive" } } : {}),
    ...(input.minConfidence != null ? { confidence: { gte: input.minConfidence } } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };

  const rows = await prisma.place.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: PLACE_LIST_SELECT,
  });

  return toPage(rows, input.limit, (row) => ({ updatedAt: row.updatedAt, id: row.id }), toPlaceListItemDto);
}

export async function getPlaceDetail(placeId: string, ownerId: string): Promise<PlaceDetailDto | null> {
  const place = await prisma.place.findFirst({
    where: { id: placeId, ownerId },
    select: {
      ...PLACE_LIST_SELECT,
      createdAt: true,
      address: true,
      provider: true,
      metadata: true,
      evidence: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: { evidenceType: true, normalizedValue: true, excerpt: true, confidence: true },
      },
    },
  });
  if (!place) return null;

  const metadata = (place.metadata ?? {}) as Record<string, unknown>;
  return {
    ...toPlaceListItemDto(place),
    createdAt: place.createdAt.toISOString(),
    address: place.address,
    provider: place.provider,
    providerResultType: typeof metadata.providerResultType === "string" ? metadata.providerResultType : null,
    attribution: typeof metadata.attribution === "string" ? metadata.attribution : null,
    evidence: place.evidence.map((item) => ({
      type: item.evidenceType,
      normalizedValue: item.normalizedValue,
      excerpt: item.excerpt,
      confidence: item.confidence,
    })),
  };
}

export async function getPlacePosts(
  placeId: string,
  input: CursorPageInput,
  ownerId: string,
): Promise<PlacePage<PlacePostSummaryDto> | null> {
  const place = await prisma.place.findFirst({ where: { id: placeId, ownerId }, select: { id: true } });
  if (!place) return null;

  const and: Prisma.PostPlaceWhereInput[] = [];
  if (input.cursor) {
    const cursor = decodePlacesCursor(input.cursor);
    and.push({
      OR: [
        { createdAt: { lt: cursor.updatedAt } },
        { AND: [{ createdAt: cursor.updatedAt }, { postId: { lt: cursor.id } }] },
      ],
    });
  }

  const rows = await prisma.postPlace.findMany({
    where: { ownerId, placeId, ...(and.length > 0 ? { AND: and } : {}) },
    orderBy: [{ createdAt: "desc" }, { postId: "desc" }],
    take: input.limit + 1,
    select: {
      postId: true,
      isPrimary: true,
      precision: true,
      confidence: true,
      createdAt: true,
      post: { select: { postUrl: true, thumbnailUrl: true, authorUsername: true, mainTheme: true } },
    },
  });

  return toPage(
    rows,
    input.limit,
    (row) => ({ updatedAt: row.createdAt, id: row.postId }),
    (row): PlacePostSummaryDto => ({
      postId: row.postId,
      postUrl: row.post.postUrl,
      thumbnailUrl: row.post.thumbnailUrl,
      authorUsername: row.post.authorUsername,
      mainTheme: row.post.mainTheme,
      isPrimary: row.isPrimary,
      precision: row.precision,
      confidence: row.confidence,
      linkedAt: row.createdAt.toISOString(),
    }),
  );
}

export type PlacePostDetailSummary = PlacePostSummaryDto & { caption: string };

export async function getPlacePostDetails(
  placeId: string,
  input: CursorPageInput,
  ownerId: string,
): Promise<PlacePage<PlacePostDetailSummary> | null> {
  const page = await getPlacePosts(placeId, input, ownerId);
  if (!page) return null;
  const captions = await prisma.post.findMany({
    where: { ownerId, id: { in: page.items.map((item) => item.postId) } },
    select: { id: true, caption: true },
  });
  const byId = new Map(captions.map((post) => [post.id, post.caption]));
  return { ...page, items: page.items.map((item) => ({ ...item, caption: byId.get(item.postId) ?? "" })) };
}

export async function queryEligiblePosts(input: CursorPageInput, ownerId: string): Promise<PlacePage<EligiblePostDto>> {
  const variants = await eligibleThemeVariants(ownerId);
  if (variants.length === 0) return { items: [], nextCursor: null };

  const and: Prisma.PostWhereInput[] = [];
  if (input.cursor) {
    const cursor = decodePlacesCursor(input.cursor);
    and.push({
      OR: [
        { createdAt: { lt: cursor.updatedAt } },
        { AND: [{ createdAt: cursor.updatedAt }, { id: { lt: cursor.id } }] },
      ],
    });
  }

  const rows = await prisma.post.findMany({
    where: { ownerId, mainTheme: { in: variants }, placeLinks: { none: {} }, ...(and.length > 0 ? { AND: and } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: { id: true, postUrl: true, thumbnailUrl: true, authorUsername: true, mainTheme: true, savedAt: true, createdAt: true },
  });

  return toPage(
    rows,
    input.limit,
    (row) => ({ updatedAt: row.createdAt, id: row.id }),
    (row): EligiblePostDto => ({
      postId: row.id,
      postUrl: row.postUrl,
      thumbnailUrl: row.thumbnailUrl,
      authorUsername: row.authorUsername,
      mainTheme: row.mainTheme,
      savedAt: row.savedAt ? row.savedAt.toISOString() : null,
    }),
  );
}

export async function queryUnresolvedPlaceJobs(
  input: CursorPageInput,
  ownerId: string,
): Promise<PlacePage<UnresolvedJobDto>> {
  const and: Prisma.PlaceAnalysisJobWhereInput[] = [];
  if (input.cursor) {
    const cursor = decodePlacesCursor(input.cursor);
    and.push({
      OR: [
        { createdAt: { lt: cursor.updatedAt } },
        { AND: [{ createdAt: cursor.updatedAt }, { id: { lt: cursor.id } }] },
      ],
    });
  }

  const rows = await prisma.placeAnalysisJob.findMany({
    where: { ownerId, status: "NEEDS_REVIEW", ...(and.length > 0 ? { AND: and } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: { id: true, postId: true, status: true, stage: true, sourceTheme: true, createdAt: true },
  });

  return toPage(
    rows,
    input.limit,
    (row) => ({ updatedAt: row.createdAt, id: row.id }),
    (row): UnresolvedJobDto => ({
      jobId: row.id,
      postId: row.postId,
      status: row.status,
      stage: row.stage,
      sourceTheme: row.sourceTheme,
      createdAt: row.createdAt.toISOString(),
    }),
  );
}

export async function getPlaceAnalysisJob(jobId: string, ownerId: string): Promise<PlaceAnalysisJobDto | null> {
  const job = await prisma.placeAnalysisJob.findFirst({
    where: { id: jobId, ownerId },
    // errorMessage is intentionally omitted: only a bounded errorCode is exposed.
    select: {
      id: true,
      postId: true,
      status: true,
      stage: true,
      depth: true,
      sourceTheme: true,
      analysisVersion: true,
      attemptCount: true,
      errorCode: true,
      result: true,
      createdAt: true,
      completedAt: true,
    },
  });
  if (!job) return null;

  return {
    jobId: job.id,
    postId: job.postId,
    status: job.status,
    stage: job.stage,
    depth: job.depth,
    sourceTheme: job.sourceTheme,
    analysisVersion: job.analysisVersion,
    attemptCount: job.attemptCount,
    errorCode: job.errorCode,
    result: job.result ?? null,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
  };
}

// Distinct stored mainTheme values for this owner that are Places-eligible under
// the shared predicate (so folded variants like "voyages" are honored).
export async function eligibleThemeVariants(ownerId: string): Promise<string[]> {
  const themes = await prisma.post.findMany({
    where: { ownerId, mainTheme: { not: null } },
    distinct: ["mainTheme"],
    select: { mainTheme: true },
  });
  return themes.map((row) => row.mainTheme).filter((theme): theme is string => isPlacesEligibleTheme(theme));
}

// Shared keyset paginator: fetches limit+1 rows, trims to a page, and encodes the
// opaque next cursor from the last item of the page.
function toPage<TRow, TDto>(
  rows: TRow[],
  limit: number,
  cursorKey: (row: TRow) => { updatedAt: Date; id: string },
  toDto: (row: TRow) => TDto,
): PlacePage<TDto> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map(toDto);
  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodePlacesCursor(cursorKey(last)) : null;
  return { items, nextCursor };
}
