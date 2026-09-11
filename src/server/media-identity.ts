import "server-only";

import { MediaIdentity, type Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { deriveObjectKey, headR2Object } from "@/server/r2";

// One media object's authoritative R2 identity, as verified during sync.
export type VerifiedMediaIdentity = {
  position: number;
  objectKey: string;
  mimeType: string | null;
  byteSize: number;
  versionTag: string | null;
};

// Persist the R2 identity the sync path already verified, promoting the
// matching PostMedia rows to VERIFIED. Scoped by ownerId and postId so it can
// never touch another owner's or post's media. Idempotent: re-running with the
// same evidence yields the same rows.
export async function persistVerifiedMediaIdentity(input: {
  ownerId: string;
  postId: string;
  media: VerifiedMediaIdentity[];
}, db: Prisma.TransactionClient = prisma): Promise<number> {
  let updated = 0;
  for (const media of input.media) {
    const result = await db.postMedia.updateMany({
      where: { ownerId: input.ownerId, postId: input.postId, position: media.position },
      data: {
        objectKey: media.objectKey,
        mimeType: media.mimeType,
        byteSize: media.byteSize,
        versionTag: media.versionTag,
        identityState: MediaIdentity.VERIFIED,
        checkedAt: new Date(),
      },
    });
    updated += result.count;
  }
  return updated;
}

export type MediaIdentityBackfillReport = {
  scanned: number;
  verified: number;
  repairable: number;
};

// Idempotent, re-runnable maintenance step (design decision D3). For an owner's
// media that is not yet VERIFIED but has a derivable object key, HEAD the object
// and promote it: VERIFIED when present (with real size/MIME/version), REPAIRABLE
// when the key is derivable but the object is absent. Media without a sourcePath
// stays UNVERIFIED — flagged, never fabricated. Never writes fake identity.
export async function backfillMediaIdentity(input: {
  ownerId: string;
  limit?: number;
}): Promise<MediaIdentityBackfillReport> {
  const take = Math.min(Math.max(input.limit ?? 100, 1), 1000);
  const candidates = await prisma.postMedia.findMany({
    where: {
      ownerId: input.ownerId,
      identityState: { not: MediaIdentity.VERIFIED },
      sourcePath: { not: null },
    },
    select: { id: true, sourcePath: true },
    orderBy: { id: "asc" },
    take,
  });

  let verified = 0;
  let repairable = 0;
  for (const candidate of candidates) {
    if (!candidate.sourcePath) continue;
    const objectKey = deriveObjectKey(candidate.sourcePath);
    const identity = await headR2Object(objectKey);
    if (identity) {
      await prisma.postMedia.update({
        where: { id: candidate.id },
        data: {
          objectKey,
          mimeType: identity.mimeType,
          byteSize: identity.byteSize,
          versionTag: identity.versionTag,
          identityState: MediaIdentity.VERIFIED,
          checkedAt: new Date(),
        },
      });
      verified += 1;
    } else {
      await prisma.postMedia.update({
        where: { id: candidate.id },
        data: { objectKey, identityState: MediaIdentity.REPAIRABLE, checkedAt: new Date() },
      });
      repairable += 1;
    }
  }
  return { scanned: candidates.length, verified, repairable };
}
