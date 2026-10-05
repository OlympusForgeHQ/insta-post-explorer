import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { foldForSearch, instagramPostCode, tagSlug } from "@/lib/import/normalize";
import { databaseConfigured, prisma } from "@/server/db";
import { setAuditAction } from "@/server/audit-log";
import { parseOwnerId } from "@/server/owner";
import { findPostAliases, lockPostWrites } from "@/server/post-deletions";

const postIdSchema = z.string().trim().min(1).max(256);
const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((value) => value.replace(/\s+/g, " "))
  .refine((value) => tagSlug(value).length > 0, "Tag invalide");

export class AdminResourceNotFoundError extends Error {
  constructor() {
    super("NOT_FOUND");
    this.name = "AdminResourceNotFoundError";
  }
}

type PostIdentity = {
  id: string;
  authorUsername: string;
  caption: string;
  mainTheme: string | null;
};

export async function addTagToPost(input: {
  ownerId: string;
  postId: string;
  tagName: string;
}): Promise<string[]> {
  requireDatabase();
  const ownerId = parseOwnerId(input.ownerId);
  const postId = postIdSchema.parse(input.postId);
  const tagName = tagNameSchema.parse(input.tagName);
  const slug = tagSlug(tagName);

  return prisma.$transaction(async (transaction) => {
    const post = await findOwnedPost(transaction, ownerId, postId);
    const tag = await transaction.tag.upsert({
      where: { ownerId_slug: { ownerId, slug } },
      create: { ownerId, name: tagName, slug },
      update: {},
      select: { id: true },
    });

    await transaction.postTag.upsert({
      where: { postId_tagId: { postId, tagId: tag.id } },
      create: { postId, tagId: tag.id, isManual: true },
      update: { isManual: true },
    });

    return synchronizePostSearchText(transaction, ownerId, post);
  });
}

export async function removeTagFromPost(input: {
  ownerId: string;
  postId: string;
  tagName: string;
}): Promise<string[]> {
  requireDatabase();
  const ownerId = parseOwnerId(input.ownerId);
  const postId = postIdSchema.parse(input.postId);
  const slug = tagSlug(tagNameSchema.parse(input.tagName));

  return prisma.$transaction(async (transaction) => {
    const post = await findOwnedPost(transaction, ownerId, postId);
    const tag = await transaction.tag.findUnique({
      where: { ownerId_slug: { ownerId, slug } },
      select: { id: true },
    });

    if (tag) {
      await transaction.postTag.deleteMany({
        where: { postId, tagId: tag.id },
      });
      await transaction.tag.deleteMany({
        where: { id: tag.id, ownerId, postTags: { none: {} } },
      });
    }

    return synchronizePostSearchText(transaction, ownerId, post);
  });
}

export async function deleteOwnedPost(input: {
  ownerId: string;
  postId: string;
}): Promise<void> {
  requireDatabase();
  const ownerId = parseOwnerId(input.ownerId);
  const postId = postIdSchema.parse(input.postId);

  await prisma.$transaction(async (transaction) => {
    await setAuditAction(transaction, "admin.delete_post");
    await lockPostWrites(transaction, ownerId);
    const matchingPosts = await findPostAliases(transaction, ownerId, postId);
    if (matchingPosts.length === 0) throw new AdminResourceNotFoundError();
    await transaction.deletedPost.createMany({
      data: matchingPosts.map((candidate) => ({
        ownerId, postUrl: candidate.postUrl, externalId: candidate.externalId,
        postCode: instagramPostCode(candidate.postUrl),
      })),
      skipDuplicates: true,
    });
    const deleted = await transaction.post.deleteMany({
      where: { id: { in: matchingPosts.map((candidate) => candidate.id) }, ownerId },
    });
    if (deleted.count === 0) throw new AdminResourceNotFoundError();

    await transaction.tag.deleteMany({
      where: { ownerId, postTags: { none: {} } },
    });
  }, { maxWait: 5_000, timeout: 20_000 });
}

function requireDatabase(): void {
  if (!databaseConfigured) throw new Error("DATABASE_NOT_CONFIGURED");
}

async function findOwnedPost(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  postId: string,
): Promise<PostIdentity> {
  // Share the classification/import write gate so manual tag changes win in order.
  await lockPostWrites(transaction, ownerId);
  await transaction.$queryRaw`SELECT id FROM posts WHERE owner_id=${ownerId} AND id=${postId} FOR UPDATE`;
  const post = await transaction.post.findFirst({
    where: { id: postId, ownerId },
    select: {
      id: true,
      authorUsername: true,
      caption: true,
      mainTheme: true,
    },
  });
  if (!post) throw new AdminResourceNotFoundError();
  return post;
}

async function synchronizePostSearchText(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  post: PostIdentity,
): Promise<string[]> {
  const tags = await transaction.tag.findMany({
    where: { ownerId, postTags: { some: { postId: post.id } } },
    select: { name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const names = tags.map((tag) => tag.name);

  await transaction.post.update({
    where: { id: post.id },
    data: {
      searchText: foldForSearch(
        [post.authorUsername, post.caption, ...names, post.mainTheme ?? ""].join(" "),
      ),
    },
  });

  return names;
}
