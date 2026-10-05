import "server-only";

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
  reviewStatus: PlaceReviewStatusDto;
  isUserConfirmed: boolean;
  postCount: number;
  sourceThemes: PlacesEligibleTheme[];
  previewThumbnailUrl: string | null;
};

export type PlacesMapView = {
  items: PlacesMapItem[];
  truncated: boolean;
};

// One preview thumbnail per place in a single bounded query: PostgreSQL's
// DISTINCT ON keeps the top-ranked link (primary first, then confidence) for each
// place, so this never becomes an N+1 nor grows with the posts per place.
async function loadPreviewThumbnails(ownerId: string, placeIds: string[]): Promise<Map<string, string>> {
  if (placeIds.length === 0) return new Map();
  const links = await prisma.postPlace.findMany({
    where: { ownerId, placeId: { in: placeIds } },
    orderBy: [{ placeId: "asc" }, { isPrimary: "desc" }, { confidence: "desc" }],
    distinct: ["placeId"],
    select: { placeId: true, post: { select: { thumbnailUrl: true } } },
  });
  const thumbnails = new Map<string, string>();
  for (const link of links) {
    if (link.post.thumbnailUrl) thumbnails.set(link.placeId, link.post.thumbnailUrl);
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
      reviewStatus: true,
      isUserConfirmed: true,
      _count: { select: { postLinks: true } },
      postLinks: { select: { post: { select: { mainTheme: true } } } },
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
    const previewThumbnailUrl = thumbnails.get(row.id) ?? null;
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
      reviewStatus: row.reviewStatus,
      isUserConfirmed: row.isUserConfirmed,
      postCount: row._count.postLinks,
      sourceThemes: themes,
      previewThumbnailUrl,
    } satisfies PlacesMapItem;
  });

  return { items, truncated };
}
