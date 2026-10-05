import "server-only";

import { Prisma } from "@prisma/client";

import { canonicalPlacesTheme, PLACES_ELIGIBLE_THEMES, type PlacesEligibleTheme } from "@/lib/places/eligibility";
import type { PlacesStatsDto, PlacesStatsInput } from "@/contracts/api/places";
import { prisma } from "@/server/db";
import { eligibleThemeVariants } from "@/server/places/queries";
import { activePlaceSql, presentPlaceWhere } from "@/server/places/visibility";

// Owner-scoped Places statistics. Counts use distinct aggregations so a place
// linked to many posts counts once, and a post linked to many places counts
// once. REJECTED places are excluded from identified totals. UNKNOWN outcomes
// (which create no Place) are surfaced only through the NEEDS_REVIEW job count.
//
// When source_theme is provided, every aggregation is restricted through
// PostPlace -> Post.mainTheme (the shared eligibility variants of the requested
// canonical theme): place-count aggregations count places linked to at least one
// post of the theme, post-count aggregations count distinct posts of the theme,
// NEEDS_REVIEW jobs are filtered by their canonical sourceTheme, and byTheme
// returns only the requested theme. No CollectionPost join is ever used.

type CountRow = { n: number };
type CountryRow = { country_code: string; country: string | null; place_count: number; post_count: number };
type ContinentRow = { continent_code: string; place_count: number; country_count: number; post_count: number };
type ThemeCountRow = { place_count: number; post_count: number };

// Compose the owner + optional geo/precision filter shared by the place-scoped
// aggregations. The source_theme restriction is applied through the link join,
// not here. All aggregations use the fixed "p" alias for places.
function placeFilterSql(ownerId: string, input: PlacesStatsInput): Prisma.Sql {
  const parts: Prisma.Sql[] = [activePlaceSql(ownerId)];
  if (input.countryCode) parts.push(Prisma.sql`p.country_code = ${input.countryCode}`);
  if (input.continentCode) parts.push(Prisma.sql`p.continent_code = ${input.continentCode}`);
  if (input.precision) parts.push(Prisma.sql`p.precision = ${input.precision}::"PlacePrecision"`);
  return Prisma.join(parts, " AND ");
}

export async function getPlacesStats(input: PlacesStatsInput, ownerId: string): Promise<PlacesStatsDto> {
  const allVariants = await eligibleThemeVariants(ownerId);
  const requestedTheme = input.sourceTheme ?? null;
  const themeVariants = requestedTheme
    ? allVariants.filter((variant) => canonicalPlacesTheme(variant) === requestedTheme)
    : null;

  const placeWhere = {
    ...presentPlaceWhere(ownerId),
    ...(input.countryCode ? { countryCode: input.countryCode } : {}),
    ...(input.continentCode ? { continentCode: input.continentCode } : {}),
    ...(input.precision ? { precision: input.precision } : {}),
  } as const;
  // Restrict places to those linked to at least one post of the requested theme.
  const themeLinkFilter: Prisma.PlaceWhereInput = themeVariants
    ? { postLinks: { some: { post: { mainTheme: { in: themeVariants } } } } }
    : {};
  const identifiedWhere = { ...placeWhere, reviewStatus: { not: "REJECTED" as const }, ...themeLinkFilter };

  const placeFilter = placeFilterSql(ownerId, input);
  // When a theme is requested, inner-join the theme posts so both place and post
  // counts are restricted to it; otherwise left-join all links so places without
  // links still contribute to place counts only when manually confirmed.
  const linkJoin = themeVariants
    ? Prisma.sql`JOIN post_places pp ON pp.place_id = p.id AND pp.owner_id = p.owner_id
        JOIN posts po ON po.id = pp.post_id AND po.owner_id = pp.owner_id AND ${
          themeVariants.length > 0 ? Prisma.sql`po.main_theme IN (${Prisma.join(themeVariants)})` : Prisma.sql`FALSE`
        }`
    : Prisma.sql`LEFT JOIN post_places pp ON pp.place_id = p.id AND pp.owner_id = p.owner_id`;

  const [
    eligiblePosts,
    identifiedPlaces,
    conflictPlaces,
    needsReviewJobs,
    byPrecisionGroups,
    byReviewStatusGroups,
    postsWithPlacesRows,
    byCountry,
    byContinent,
  ] = await Promise.all([
    prisma.post.count({ where: { ownerId, mainTheme: { in: themeVariants ?? allVariants } } }),
    prisma.place.count({ where: identifiedWhere }),
    prisma.place.count({ where: { ...placeWhere, reviewStatus: "CONFLICT", ...themeLinkFilter } }),
    prisma.placeAnalysisJob.count({
      where: { ownerId, status: "NEEDS_REVIEW", ...(requestedTheme ? { sourceTheme: requestedTheme } : {}) },
    }),
    prisma.place.groupBy({ by: ["precision"], where: identifiedWhere, _count: { _all: true } }),
    prisma.place.groupBy({ by: ["reviewStatus"], where: { ...placeWhere, ...themeLinkFilter }, _count: { _all: true } }),
    prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT pp.post_id)::int AS n
      FROM places p ${linkJoin}
      WHERE ${placeFilter}
    `),
    prisma.$queryRaw<CountryRow[]>(Prisma.sql`
      SELECT p.country_code, MAX(p.country) AS country,
             COUNT(DISTINCT p.id)::int AS place_count,
             COUNT(DISTINCT pp.post_id)::int AS post_count
      FROM places p ${linkJoin}
      WHERE ${placeFilter} AND p.country_code IS NOT NULL
      GROUP BY p.country_code
      ORDER BY place_count DESC, p.country_code ASC
    `),
    prisma.$queryRaw<ContinentRow[]>(Prisma.sql`
      SELECT p.continent_code,
             COUNT(DISTINCT p.id)::int AS place_count,
             COUNT(DISTINCT p.country_code)::int AS country_count,
             COUNT(DISTINCT pp.post_id)::int AS post_count
      FROM places p ${linkJoin}
      WHERE ${placeFilter} AND p.continent_code IS NOT NULL
      GROUP BY p.continent_code
      ORDER BY place_count DESC, p.continent_code ASC
    `),
  ]);

  const byTheme = await computeByTheme(ownerId, input, allVariants, requestedTheme);

  return {
    totals: {
      eligiblePosts,
      identifiedPlaces,
      countries: byCountry.length,
      continents: byContinent.length,
      postsWithPlaces: postsWithPlacesRows[0]?.n ?? 0,
      needsReview: conflictPlaces + needsReviewJobs,
    },
    byTheme,
    byCountry: byCountry.map((row) => ({
      countryCode: row.country_code,
      country: row.country,
      placeCount: row.place_count,
      postCount: row.post_count,
    })),
    byContinent: byContinent.map((row) => ({
      continentCode: row.continent_code,
      placeCount: row.place_count,
      countryCount: row.country_count,
      postCount: row.post_count,
    })),
    byPrecision: byPrecisionGroups.map((group) => ({ precision: group.precision, placeCount: group._count._all })),
    byReviewStatus: byReviewStatusGroups.map((group) => ({
      reviewStatus: group.reviewStatus,
      placeCount: group._count._all,
    })),
  };
}

// One distinct-count query per canonical theme so a place or post that touches
// several stored variants of the same theme is still counted once. When a
// source_theme is requested, only that theme is returned.
async function computeByTheme(
  ownerId: string,
  input: PlacesStatsInput,
  allVariants: string[],
  requestedTheme: PlacesEligibleTheme | null,
): Promise<PlacesStatsDto["byTheme"]> {
  const placeFilter = placeFilterSql(ownerId, input);
  const themes = requestedTheme ? [requestedTheme] : [...PLACES_ELIGIBLE_THEMES];
  const results: PlacesStatsDto["byTheme"] = [];

  for (const theme of themes) {
    const themeVariants = allVariants.filter((variant) => canonicalPlacesTheme(variant) === theme);
    if (themeVariants.length === 0) {
      results.push({ theme, placeCount: 0, postCount: 0 });
      continue;
    }
    const rows = await prisma.$queryRaw<ThemeCountRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT p.id)::int AS place_count,
             COUNT(DISTINCT pp.post_id)::int AS post_count
      FROM post_places pp
      JOIN places p ON p.id = pp.place_id AND p.owner_id = pp.owner_id
      JOIN posts po ON po.id = pp.post_id AND po.owner_id = pp.owner_id
      WHERE ${placeFilter} AND po.main_theme IN (${Prisma.join(themeVariants)})
    `);
    results.push({ theme, placeCount: rows[0]?.place_count ?? 0, postCount: rows[0]?.post_count ?? 0 });
  }

  return results;
}
