import "server-only";
import {CAPTION_TRANSLATION_VERSION} from "@/lib/classification/translation";
import {currentCaptionTranslation} from "@/server/classification/translation-inputs";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import type { ContentType, LibraryPost, LibraryStats, LibraryYear, SortMode } from "@/features/library/types";
import {
  filterAndPaginatePosts,
  type LibraryPostPage,
} from "@/features/library/filter-posts";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  parseLibraryQuery,
  type LibraryCursor,
  type LibraryQuery,
} from "@/features/library/query-state";
import {
  foldForSearch,
  normalizeImportPayload,
  tagSlug,
} from "@/lib/import/normalize";
import { resolvePublicMediaUrl } from "@/lib/media-url";
import { databaseConfigured, prisma } from "@/server/db";
import { getApplicationOwnerId, parseOwnerId } from "@/server/owner";
import { calculateDetailedFallbackStats, calculateLibraryYears, getDatabaseLibraryStats, getLibraryAuthors as queryLibraryAuthors } from "@/server/library-insights";

const postInclude = {
  classificationJobs: { where: { analysisVersion: CAPTION_TRANSLATION_VERSION, status: 'SUCCEEDED' as const }, select: { ownerId: true, inputHash: true, result: true } },
  postTags: { include: { tag: true } },
  media: { orderBy: { position: "asc" as const } },
  collectionPosts: { include: { collection: true } },
} satisfies Prisma.PostInclude;

type PostWithTags = Prisma.PostGetPayload<{include: typeof postInclude}>;

export type LibraryTag = { name: string; slug: string; count: number };

export async function getLibraryPosts(
  options: { limit?: number; ownerId?: string } = {},
): Promise<LibraryPost[]> {
  const query = parseLibraryQuery({ limit: options.limit });
  return (await queryLibraryPosts(query, options.ownerId)).items;
}

export async function queryLibraryPosts(
  input: LibraryQuery,
  requestedOwnerId?: string,
): Promise<LibraryPostPage> {
  const query = parseLibraryQuery(input);
  const ownerId = parseOwnerId(requestedOwnerId ?? getApplicationOwnerId());
  if (!databaseConfigured) {
    const page = filterAndPaginatePosts(await readFallbackPosts(), query);
    return {
      ...page,
      items: page.items.map((post) => ({
        ...post,
        caption: post.caption.slice(0, 500),
        metadata: {},
      })),
    };
  }

  if (query.sort === "relevance" && query.search) {
    return queryRelevantPosts(ownerId, query);
  }

  const cursor = query.cursor ? decodeLibraryCursor(query.cursor, query.sort) : null;
  const effectiveSort = query.sort === "relevance" ? "newest" : query.sort;
  const baseWhere = libraryPostWhere(ownerId, query);
  if (effectiveSort === "newest" || effectiveSort === "oldest") {
    return queryPostsByEffectiveSavedDate(ownerId, query, baseWhere, cursor, effectiveSort);
  }
  const where: Prisma.PostWhereInput = { ...baseWhere, ...cursorWhere(cursor, effectiveSort) };
  const [rows, totalFiltered, totalLibrary] = await prisma.$transaction([
    prisma.post.findMany({ where, include: postInclude, orderBy: orderByFor(effectiveSort), take: query.limit + 1 }),
    prisma.post.count({ where: baseWhere }),
    prisma.post.count({ where: { ownerId } }),
  ]);

  const hasNextPage = rows.length > query.limit;
  const pageRows = hasNextPage ? rows.slice(0, query.limit) : rows;
  const items = pageRows.map((row) => toLibraryPost(row, true));
  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasNextPage && lastRow
      ? encodeLibraryCursor(cursorFromRow(lastRow, query.sort, effectiveSort))
      : null;

  return { items, nextCursor, total: totalFiltered, totalFiltered, totalLibrary };
}

async function queryPostsByEffectiveSavedDate(
  ownerId: string,
  query: LibraryQuery,
  baseWhere: Prisma.PostWhereInput,
  cursor: LibraryCursor | null,
  sort: "newest" | "oldest",
): Promise<LibraryPostPage> {
  const [candidates, totalLibrary] = await prisma.$transaction([
    prisma.post.findMany({
      where: baseWhere,
      select: { id: true, savedAt: true, createdAt: true },
    }),
    prisma.post.count({ where: { ownerId } }),
  ]);
  candidates.sort((left, right) => {
    const leftTime = (left.savedAt ?? left.createdAt).getTime();
    const rightTime = (right.savedAt ?? right.createdAt).getTime();
    const dateOrder = sort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    return dateOrder || left.id.localeCompare(right.id);
  });

  let start = 0;
  if (cursor) {
    const cursorIndex = candidates.findIndex((post) =>
      post.id === cursor.id && (post.savedAt ?? post.createdAt).toISOString() === cursor.value,
    );
    if (cursorIndex < 0) throw cursorValidationError();
    start = cursorIndex + 1;
  }

  const pageCandidates = candidates.slice(start, start + query.limit + 1);
  const hasNextPage = pageCandidates.length > query.limit;
  const selectedCandidates = hasNextPage ? pageCandidates.slice(0, query.limit) : pageCandidates;
  const rows = selectedCandidates.length
    ? await prisma.post.findMany({ where: { id: { in: selectedCandidates.map((post) => post.id) } }, include: postInclude })
    : [];
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows = selectedCandidates.flatMap((post) => {
    const row = rowsById.get(post.id);
    return row ? [row] : [];
  });
  const last = selectedCandidates.at(-1);
  const nextCursor = hasNextPage && last
    ? encodeLibraryCursor({ version: 1, sort: query.sort, value: (last.savedAt ?? last.createdAt).toISOString(), id: last.id })
    : null;

  return {
    items: orderedRows.map((row) => toLibraryPost(row, true)),
    nextCursor,
    total: candidates.length,
    totalFiltered: candidates.length,
    totalLibrary,
  };
}

export async function getRandomLibraryPost(
  input: LibraryQuery,
  requestedOwnerId?: string,
): Promise<LibraryPost | null> {
  const query = parseLibraryQuery({ ...input, cursor: null });
  const ownerId = parseOwnerId(requestedOwnerId ?? getApplicationOwnerId());
  if (!databaseConfigured) {
    const page = filterAndPaginatePosts(await readFallbackPosts(), { ...query, limit: Number.MAX_SAFE_INTEGER });
    return page.items[Math.floor(Math.random() * page.totalFiltered)] ?? null;
  }

  if (query.sort === "relevance" && query.search) {
    return getRandomRelevantPost(ownerId, query);
  }

  const where = libraryPostWhere(ownerId, query);
  const total = await prisma.post.count({ where });
  if (total === 0) return null;
  const row = await prisma.post.findFirst({
    where,
    include: postInclude,
    orderBy: { id: "asc" },
    skip: Math.floor(Math.random() * total),
  });
  return row ? toLibraryPost(row, true) : null;
}

async function getRandomRelevantPost(ownerId: string, query: LibraryQuery): Promise<LibraryPost | null> {
  const { condition } = relevanceFilter(ownerId, query);
  const total = await countRelevantPosts(condition);
  if (total === 0) return null;
  const offset = Math.floor(Math.random() * total);
  const ids = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p."id"
    FROM "posts" p
    WHERE ${condition}
    ORDER BY p."id" ASC
    OFFSET ${offset}
    LIMIT 1
  `);
  return ids[0] ? getLibraryPost(ids[0].id, ownerId) : null;
}

async function queryRelevantPosts(
  ownerId: string,
  query: LibraryQuery,
): Promise<LibraryPostPage> {
  const cursor = query.cursor ? decodeLibraryCursor(query.cursor, "relevance") : null;
  const cursorRank = cursor?.value === null || cursor?.value === undefined ? null : Number(cursor.value);
  if (cursor && (cursorRank === null || !Number.isFinite(cursorRank))) {
    throw cursorValidationError();
  }

  const { search, condition } = relevanceFilter(ownerId, query);
  // Bind the cursor rank as text: Prisma serializes JS floats as 16-digit
  // numerics, which loses precision and breaks the tie-breaking equality.
  const cursorRankParam = cursorRank === null ? null : String(cursorRank);
  const cursorCondition =
    cursor && cursorRankParam !== null
      ? Prisma.sql`AND (rank < ${cursorRankParam}::double precision OR (rank = ${cursorRankParam}::double precision AND id > ${cursor.id}))`
      : Prisma.empty;
  const ranked = await prisma.$queryRaw<Array<{ id: string; rank: number }>>(Prisma.sql`
    WITH ranked AS (
      SELECT
        p."id",
        ts_rank_cd(
          to_tsvector('simple', p."search_text"),
          plainto_tsquery('simple', ${search})
        )::double precision AS rank
      FROM "posts" p
      WHERE ${condition}
    )
    SELECT id, rank
    FROM ranked
    WHERE TRUE ${cursorCondition}
    ORDER BY rank DESC, id ASC
    LIMIT ${query.limit + 1}
  `);

  const hasNextPage = ranked.length > query.limit;
  const pageRanks = hasNextPage ? ranked.slice(0, query.limit) : ranked;
  const rows = await prisma.post.findMany({
    where: { ownerId, id: { in: pageRanks.map((row) => row.id) } },
    include: postInclude,
  });
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const items = pageRanks.flatMap((rankedRow) => {
    const row = rowsById.get(rankedRow.id);
    return row ? [toLibraryPost(row, true)] : [];
  });
  const lastRank = pageRanks.at(-1);
  const nextCursor =
    hasNextPage && lastRank
      ? encodeLibraryCursor({
          version: 1,
          sort: "relevance",
          value: String(lastRank.rank),
          id: lastRank.id,
        })
      : null;

  const [totalFiltered, totalLibrary] = await Promise.all([
    countRelevantPosts(condition),
    prisma.post.count({ where: { ownerId } }),
  ]);
  return { items, nextCursor, total: totalFiltered, totalFiltered, totalLibrary };
}

async function countRelevantPosts(condition: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS total
    FROM "posts" p
    WHERE ${condition}
  `);
  return Number(rows[0]?.total ?? 0);
}

// Single source for the PostgreSQL predicates shared by the relevance list,
// count and random paths so they can never disagree on the active filters.
function relevanceFilter(
  ownerId: string,
  query: LibraryQuery,
): { search: string; condition: Prisma.Sql } {
  const search = foldForSearch(query.search);
  const slugs = [...new Set(query.tags.map(tagSlug).filter(Boolean))];
  const tagCondition = relevanceTagCondition(ownerId, slugs, query.tagMode);
  const contentType = query.contentType?.toUpperCase() ?? null;
  const authorSortKey = query.author ? foldForSearch(query.author) : null;
  const condition = Prisma.sql`p."owner_id" = ${ownerId}
      AND (${query.theme}::text IS NULL OR p."main_theme" = ${query.theme})
      AND (${contentType}::text IS NULL OR p."content_type"::text = ${contentType})
      AND (${authorSortKey}::text IS NULL OR p."author_sort_key" = ${authorSortKey})
      AND (${query.year}::integer IS NULL OR (p."published_at" >= make_date((${query.year ?? 2000})::integer, 1, 1) AND p."published_at" < make_date((${query.year ?? 2000})::integer + 1, 1, 1)))
      AND (${query.collection}::text IS NULL OR EXISTS (SELECT 1 FROM "collection_posts" cp JOIN "collections" c ON c."id" = cp."collection_id" WHERE cp."post_id" = p."id" AND c."owner_id" = ${ownerId} AND c."slug" = ${query.collection} AND c."is_public" = true) OR (${query.collection} = 'favoris' AND EXISTS (SELECT 1 FROM "post_tags" fpt JOIN "tags" ft ON ft."id" = fpt."tag_id" WHERE fpt."post_id" = p."id" AND ft."owner_id" = ${ownerId} AND ft."slug" = 'favoris')))
      AND to_tsvector('simple', p."search_text") @@ plainto_tsquery('simple', ${search})
      ${tagCondition}`;
  return { search, condition };
}

function relevanceTagCondition(
  ownerId: string,
  slugs: string[],
  mode: LibraryQuery["tagMode"],
): Prisma.Sql {
  if (slugs.length === 0) return Prisma.empty;
  const selectedSlugs = Prisma.join(slugs);

  if (mode === "and") {
    return Prisma.sql`
      AND (
        SELECT COUNT(DISTINCT t."slug")::integer
        FROM "post_tags" pt
        JOIN "tags" t ON t."id" = pt."tag_id"
        WHERE pt."post_id" = p."id"
          AND t."owner_id" = ${ownerId}
          AND t."slug" IN (${selectedSlugs})
      ) = ${slugs.length}
    `;
  }

  return Prisma.sql`
    AND EXISTS (
      SELECT 1
      FROM "post_tags" pt
      JOIN "tags" t ON t."id" = pt."tag_id"
      WHERE pt."post_id" = p."id"
        AND t."owner_id" = ${ownerId}
        AND t."slug" IN (${selectedSlugs})
    )
  `;
}

export async function getLibraryTags(requestedOwnerId?: string): Promise<LibraryTag[]> {
  const ownerId = parseOwnerId(requestedOwnerId ?? getApplicationOwnerId());
  if (!databaseConfigured) {
    const counts = new Map<string, LibraryTag>();
    for (const post of await readFallbackPosts()) {
      for (const name of post.tags) {
        const slug = tagSlug(name);
        const current = counts.get(slug);
        counts.set(slug, { name: current?.name ?? name, slug, count: (current?.count ?? 0) + 1 });
      }
    }
    return [...counts.values()].sort((left, right) => left.name.localeCompare(right.name, "fr"));
  }

  const tags = await prisma.tag.findMany({
    where: { ownerId },
    select: { name: true, slug: true, _count: { select: { postTags: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return tags.map((tag) => ({ name: tag.name, slug: tag.slug, count: tag._count.postTags }));
}

export async function getLibraryMainThemes(requestedOwnerId?: string): Promise<string[]> {
  const ownerId = parseOwnerId(requestedOwnerId ?? getApplicationOwnerId());
  if (!databaseConfigured) {
    return [...new Set((await readFallbackPosts()).flatMap((post) => post.mainTheme ? [post.mainTheme] : []))]
      .sort((left, right) => left.localeCompare(right, "fr"));
  }
  const rows = await prisma.post.findMany({
    where: { ownerId, mainTheme: { not: null } },
    distinct: ["mainTheme"],
    select: { mainTheme: true },
    orderBy: { mainTheme: "asc" },
  });
  return rows.flatMap((row) => row.mainTheme ? [row.mainTheme] : []);
}

export async function getLibraryYears(requestedOwnerId?: string): Promise<LibraryYear[]> {
  const ownerId = parseOwnerId(requestedOwnerId ?? getApplicationOwnerId());
  if (!databaseConfigured) {
    return calculateLibraryYears(await readFallbackPosts());
  }

  const rows = await prisma.$queryRaw<Array<{ year: number; count: bigint }>>(
    Prisma.sql`SELECT EXTRACT(YEAR FROM "published_at")::integer AS year, COUNT(*)::bigint AS count FROM "posts" WHERE "owner_id" = ${ownerId} AND "published_at" IS NOT NULL GROUP BY 1 ORDER BY 1 DESC`,
  );
  return rows.map((row) => ({ year: row.year, count: Number(row.count) }));
}

export async function getLibraryStats(requestedOwnerId?: string): Promise<LibraryStats> {
  const ownerId = parseOwnerId(requestedOwnerId ?? getApplicationOwnerId());
  if (!databaseConfigured) return calculateDetailedFallbackStats(await readFallbackPosts());
  return getDatabaseLibraryStats(ownerId);
}

export async function getLibraryAuthors(requestedOwnerId: string, query: string, limit: number) {
  return queryLibraryAuthors(requestedOwnerId, query, limit, readFallbackPosts);
}

export async function getLibraryPost(
  postId: string,
  requestedOwnerId?: string,
): Promise<LibraryPost | null> {
  const ownerId = parseOwnerId(requestedOwnerId ?? getApplicationOwnerId());
  if (!databaseConfigured) {
    return (await readFallbackPosts()).find((post) => post.id === postId) ?? null;
  }

  const row = await prisma.post.findFirst({
    where: { id: postId, ownerId },
    include: {
      ...postInclude,
      placeLinks: {
        where: { ownerId, place: { ownerId, reviewStatus: { not: "REJECTED" }, precision: { in: ["EXACT", "PROBABLE", "APPROXIMATE"] } } },
        orderBy: [{ isPrimary: "desc" }, { confidence: "desc" }, { id: "asc" }],
        select: { place: { select: { id: true, displayName: true, address: true, city: true, region: true, country: true } } },
      },
    },
  });
  return row ? { ...toLibraryPost(row, false), places: row.placeLinks.map((link) => link.place) } : null;
}

// Single source for the Prisma predicates shared by the normal list, count
// and random paths so they can never disagree on the active filters.
function libraryPostWhere(ownerId: string, query: LibraryQuery): Prisma.PostWhereInput {
  return {
    ownerId,
    ...(query.theme ? { mainTheme: query.theme } : {}),
    ...(query.contentType ? { contentType: query.contentType.toUpperCase() as "IMAGE" | "CAROUSEL" | "REEL" } : {}),
    ...(query.author ? { authorSortKey: foldForSearch(query.author) } : {}),
    ...(query.year ? { publishedAt: { gte: new Date(Date.UTC(query.year, 0, 1)), lt: new Date(Date.UTC(query.year + 1, 0, 1)) } } : {}),
    ...(query.collection ? collectionWhere(ownerId, query.collection) : {}),
    ...(query.search ? { searchText: { contains: foldForSearch(query.search) } } : {}),
    ...tagWhere(ownerId, query.tags, query.tagMode),
  };
}

function tagWhere(
  ownerId: string,
  rawTags: string[],
  mode: LibraryQuery["tagMode"],
): Prisma.PostWhereInput {
  const slugs = [...new Set(rawTags.map(tagSlug).filter(Boolean))];
  if (slugs.length === 0) return {};

  if (mode === "and") {
    return {
      AND: slugs.map((slug) => ({
        postTags: { some: { tag: { ownerId, slug } } },
      })),
    };
  }
  return { postTags: { some: { tag: { ownerId, slug: { in: slugs } } } } };
}

function collectionWhere(ownerId: string, slug: string): Prisma.PostWhereInput {
  const collection = { collectionPosts: { some: { collection: { ownerId, slug, isPublic: true } } } };
  if (slug !== "favoris") return collection;
  return { OR: [collection, { postTags: { some: { tag: { ownerId, slug: "favoris" } } } }] };
}

export async function getLibraryCollections(requestedOwnerId?: string): Promise<import("@/features/library/types").LibraryCollection[]> {
  const ownerId = parseOwnerId(requestedOwnerId ?? getApplicationOwnerId());
  if (!databaseConfigured) return [{ id: "fallback-favoris", name: "Favoris", slug: "favoris", isSystem: true, count: (await readFallbackPosts()).filter((post) => post.tags.includes("Favoris")).length }];
  const rows = await prisma.collection.findMany({
    where: { ownerId, isPublic: true },
    select: { id: true, name: true, slug: true, isSystem: true, _count: { select: { posts: true } } },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, isSystem: row.isSystem, count: row._count.posts }));
}

function cursorWhere(
  cursor: LibraryCursor | null,
  sort: Exclude<SortMode, "relevance">,
): Prisma.PostWhereInput {
  if (!cursor) return {};

  if (sort === "author") {
    if (cursor.value === null) return { id: { gt: cursor.id } };
    return {
      OR: [
        { authorSortKey: { gt: cursor.value } },
        { authorSortKey: cursor.value, id: { gt: cursor.id } },
      ],
    };
  }

  if (sort === "likes") {
    const field = "likesCount";
    if (cursor.value === null) return { [field]: null, id: { gt: cursor.id } };
    const metric = Number(cursor.value);
    if (!Number.isSafeInteger(metric) || metric < 0) throw cursorValidationError();
    return {
      OR: [
        { [field]: { lt: metric } },
        { [field]: metric, id: { gt: cursor.id } },
        { [field]: null },
      ],
    };
  }

  if (cursor.value === null) return { savedAt: null, id: { gt: cursor.id } };
  const date = new Date(cursor.value);
  if (Number.isNaN(date.getTime())) throw cursorValidationError();

  const dateBoundary: Prisma.PostWhereInput =
    sort === "oldest" ? { savedAt: { gt: date } } : { savedAt: { lt: date } };
  return {
    OR: [
      dateBoundary,
      { savedAt: date, id: { gt: cursor.id } },
      { savedAt: null },
    ],
  };
}

function cursorValidationError(): z.ZodError {
  return new z.ZodError([
    { code: "custom", path: ["cursor"], message: "Curseur invalide" },
  ]);
}

function orderByFor(
  sort: Exclude<SortMode, "relevance">,
): Prisma.PostOrderByWithRelationInput[] {
  if (sort === "author") return [{ authorSortKey: "asc" }, { id: "asc" }];
  if (sort === "likes") return [{ likesCount: { sort: "desc", nulls: "last" } }, { id: "asc" }];
  return [
    { savedAt: { sort: sort === "oldest" ? "asc" : "desc", nulls: "last" } },
    { id: "asc" },
  ];
}

function cursorFromRow(
  row: PostWithTags,
  exposedSort: SortMode,
  effectiveSort: Exclude<SortMode, "relevance">,
): LibraryCursor {
  return {
    version: 1,
    sort: exposedSort,
    value: effectiveSort === "author"
      ? row.authorSortKey
      : effectiveSort === "likes"
        ? String(row.likesCount ?? "") || null
        : (row.savedAt ?? row.createdAt).toISOString(),
    id: row.id,
  };
}

function toLibraryPost(row: PostWithTags, compact: boolean): LibraryPost {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const mediaCount = row.media.length;
  const selectedMedia = compact ? row.media.slice(0, 1) : row.media;
  const resolvedMedia = selectedMedia.map((media) => ({
    id: media.id,
    type: media.type.toLowerCase() as "image" | "video",
    url: resolvePublicMediaUrl(media.sourcePath, media.url, {
      type: media.type.toLowerCase() as "image" | "video",
      position: media.position,
      mediaCount,
    }),
    sourcePath: media.sourcePath,
    thumbnailUrl: resolvePublicMediaUrl(media.sourcePath, media.thumbnailUrl, {
      type: media.type.toLowerCase() as "image" | "video",
      position: media.position,
      mediaCount,
      thumbnail: true,
    }),
    position: media.position,
  }));
  const firstImage = resolvedMedia.find((media) => media.type === "image");
  const collections = row.collectionPosts.filter(({ collection }) => collection.isPublic).map(({ collection }) => collection.slug);
  const tags = row.postTags.map(({ tag }) => tag.name);
  if (collections.includes("favoris") && !tags.includes("Favoris")) tags.push("Favoris");
  return {
    id: row.id,
    externalId: row.externalId,
    postUrl: row.postUrl,
    thumbnailUrl: firstImage?.url ?? row.thumbnailUrl,
    mediaUrl: resolvedMedia[0]?.url ?? row.mediaUrl,
    media: resolvedMedia,
    authorUsername: row.authorUsername,
    caption: compact ? row.caption.slice(0, 500) : row.caption,
    captionTranslation: currentCaptionTranslation(row, row.classificationJobs ?? [], compact),
    tags: tags.sort((a, b) => a.localeCompare(b, "fr")),
    savedAt: row.savedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    contentType: row.contentType.toLowerCase() as ContentType,
    mainTheme: row.mainTheme,
    likesCount: row.likesCount,
    commentsCount: row.commentsCount,
    metadata: compact ? {} : metadata,
    collections,
  };
}

let fallbackPostsPromise: Promise<LibraryPost[]> | undefined;

async function readFallbackPosts(): Promise<LibraryPost[]> {
  fallbackPostsPromise ??= (async () => {
    const samplePath = path.join(process.cwd(), "resources", "instagram-saved-posts.sample.json");
    const source = JSON.parse(await readFile(samplePath, "utf8")) as unknown;
    return normalizeImportPayload(source).items.map((post) => {
      const media = post.media.map((item) => ({
        ...item,
        url: resolvePublicMediaUrl(item.sourcePath, item.url, {
          type: item.type,
          position: item.position,
          mediaCount: post.media.length,
        }),
        thumbnailUrl: resolvePublicMediaUrl(item.sourcePath, item.thumbnailUrl, {
          type: item.type,
          position: item.position,
          mediaCount: post.media.length,
          thumbnail: true,
        }),
        id: `sample_media_${createHash("sha256").update(`${post.postUrl}:${item.position}`).digest("hex").slice(0, 20)}`,
      }));
      const firstImage = media.find((item) => item.type === "image");
      return {
        id: `sample_${createHash("sha256").update(post.postUrl).digest("hex").slice(0, 20)}`,
        externalId: post.externalId,
        postUrl: post.postUrl,
        thumbnailUrl: firstImage?.url ?? post.thumbnailUrl,
        mediaUrl: media[0]?.url ?? post.mediaUrl,
        media,
        authorUsername: post.authorUsername,
        caption: post.caption,
        tags: post.tags,
        savedAt: post.savedAt?.toISOString() ?? null,
        createdAt: null,
        publishedAt: post.publishedAt?.toISOString() ?? null,
        contentType: post.contentType,
        mainTheme: post.mainTheme,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        metadata: post.metadata,
        collections: post.tags.includes("Favoris") ? ["favoris"] : [],
      };
    });
  })();
  return fallbackPostsPromise;
}
