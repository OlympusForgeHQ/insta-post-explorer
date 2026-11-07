// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { foldForSearch } from "@/lib/import/normalize";

vi.mock("server-only", () => ({}));
const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const ownerId = `favorites-${randomUUID()}`;
const otherOwner = `${ownerId}-other`;
let db: PrismaClient;
let collections: typeof import("@/server/collections");
const owners = { ownerId: { in: [ownerId, otherOwner] } };

async function clear() {
  await db.post.deleteMany({ where: owners });
  await db.collection.deleteMany({ where: owners });
  await db.tag.deleteMany({ where: owners });
}
async function post(owner = ownerId) {
  return db.post.create({ data: { ownerId: owner, postUrl: `https://www.instagram.com/p/${randomUUID()}`, thumbnailUrl: "https://example.test/a.jpg", authorUsername: "Café", authorSortKey: "cafe", caption: "Crème maison", mainTheme: "Cuisine", searchText: "original search text", metadata: { preserved: true } } });
}
async function favoriteCollection(data = {}) {
  return db.collection.create({ data: { ownerId, name: "Favoris", slug: "favoris", isSystem: true, isPublic: true, ...data } });
}

(databaseUrl ? describe : describe.skip)("shared favorites on PostgreSQL", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", databaseUrl!);
    ({ prisma: db } = await import("@/server/db"));
    collections = await import("@/server/collections");
  });
  beforeEach(clear);
  afterAll(async () => { await clear(); await db.$disconnect(); vi.unstubAllEnvs(); });

  it("creates only the fixed system collection and persists idempotent explicit state with audited writes", async () => {
    const source = await post();
    expect(await collections.setPostFavorite(ownerId, source.id, true)).toEqual({ included: true });
    await Promise.all([collections.setPostFavorite(ownerId, source.id, true), collections.setPostFavorite(ownerId, source.id, true)]);
    const favorites = await db.collection.findUniqueOrThrow({ where: { ownerId_slug: { ownerId, slug: "favoris" } } });
    expect(favorites).toMatchObject({ name: "Favoris", isSystem: true, isPublic: true });
    expect(await db.collectionPost.count({ where: { collectionId: favorites.id, postId: source.id } })).toBe(1);
    expect(await db.post.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
    const added = await db.auditEvent.findMany({ where: { ownerId, action: "public.favorite.add" }, orderBy: { id: "asc" } });
    expect(added.map(event => event.tableName)).toEqual(["collections", "collection_posts"]);
    expect(new Set(added.map(event => event.transactionId)).size).toBe(1);
    expect(await collections.setPostFavorite(ownerId, source.id, false)).toEqual({ included: false });
    await collections.setPostFavorite(ownerId, source.id, false);
    expect(await db.collectionPost.count({ where: { postId: source.id } })).toBe(0);
    const removed = await db.auditEvent.findMany({ where: { ownerId, action: "public.favorite.remove", recordKey: { path: ["post_id"], equals: source.id } } });
    expect(removed.map(event => event.tableName)).toEqual(["collection_posts"]);
    expect(await db.post.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
  });

  it("rejects absent and foreign-owner posts before creating collections or affecting their membership", async () => {
    const foreign = await post(otherOwner);
    const foreignFavorites = await favoriteCollection({ ownerId: otherOwner });
    await db.collectionPost.create({ data: { collectionId: foreignFavorites.id, postId: foreign.id } });
    for (const id of [foreign.id, "missing", "x' OR 1=1 --"]) {
      await expect(collections.setPostFavorite(ownerId, id, true)).rejects.toThrow("NOT_FOUND");
      await expect(collections.setPostFavorite(ownerId, id, false)).rejects.toThrow("NOT_FOUND");
    }
    expect(await db.collection.count({ where: { ownerId } })).toBe(0);
    expect(await db.collectionPost.count({ where: { postId: foreign.id } })).toBe(1);
  });

  it("removes legacy-only and combined favorites without changing other tags, collections or classification state", async () => {
    const legacy = await db.tag.create({ data: { ownerId, name: "Favoris", slug: "favoris" } });
    const manual = await db.tag.create({ data: { ownerId, name: "Été", slug: "ete" } });
    const foreignTag = await db.tag.create({ data: { ownerId: otherOwner, name: "Foreign Favoris", slug: "favoris" } });
    const other = await db.collection.create({ data: { ownerId, name: "Recettes", slug: "recettes" } });
    for (const combined of [false, true]) {
      const source = await post();
      await db.postTag.createMany({ data: [legacy, manual, foreignTag].map(tag => ({ postId: source.id, tagId: tag.id, isManual: true })) });
      await db.collectionPost.create({ data: { collectionId: other.id, postId: source.id } });
      if (combined) {
        const favorites = await favoriteCollection();
        await db.collectionPost.create({ data: { collectionId: favorites.id, postId: source.id } });
      }
      const beforeTags = await db.postTag.findMany({ where: { postId: source.id, tagId: { not: legacy.id } }, orderBy: { tagId: "asc" } });
      await collections.setPostFavorite(ownerId, source.id, false);
      expect(await db.postTag.findMany({ where: { postId: source.id }, orderBy: { tagId: "asc" } })).toEqual(beforeTags);
      expect(await db.collectionPost.findMany({ where: { postId: source.id } })).toEqual([expect.objectContaining({ collectionId: other.id })]);
      expect(await db.post.findUniqueOrThrow({ where: { id: source.id } })).toEqual({ ...source, updatedAt: expect.any(Date), searchText: foldForSearch("Café Crème maison Été Cuisine") });
      const events = await db.auditEvent.findMany({ where: { ownerId, action: "public.favorite.remove", OR: [{ recordKey: { path: ["post_id"], equals: source.id } }, { recordKey: { path: ["id"], equals: source.id } }] } });
      expect(events.map(event => event.tableName)).toEqual(expect.arrayContaining(["posts", "post_tags"]));
      expect(new Set(events.map(event => event.transactionId)).size).toBe(1);
      expect(await db.workerLearningExample.count({ where: { postId: source.id } })).toBe(0);
      expect(await db.postClassificationJob.count({ where: { postId: source.id } })).toBe(0);
    }
    expect(await db.tag.count({ where: { id: { in: [legacy.id, manual.id, foreignTag.id] } } })).toBe(3);
  });

  it("does not create a missing collection on remove and rejects private or non-system collisions atomically", async () => {
    const source = await post();
    await collections.setPostFavorite(ownerId, source.id, false);
    expect(await db.collection.count({ where: { ownerId } })).toBe(0);
    const legacy = await db.tag.create({ data: { ownerId, name: "Favoris", slug: "favoris" } });
    await db.postTag.create({ data: { postId: source.id, tagId: legacy.id } });
    for (const flags of [{ isSystem: false, isPublic: true }, { isSystem: true, isPublic: false }]) {
      const collision = await favoriteCollection(flags);
      await db.collectionPost.create({ data: { collectionId: collision.id, postId: source.id } });
      for (const included of [true, false]) await expect(collections.setPostFavorite(ownerId, source.id, included)).rejects.toThrow();
      expect(await db.collection.findUniqueOrThrow({ where: { id: collision.id } })).toEqual(collision);
      expect(await db.collectionPost.count({ where: { collectionId: collision.id, postId: source.id } })).toBe(1);
      expect(await db.postTag.count({ where: { postId: source.id, tagId: legacy.id } })).toBe(1);
      expect(await db.post.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
      await db.collection.delete({ where: { id: collision.id } });
    }
  });
});
