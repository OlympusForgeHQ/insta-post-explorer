import "server-only";

import { z } from "zod";
import { Prisma } from "@prisma/client";

import { foldForSearch, tagSlug } from "@/lib/import/normalize";
import { detectTagVariants } from "@/lib/tag-variants";
import { databaseConfigured, prisma } from "@/server/db";
import { parseOwnerId } from "@/server/owner";
import { lockPostWrites } from '@/server/post-deletions';
import { setAuditAction } from '@/server/audit-log';

const idSchema = z.string().trim().min(1).max(256);
const nameSchema = z.string().trim().min(1).max(80).transform((value) => value.replace(/\s+/g, " "))
  .refine((value) => Boolean(tagSlug(value)), "Tag invalide");

export class AdminConflictError extends Error {
  constructor(message: string) { super(message); this.name = "AdminConflictError"; }
}

function requireDatabase() {
  if (!databaseConfigured) throw new Error("DATABASE_NOT_CONFIGURED");
}

export async function getAdminTags(ownerInput: string, search = "") {
  requireDatabase();
  const ownerId = parseOwnerId(ownerInput);
  const query = search.trim().slice(0, 80);
  const tags = await prisma.tag.findMany({
    where: { ownerId, ...(query ? { name: { contains: query, mode: "insensitive" } } : {}) },
    select: { id: true, name: true, slug: true, _count: { select: { postTags: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const items = tags.map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug, count: tag._count.postTags }));
  return { items, variants: detectTagVariants(items) };
}

export async function renameAdminTag(ownerInput: string, tagInput: string, nameInput: string) {
  requireDatabase();
  const ownerId = parseOwnerId(ownerInput);
  const tagId = idSchema.parse(tagInput);
  const name = nameSchema.parse(nameInput);
  const slug = tagSlug(name);
  return prisma.$transaction(async (tx) => {
    await lockPostWrites(tx, ownerId);
    await setAuditAction(tx, 'admin.rename_tag');
    const tag = await tx.tag.findFirst({ where: { id: tagId, ownerId }, select: { id: true } });
    if (!tag) throw new AdminConflictError("TAG_NOT_FOUND");
    const duplicate = await tx.tag.findUnique({ where: { ownerId_slug: { ownerId, slug } }, select: { id: true } });
    if (duplicate && duplicate.id !== tagId) throw new AdminConflictError("TAG_ALREADY_EXISTS");
    await tx.tag.update({ where: { id: tagId }, data: { name, slug } });
    await refreshTaggedPosts(tx, ownerId, tagId);
    return { id: tagId, name, slug };
  });
}

export async function mergeAdminTags(ownerInput: string, sourceInput: string, targetInput: string) {
  requireDatabase();
  const ownerId = parseOwnerId(ownerInput);
  const sourceId = idSchema.parse(sourceInput);
  const targetId = idSchema.parse(targetInput);
  if (sourceId === targetId) throw new AdminConflictError("SAME_TAG");
  return prisma.$transaction(async (tx) => {
    await lockPostWrites(tx, ownerId);
    await setAuditAction(tx, 'admin.merge_tags');
    const [source, target] = await Promise.all([
      tx.tag.findFirst({ where: { id: sourceId, ownerId }, select: { id: true } }),
      tx.tag.findFirst({ where: { id: targetId, ownerId }, select: { id: true, name: true } }),
    ]);
    if (!source || !target) throw new AdminConflictError("TAG_NOT_FOUND");
    const links = await tx.postTag.findMany({ where: { tagId: sourceId }, select: { postId: true, isManual: true } });
    for (const link of links) {
      await tx.postTag.upsert({
        where: { postId_tagId: { postId: link.postId, tagId: targetId } },
        create: { postId: link.postId, tagId: targetId, isManual: link.isManual },
        update: { isManual: link.isManual ? true : undefined },
      });
    }
    await tx.postTag.deleteMany({ where: { tagId: sourceId } });
    await tx.tag.delete({ where: { id: sourceId } });
    await refreshPosts(tx, ownerId, links.map((link) => link.postId));
    return { merged: links.length, targetId, targetName: target.name };
  });
}

export async function deleteAdminTag(ownerInput: string, tagInput: string) {
  requireDatabase();
  const ownerId = parseOwnerId(ownerInput);
  const tagId = idSchema.parse(tagInput);
  return prisma.$transaction(async (tx) => {
    await lockPostWrites(tx, ownerId);
    await setAuditAction(tx, 'admin.delete_tag');
    const tag = await tx.tag.findFirst({ where: { id: tagId, ownerId }, select: { id: true } });
    if (!tag) throw new AdminConflictError("TAG_NOT_FOUND");
    const links = await tx.postTag.findMany({ where: { tagId }, select: { postId: true } });
    await tx.postTag.deleteMany({ where: { tagId } });
    await tx.tag.delete({ where: { id: tagId } });
    await refreshPosts(tx, ownerId, links.map((link) => link.postId));
    return { unassigned: links.length };
  });
}

export async function getAdminInsights(ownerInput: string) {
  requireDatabase();
  const ownerId = parseOwnerId(ownerInput);
  const [total, favorites, types, themes, authors, years] = await prisma.$transaction([
    prisma.post.count({ where: { ownerId } }),
    prisma.post.count({ where: { ownerId, postTags: { some: { tag: { ownerId, slug: "favoris" } } } } }),
    prisma.post.groupBy({ by: ["contentType"], where: { ownerId }, _count: { id: true }, orderBy: { contentType: "asc" } }),
    prisma.post.groupBy({ by: ["mainTheme"], where: { ownerId, mainTheme: { not: null } }, _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 12 }),
    prisma.post.groupBy({ by: ["authorUsername"], where: { ownerId }, _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 12 }),
    prisma.$queryRaw<Array<{ year: number; count: bigint }>>(Prisma.sql`SELECT EXTRACT(YEAR FROM COALESCE("published_at", "saved_at"))::int AS year, COUNT(*)::bigint AS count FROM "posts" WHERE "owner_id" = ${ownerId} AND COALESCE("published_at", "saved_at") IS NOT NULL GROUP BY year ORDER BY year DESC`),
  ]);
  return {
    total, favorites,
    contentTypes: types.map((item) => ({ name: item.contentType.toLowerCase(), count: groupedCount(item._count) })),
    themes: themes.map((item) => ({ name: item.mainTheme ?? "Sans thème", count: groupedCount(item._count) })),
    authors: authors.map((item) => ({ name: item.authorUsername, count: groupedCount(item._count) })),
    years: years.map((item) => ({ name: String(item.year), count: Number(item.count) })),
  };
}

function groupedCount(value: true | { id?: number } | undefined) {
  return typeof value === "object" ? value.id ?? 0 : 0;
}

export async function getMediaHealth(ownerInput: string) {
  requireDatabase();
  const ownerId = parseOwnerId(ownerInput);
  const [posts, media, postsWithoutMedia, missingPostThumbnail, missingMediaSource, missingVideoThumbnail] = await prisma.$transaction([
    prisma.post.count({ where: { ownerId } }), prisma.postMedia.count({ where: { post: { ownerId } } }),
    prisma.post.count({ where: { ownerId, media: { none: {} } } }),
    prisma.post.count({ where: { ownerId, OR: [{ thumbnailUrl: "" }, { thumbnailUrl: { startsWith: "http" } }] } }),
    prisma.postMedia.count({ where: { post: { ownerId }, AND: [{ url: null }, { sourcePath: null }] } }),
    prisma.postMedia.count({ where: { post: { ownerId }, type: "VIDEO", thumbnailUrl: null } }),
  ]);
  const anomalies = { postsWithoutMedia, missingPostThumbnail, missingMediaSource, missingVideoThumbnail };
  return { posts, media, anomalies, totalAnomalies: Object.values(anomalies).reduce((sum, value) => sum + value, 0), checkedAt: new Date().toISOString() };
}

async function refreshTaggedPosts(tx: Prisma.TransactionClient, ownerId: string, tagId: string) {
  const links = await tx.postTag.findMany({ where: { tagId }, select: { postId: true } });
  await refreshPosts(tx, ownerId, links.map((link) => link.postId));
}

async function refreshPosts(tx: Prisma.TransactionClient, ownerId: string, postIds: string[]) {
  for (const postId of [...new Set(postIds)]) {
    const post = await tx.post.findFirst({ where: { id: postId, ownerId }, select: { id: true, authorUsername: true, caption: true, mainTheme: true, postTags: { include: { tag: true } } } });
    if (!post) continue;
    await tx.post.update({ where: { id: post.id }, data: { searchText: foldForSearch([post.authorUsername, post.caption, post.mainTheme ?? "", ...post.postTags.map(({ tag }) => tag.name)].join(" ")) } });
  }
}
