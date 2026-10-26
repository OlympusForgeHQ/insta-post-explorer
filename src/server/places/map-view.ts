import "server-only";
import type { Prisma } from "@prisma/client";
import { entityNamesAgree } from "@/lib/places/scoring";

import { canonicalPlacesTheme, type PlacesEligibleTheme } from "@/lib/places/eligibility";
import { groupForRawCategory, type PlaceCategoryGroupKey } from "@/lib/places/categories";
import type { PlacePrecisionDto, PlaceReviewStatusDto } from "@/contracts/api/places";
import { prisma } from "@/server/db";
import { activePlaceWhere } from "@/server/places/visibility";

// Owner-scoped view model for the Phase G Places UI. The public /api/v1 list DTO
// stays unchanged; this loader exists because the map needs a little more than
// the API list exposes — the canonical source themes of the linked posts and one
// preview thumbnail for the hover callout — in a single query.
//
// The owner decided Places stays under ~1000 active places, so the whole set
// is loaded once and filtered in the browser: no viewport/bbox querying, no map
// pagination. MAX_PLACES is a safety cap, not a pagination scheme; when it trips
// the UI says so instead of silently showing a partial map.

export const PLACES_MAP_MAX = 1_000;

const AREA_LEVELS = ["building", "street", "district", "city"] as const;
const MISSING_AREA_DETAILS = ["venue_identity", "unit", "floor", "street_number", "street_address", "business_address"] as const;
export type PlaceAreaContext = {
  level: (typeof AREA_LEVELS)[number];
  missingDetails: (typeof MISSING_AREA_DETAILS)[number][];
};

function areaContext(metadata: Prisma.JsonValue, displayName: string, precision: PlacePrecisionDto, linkedPostIds: readonly string[]): PlaceAreaContext | null {
  if (precision !== "APPROXIMATE" || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const label = metadata.label;
  if (!label || typeof label !== "object" || Array.isArray(label) || label.source !== "source_candidate_approximate_area"
    || typeof label.candidateName !== "string" || typeof label.candidateKey !== "string" || !/^[a-f0-9]{64}$/.test(label.candidateKey)
    || typeof label.sourcePostId !== "string" || !linkedPostIds.includes(label.sourcePostId)
    || !(entityNamesAgree(displayName, label.candidateName) || entityNamesAgree(label.candidateName, displayName))) return null;
  // Match the persisted source-label contract, without exporting source text or
  // treating stale provenance from a manually renamed place as current proof.
  const context = label.sourceContext;
  if (!context || typeof context !== "object" || Array.isArray(context)
    || ["address", "city", "region", "country"].some(field => context[field] !== null && typeof context[field] !== "string")
    || typeof label.level !== "string" || !(AREA_LEVELS as readonly string[]).includes(label.level)
    || !Array.isArray(label.missingDetails) || label.missingDetails.length > 20
    || label.missingDetails.some(detail => typeof detail !== "string")) return null;
  return {
    level: label.level as PlaceAreaContext["level"],
    missingDetails: [...new Set(label.missingDetails.filter((detail): detail is PlaceAreaContext["missingDetails"][number] =>
      typeof detail === "string" && (MISSING_AREA_DETAILS as readonly string[]).includes(detail)))],
  };
}

export type PlacesMapItem = {
  id: string;
  displayName: string;
  address?: string | null;
  category: string | null;
  categoryGroup: PlaceCategoryGroupKey | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  precision: PlacePrecisionDto;
  confidence: number;
  approximationRadiusMeters: number | null;
  areaContext?: PlaceAreaContext | null;
  reviewStatus: PlaceReviewStatusDto;
  isUserConfirmed: boolean;
  postCount: number;
  sourceThemes: PlacesEligibleTheme[];
  previewThumbnailUrl: string | null;
  previewPostId?: string | null;
};

export type PlacesMapView = {
  items: PlacesMapItem[];
  truncated: boolean;
};

// One preview thumbnail per place in a single bounded query: PostgreSQL's
// DISTINCT ON keeps the top-ranked link (primary first, then confidence) for each
// place, so this never becomes an N+1 nor grows with the posts per place.
async function loadPreviewThumbnails(ownerId: string, placeIds: string[]): Promise<Map<string, { postId: string; thumbnailUrl: string }>> {
  if (placeIds.length === 0) return new Map();
  const links = await prisma.postPlace.findMany({
    where: { ownerId, placeId: { in: placeIds }, post: { ownerId, thumbnailUrl: { not: "" } } },
    orderBy: [{ placeId: "asc" }, { isPrimary: "desc" }, { confidence: "desc" }, { postId: "asc" }],
    distinct: ["placeId"],
    select: { placeId: true, postId: true, post: { select: { thumbnailUrl: true } } },
  });
  const thumbnails = new Map<string, { postId: string; thumbnailUrl: string }>();
  for (const link of links) {
    if (link.post.thumbnailUrl) thumbnails.set(link.placeId, { postId: link.postId, thumbnailUrl: link.post.thumbnailUrl });
  }
  return thumbnails;
}

export async function loadPlacesMapView(ownerId: string, max: number = PLACES_MAP_MAX): Promise<PlacesMapView> {
  // Themes must reflect EVERY linked post, otherwise the theme filter would be
  // wrong for a place whose second theme appears late in its links. The relation
  // is therefore selected in full but with a single tiny column (mainTheme); the
  // preview thumbnail comes from a second bounded query below, so neither the
  // payload nor the query count grows with the number of posts per place.
  const rows = await prisma.place.findMany({
    where: activePlaceWhere(ownerId),
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: max + 1,
    select: {
      id: true,
      displayName: true,
      address: true,
      category: true,
      city: true,
      region: true,
      country: true,
      countryCode: true,
      latitude: true,
      longitude: true,
      precision: true,
      confidence: true,
      approximationRadiusMeters: true,
      metadata: true,
      reviewStatus: true,
      isUserConfirmed: true,
      _count: { select: { postLinks: true } },
      postLinks: { select: { postId: true, post: { select: { mainTheme: true } } } },
    },
  });

  const truncated = rows.length > max;
  const visibleRows = truncated ? rows.slice(0, max) : rows;
  const thumbnails = await loadPreviewThumbnails(ownerId, visibleRows.map((row) => row.id));

  const items = visibleRows.map((row) => {
    const themes: PlacesEligibleTheme[] = [];
    for (const link of row.postLinks) {
      const theme = canonicalPlacesTheme(link.post.mainTheme);
      if (theme && !themes.includes(theme)) themes.push(theme);
    }
    const preview = thumbnails.get(row.id);
    return {
      id: row.id,
      displayName: row.displayName,
      address: row.address,
      category: row.category,
      categoryGroup: groupForRawCategory(row.category),
      city: row.city,
      region: row.region,
      country: row.country,
      countryCode: row.countryCode,
      latitude: row.latitude,
      longitude: row.longitude,
      precision: row.precision,
      confidence: row.confidence,
      approximationRadiusMeters: row.approximationRadiusMeters,
      areaContext: areaContext(row.metadata, row.displayName, row.precision, row.postLinks.map(link => link.postId)),
      reviewStatus: row.reviewStatus,
      isUserConfirmed: row.isUserConfirmed,
      postCount: row._count.postLinks,
      sourceThemes: themes,
      previewThumbnailUrl: preview?.thumbnailUrl ?? null,
      previewPostId: preview?.postId ?? null,
    } satisfies PlacesMapItem;
  });

  return { items, truncated };
}
