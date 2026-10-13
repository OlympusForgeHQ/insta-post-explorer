import "server-only";

import type { PlaceAnalysisJob } from "@prisma/client";

import { canonicalPlacesTheme } from "@/lib/places/eligibility";
import { prisma } from "@/server/db";
import { hasOwnerNoPlaceConfirmation } from "./post-exclusion";
import { computePlacesInputHash } from "@/server/places/hash";
import { loadAnalysisPostInputs } from "@/server/places/repository";

// Default analysis version. A caption-content change or a version bump yields a
// new idempotent job; the same content and version returns the existing job.
export const PLACES_ANALYSIS_VERSION = process.env.PLACES_ANALYSIS_VERSION?.trim() || "places-v2";

export type PlacesJobErrorCode =
  | "POST_NOT_FOUND"
  | "POST_NOT_PLACES_ELIGIBLE"
  | "PLACES_INPUT_STALE"
  | "PLACES_JOB_CONFLICT";

export class PlacesJobError extends Error {
  readonly code: PlacesJobErrorCode;
  constructor(code: PlacesJobErrorCode) {
    super(code);
    this.code = code;
    this.name = "PlacesJobError";
  }
}

export type CreateMetadataAnalysisJobInput = {
  ownerId: string;
  postId: string;
  analysisVersion?: string;
};

// Create (or return the existing idempotent) METADATA_ONLY analysis job for an
// eligible post. Eligibility is decided only by isPlacesEligibleTheme through
// canonicalPlacesTheme plus durable owner review; collections are never consulted.
export async function createMetadataAnalysisJob(
  input: CreateMetadataAnalysisJobInput,
): Promise<PlaceAnalysisJob> {
  const analysisVersion = input.analysisVersion?.trim() || PLACES_ANALYSIS_VERSION;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM posts WHERE id=${input.postId} AND owner_id=${input.ownerId} FOR UPDATE`;
    const post = await loadAnalysisPostInputs(input.ownerId, input.postId, tx);
    if (!post) throw new PlacesJobError("POST_NOT_FOUND");

    const sourceTheme = canonicalPlacesTheme(post.mainTheme);
    if (!sourceTheme || await hasOwnerNoPlaceConfirmation(input.ownerId, post.id, tx)) {
      throw new PlacesJobError("POST_NOT_PLACES_ELIGIBLE");
    }

    const inputHash = computePlacesInputHash({
      analysisVersion,
      postId: post.id,
      sourceTheme,
      caption: post.caption,
      authorUsername: post.authorUsername,
      internalTags: post.internalTags,
      structuredLocation: post.structuredLocation,
      verifiedMedia: post.verifiedMedia,
  });

  const identity = {
    ownerId: input.ownerId,
    postId: post.id,
    inputHash,
    analysisVersion,
  };

  // Concurrency-safe idempotency without a thrown P2002. `createMany` with
  // `skipDuplicates` issues INSERT ... ON CONFLICT DO NOTHING, so a duplicate
  // idempotency key is absorbed at the database level — no exception is thrown and
  // nothing is logged (the noisy "expected P2002" is gone). We then read the row
  // back: a fresh cuid id can only ever conflict on the idempotency key, so the
  // read must succeed. If it does not, an unexpected conflict occurred and we
  // surface a stable code instead of masking it.
  await tx.placeAnalysisJob.createMany({
    data: [{ ...identity, sourceTheme, depth: "METADATA_ONLY" }],
    skipDuplicates: true,
  });
  const job = await tx.placeAnalysisJob.findUnique({
    where: { ownerId_postId_inputHash_analysisVersion: identity },
  });
  if (!job) throw new PlacesJobError("PLACES_JOB_CONFLICT");
  return job;
  });
}
