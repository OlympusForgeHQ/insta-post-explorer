import "server-only";

import {
  ContentType as PrismaContentType,
  ImportStatus,
  Prisma,
} from "@prisma/client";
import { z } from "zod";

import {
  prepareImportPayload,
  foldForSearch,
  tagSlug,
  type NormalizedImportPost,
} from "@/lib/import/normalize";
import { databaseConfigured, prisma } from "@/server/db";
import { getApplicationOwnerId, parseOwnerId } from "@/server/owner";

const importOptionsSchema = z.object({
  ownerId: z.unknown().optional(),
  sourceName: z.string().trim().max(255).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  batchSize: z.number().int().min(1).max(250).default(100),
});

export type ImportReport = {
  jobId: string;
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  invalid: number;
};

export async function importPosts(
  input: unknown,
  options: {
    ownerId?: string;
    sourceName?: string;
    idempotencyKey?: string;
    batchSize?: number;
  } = {},
  transaction?: Prisma.TransactionClient,
): Promise<ImportReport> {
  const db = transaction ?? prisma;
  if (!databaseConfigured) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  const parsedOptions = importOptionsSchema.parse(options);
  const ownerId = parseOwnerId(parsedOptions.ownerId ?? getApplicationOwnerId());
  const prepared = prepareImportPayload(input);
  if (parsedOptions.idempotencyKey) {
    const existingJob = await db.importJob.findUnique({
      where: {
        ownerId_idempotencyKey: {
          ownerId,
          idempotencyKey: parsedOptions.idempotencyKey,
        },
      },
    });
    if (existingJob?.status === ImportStatus.COMPLETED) return reportFromJob(existingJob);
    if (existingJob) throw new Error("IMPORT_ALREADY_STARTED");
  }

  const job = await db.importJob
    .create({
      data: {
        ownerId,
        idempotencyKey: parsedOptions.idempotencyKey,
        sourceName: parsedOptions.sourceName,
        total: prepared.total,
        skipped: prepared.skipped,
        invalid: prepared.invalid,
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (
        parsedOptions.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error("IMPORT_ALREADY_STARTED");
      }
      throw error;
    });

  let imported = 0;
  let updated = 0;

  try {
    for (let offset = 0; offset < prepared.items.length; offset += parsedOptions.batchSize) {
      const batch = prepared.items.slice(offset, offset + parsedOptions.batchSize);
      const batchResult = await persistBatch(ownerId, batch, transaction);
      imported += batchResult.imported;
      updated += batchResult.updated;
    }

    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportStatus.COMPLETED,
        imported,
        updated,
        finishedAt: new Date(),
      },
    });
  } catch (error: unknown) {
    await db.importJob
      .update({
        where: { id: job.id },
        data: {
          status: ImportStatus.FAILED,
          imported,
          updated,
          errorCode: classifyImportError(error),
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
    throw error;
  }

  return {
    jobId: job.id,
    total: prepared.total,
    imported,
    updated,
    skipped: prepared.skipped,
    invalid: prepared.invalid,
  };
}

function reportFromJob(job: {
  id: string;
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  invalid: number;
}): ImportReport {
  return {
    jobId: job.id,
    total: job.total,
    imported: job.imported,
    updated: job.updated,
    skipped: job.skipped,
    invalid: job.invalid,
  };
}

async function persistBatch(
  ownerId: string,
  batch: NormalizedImportPost[],
  enclosingTransaction?: Prisma.TransactionClient,
): Promise<{ imported: number; updated: number }> {
  if (batch.length === 0) return { imported: 0, updated: 0 };

  const persist = async (transaction: Prisma.TransactionClient) => {
      const urls = batch.map((post) => post.postUrl);
      const existingPosts = await transaction.post.findMany({
        where: { ownerId, postUrl: { in: urls } },
        select: { postUrl: true },
      });
      const existingUrls = new Set(existingPosts.map((post) => post.postUrl));
      const persistedPosts: Array<{ id: string; source: NormalizedImportPost }> = [];

      for (const source of batch) {
        const data = toPostData(source);
        const post = await transaction.post.upsert({
          where: { ownerId_postUrl: { ownerId, postUrl: source.postUrl } },
          create: { ownerId, ...data },
          update: data,
          select: { id: true },
        });
        persistedPosts.push({ id: post.id, source });
      }

      const tagsBySlug = new Map<string, string>();
      for (const { source } of persistedPosts) {
        for (const tag of source.tags) tagsBySlug.set(tagSlug(tag), tag);
      }

      if (tagsBySlug.size > 0) {
        await transaction.tag.createMany({
          data: [...tagsBySlug].map(([slug, name]) => ({ ownerId, slug, name })),
          skipDuplicates: true,
        });
      }

      const tags = await transaction.tag.findMany({
        where: { ownerId, slug: { in: [...tagsBySlug.keys()] } },
        select: { id: true, slug: true },
      });
      const tagIds = new Map(tags.map((tag) => [tag.slug, tag.id]));
      const postIds = persistedPosts.map((post) => post.id);

      await transaction.postTag.deleteMany({
        where: { postId: { in: postIds }, isManual: false },
      });
      await transaction.postMedia.deleteMany({ where: { postId: { in: postIds } } });

      const postMedia = persistedPosts.flatMap(({ id: postId, source }) =>
        source.media.map((media) => ({
          postId,
          ownerId,
          type: media.type.toUpperCase() as "IMAGE" | "VIDEO",
          url: media.url,
          sourcePath: media.sourcePath,
          thumbnailUrl: media.thumbnailUrl,
          position: media.position,
          // R2 identity stays UNVERIFIED here: generic imports carry no
          // verified R2 evidence. The sync path promotes its media to VERIFIED
          // after import; the identity backfill promotes eligible legacy media.
        })),
      );
      if (postMedia.length > 0) {
        await transaction.postMedia.createMany({ data: postMedia });
      }

      const postTags = persistedPosts.flatMap(({ id: postId, source }) =>
        source.tags.flatMap((tag) => {
          const tagId = tagIds.get(tagSlug(tag));
          return tagId ? [{ postId, tagId, isManual: false }] : [];
        }),
      );
      if (postTags.length > 0) {
        await transaction.postTag.createMany({ data: postTags, skipDuplicates: true });
      }

      const updated = batch.filter((post) => existingUrls.has(post.postUrl)).length;
      return { imported: batch.length - updated, updated };
    };
  return enclosingTransaction ? persist(enclosingTransaction) :
    prisma.$transaction(persist, { maxWait: 5_000, timeout: 20_000 });
}

function toPostData(post: NormalizedImportPost): Prisma.PostUncheckedCreateWithoutPostTagsInput {
  return {
    externalId: post.externalId,
    postUrl: post.postUrl,
    thumbnailUrl: post.thumbnailUrl,
    mediaUrl: post.mediaUrl,
    authorUsername: post.authorUsername,
    authorSortKey: foldForSearch(post.authorUsername),
    caption: post.caption,
    savedAt: post.savedAt,
    publishedAt: post.publishedAt,
    contentType: post.contentType.toUpperCase() as PrismaContentType,
    mainTheme: post.mainTheme,
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    metadata: post.metadata as Prisma.InputJsonValue,
    searchText: post.searchText,
  };
}

function classifyImportError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return "DATABASE_CONSTRAINT";
  if (error instanceof z.ZodError) return "VALIDATION_FAILED";
  return "IMPORT_FAILED";
}
