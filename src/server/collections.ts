import "server-only";

import { z } from "zod";
import { foldForSearch, tagSlug } from "@/lib/import/normalize";
import { databaseConfigured, prisma } from "@/server/db";
import { parseOwnerId } from "@/server/owner";
import { AdminResourceNotFoundError } from "@/server/admin-library";
import { setAuditAction } from "@/server/audit-log";
import { lockPostWrites } from "@/server/post-deletions";

const nameSchema = z.string().trim().min(1).max(80).transform((value) => value.replace(/\s+/g, " "));
const idSchema = z.string().trim().min(1).max(256);

function requireDatabase() { if (!databaseConfigured) throw new Error("DATABASE_NOT_CONFIGURED"); }

export async function createCollection(owner: string, rawName: string) {
  requireDatabase();
  const ownerId = parseOwnerId(owner); const name = nameSchema.parse(rawName); const slug = tagSlug(name);
  return prisma.collection.create({ data: { ownerId, name, slug, isPublic: true }, select: { id: true, name: true, slug: true, isSystem: true } });
}

export async function renameCollection(owner: string, rawId: string, rawName: string) {
  requireDatabase(); const ownerId = parseOwnerId(owner); const id = idSchema.parse(rawId); const name = nameSchema.parse(rawName);
  const result = await prisma.collection.updateMany({ where: { id, ownerId, isSystem: false }, data: { name, slug: tagSlug(name) } });
  if (!result.count) throw new AdminResourceNotFoundError();
  return prisma.collection.findFirstOrThrow({ where: { id, ownerId }, select: { id: true, name: true, slug: true, isSystem: true } });
}

export async function deleteCollection(owner: string, rawId: string) {
  requireDatabase(); const ownerId = parseOwnerId(owner); const id = idSchema.parse(rawId);
  const result = await prisma.collection.deleteMany({ where: { id, ownerId, isSystem: false } });
  if (!result.count) throw new AdminResourceNotFoundError();
}

export async function setPostCollection(owner: string, rawCollectionId: string, rawPostId: string, included: boolean) {
  requireDatabase(); const ownerId = parseOwnerId(owner); const collectionId = idSchema.parse(rawCollectionId); const postId = idSchema.parse(rawPostId);
  const [collection, post] = await Promise.all([prisma.collection.findFirst({ where: { id: collectionId, ownerId } }), prisma.post.findFirst({ where: { id: postId, ownerId }, select: { id: true } })]);
  if (!collection || !post) throw new AdminResourceNotFoundError();
  if (included) await prisma.collectionPost.upsert({ where: { collectionId_postId: { collectionId, postId } }, create: { collectionId, postId }, update: {} });
  else await prisma.collectionPost.deleteMany({ where: { collectionId, postId } });
  return { included };
}


export class FavoriteCollectionUnavailableError extends Error {
  constructor() {
    super("FAVORITES_UNAVAILABLE");
    this.name = "FavoriteCollectionUnavailableError";
  }
}

export async function setPostFavorite(owner: string, rawPostId: string, included: boolean): Promise<{ included: boolean }> {
  requireDatabase();
  const ownerId = parseOwnerId(owner);
  const postId = idSchema.parse(rawPostId);

  return prisma.$transaction(async (transaction) => {
    // Keep the same owner/post lock order as manual tags and classification.
    await lockPostWrites(transaction, ownerId);
    await transaction.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${postId} FOR UPDATE`;
    const post = await transaction.post.findFirst({
      where: { id: postId, ownerId },
      select: { id: true, authorUsername: true, caption: true, mainTheme: true },
    });
    if (!post) throw new AdminResourceNotFoundError();

    let favorites = await transaction.collection.findUnique({
      where: { ownerId_slug: { ownerId, slug: "favoris" } },
    });
    if (favorites && (!favorites.isSystem || !favorites.isPublic)) {
      throw new FavoriteCollectionUnavailableError();
    }
    await setAuditAction(transaction, included ? "public.favorite.add" : "public.favorite.remove");

    if (included) {
      favorites ??= await transaction.collection.create({
        data: { ownerId, name: "Favoris", slug: "favoris", isSystem: true, isPublic: true },
      });
      await transaction.collectionPost.upsert({
        where: { collectionId_postId: { collectionId: favorites.id, postId } },
        create: { collectionId: favorites.id, postId },
        update: {},
      });
    } else {
      if (favorites) {
        await transaction.collectionPost.deleteMany({ where: { collectionId: favorites.id, postId } });
      }
      const removed = await transaction.postTag.deleteMany({
        where: { postId, tag: { ownerId, slug: "favoris" } },
      });
      if (removed.count) {
        const remaining = await transaction.tag.findMany({
          where: { ownerId, postTags: { some: { postId } } },
          select: { name: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        await transaction.post.update({
          where: { id: postId },
          data: { searchText: foldForSearch([post.authorUsername, post.caption, ...remaining.map(tag => tag.name), post.mainTheme ?? ""].join(" ")) },
        });
      }
    }
    return { included };
  });
}
