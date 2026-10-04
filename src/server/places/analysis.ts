import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { foldForSearch } from "@/lib/import/normalize";
import type { PlaceCandidate, PlaceCandidateRecord } from "@/lib/places/candidates";
import { categoryFromProposal } from "@/lib/places/categories";
import { canonicalPlacesTheme } from "@/lib/places/eligibility";
import { continentCodeForCountry } from "@/lib/places/continents";
import { distanceMeters } from "@/lib/places/distance";
import { scoreResolvedCandidate, type ScoredResolution } from "@/lib/places/scoring";
import { prisma } from "@/server/db";
import { computePlacesInputHash } from "@/server/places/hash";
import { createMetadataAnalysisJob, PlacesJobError } from "@/server/places/jobs";
import { loadAnalysisPostInputs } from "@/server/places/repository";
import type { PlaceResolutionInput, PlaceResolver, ResolvedPlaceCandidate } from "@/server/places/resolvers/types";

// Atomic metadata analysis persistence (design section 7). Candidates are
// resolved and scored outside the write transaction; a single Prisma transaction
// then upserts canonical places, one link per place, and bounded evidence, and
// finalizes the job. Everything is owner-scoped. UNKNOWN creates no Place.
// User-confirmed places and links are never overwritten by automatic data.

const EXCERPT_MAX_LENGTH = 500;

type TxClient = Prisma.TransactionClient;

const EVIDENCE_TYPE_MAP = {
  CAPTION: "CAPTION",
  HASHTAG: "HASHTAG",
  AUTHOR_TEXT: "AUTHOR_TEXT",
  INSTAGRAM_LOCATION: "INSTAGRAM_LOCATION",
  AUDIO_TRANSCRIPT: "AUDIO_TRANSCRIPT",
  VIDEO_OCR: "VIDEO_OCR",
  VISUAL_LANDMARK: "VISUAL_LANDMARK",
} as const;

export type AnalyzeRecordInput = {
  ownerId: string;
  record: PlaceCandidateRecord;
  resolver: PlaceResolver;
  commit?: boolean;
};

export type AnalyzeRecordStatus = "SUCCEEDED" | "NEEDS_REVIEW" | "SKIPPED_DRY_RUN";

export type AnalyzeRecordResult = {
  postId: string;
  jobId: string | null;
  status: AnalyzeRecordStatus;
  placesPersisted: number;
  linksPersisted: number;
  evidencePersisted: number;
  unknownCandidates: number;
};

export type CandidatePlan = {
  candidate: PlaceCandidate;
  best: { resolved: ResolvedPlaceCandidate; scored: ScoredResolution } | null;
};

// Resolve one candidate and keep the best non-UNKNOWN resolution. Ordering is
// made deterministic by confidence then providerPlaceId so provider result order
// never changes the outcome.
async function planCandidate(
  candidate: PlaceCandidate,
  sourceTheme: "Voyages" | "Restaurant",
  resolver: PlaceResolver,
): Promise<CandidatePlan> {
  const input: PlaceResolutionInput = { candidate, sourceTheme };
  const resolved = await resolver.resolve(input);
  const viable = resolved
    .map((candidateResolution) => ({
      resolved: candidateResolution,
      scored: scoreResolvedCandidate({ candidate, resolved: candidateResolution }),
    }))
    .filter((entry) => entry.scored.precision !== "UNKNOWN")
    .sort(
      (left, right) =>
        right.scored.confidence - left.scored.confidence ||
        left.resolved.providerPlaceId.localeCompare(right.resolved.providerPlaceId),
    );
  // A candidate cannot choose between distinct plausible sites. A supplied
  // address must actually narrow the resolver results to one site first.
  // Nearby duplicate provider entries/entrances use the resolver's same 100 m
  // corroboration distance; sorting remains deterministic within one site.
  const specific = viable.filter(entry => entry.scored.precision !== 'APPROXIMATE');
  if (specific.some((entry, index) =>
    specific.slice(index + 1).some(other => distanceMeters(entry.resolved, other.resolved) > 100))) {
    return { candidate, best: viable.find(entry => entry.scored.precision === 'APPROXIMATE') ?? null };
  }
  return { candidate, best: viable[0] ?? null };
}

export async function analyzeCandidateBatchRecord(input: AnalyzeRecordInput): Promise<AnalyzeRecordResult> {
  const commit = input.commit ?? false;
  // The record's analysis_version is the single source of truth: it drives both
  // the freshness hash below and the job identity. There is no external override,
  // so a hash can never be verified with one version and a job created with another.
  const analysisVersion = input.record.analysis_version;

  // Owner-scoped load and eligibility, reusing the F1 predicate and repository.
  const post = await loadAnalysisPostInputs(input.ownerId, input.record.post_id);
  if (!post) throw new PlacesJobError("POST_NOT_FOUND");

  const sourceTheme = canonicalPlacesTheme(post.mainTheme);
  if (!sourceTheme) {
    // A post that left an eligible theme cancels its still-pending automatic jobs
    // instead of leaving them queued. Confirmed data is never touched.
    if (commit) await cancelNonTerminalJobs(input.ownerId, post.id);
    throw new PlacesJobError("POST_NOT_PLACES_ELIGIBLE");
  }

  // Freshness gate. Recompute the current input hash with the record's version
  // and reject a stale result — one generated from an older caption, tags,
  // structured location, or verified media — BEFORE any Geoapify call, job
  // creation, or Prisma transaction. Nothing is written for a stale line.
  const currentInputHash = computePlacesInputHash({
    analysisVersion,
    postId: post.id,
    sourceTheme,
    caption: post.caption,
    authorUsername: post.authorUsername,
    internalTags: post.internalTags,
    structuredLocation: post.structuredLocation,
    verifiedMedia: post.verifiedMedia,
  });
  if (currentInputHash !== input.record.input_hash) {
    throw new PlacesJobError("PLACES_INPUT_STALE");
  }

  // Dry-run previews the plan without writing anything and without a job.
  if (!commit) {
    const plans = await planAll(input.record.candidates, sourceTheme, input.resolver);
    return summarize(post.id, null, "SKIPPED_DRY_RUN", plans);
  }

  // The job exists idempotently (created at export time or here). Provider
  // failures mark this job FAILED without any partial domain writes.
  const job = await createMetadataAnalysisJob({ ownerId: input.ownerId, postId: post.id, analysisVersion });

  let plans: CandidatePlan[];
  try {
    plans = await planAll(input.record.candidates, sourceTheme, input.resolver);
  } catch (error) {
    await markJobFailed(prisma, job.id, error);
    throw error;
  }

  try {
    return await prisma.$transaction((tx) =>
      persistMetadataAnalysis(tx, { ownerId: input.ownerId, postId: post.id, jobId: job.id, plans }),
    );
  } catch (error) {
    await markJobFailed(prisma, job.id, error);
    throw error;
  }
}

export async function planAll(
  candidates: PlaceCandidate[],
  sourceTheme: "Voyages" | "Restaurant",
  resolver: PlaceResolver,
): Promise<CandidatePlan[]> {
  const plans: CandidatePlan[] = [];
  for (const candidate of candidates) {
    plans.push(await planCandidate(candidate, sourceTheme, resolver));
  }
  return plans;
}

export type PersistMetadataAnalysisInput = {
  ownerId: string;
  postId: string;
  jobId: string;
  plans: CandidatePlan[];
};

type PersistedLink = {
  placeId: string;
  confidence: number;
  precision: "EXACT" | "PROBABLE" | "APPROXIMATE";
};

// The single atomic domain transaction. Any thrown error rolls back every write.
export async function persistMetadataAnalysis(
  tx: TxClient,
  { ownerId, postId, jobId, plans }: PersistMetadataAnalysisInput,
): Promise<AnalyzeRecordResult> {
  // Re-runs are idempotent: drop the job's previous automatic evidence, never a
  // user correction, then rebuild it.
  await tx.placeEvidence.deleteMany({
    where: { ownerId, postId, analysisJobId: jobId, evidenceType: { not: "USER_CORRECTION" } },
  });

  const persistedPlaceIds = new Set<string>();
  const persistedLinks: PersistedLink[] = [];
  let evidencePersisted = 0;

  for (const plan of plans) {
    if (!plan.best) {
      evidencePersisted += await insertCandidateEvidence(tx, {
        ownerId,
        postId,
        placeId: null,
        jobId,
        candidate: plan.candidate,
      });
      continue;
    }

    const { resolved, scored } = plan.best;
    const place = await upsertCanonicalPlace(tx, { ownerId, postId, resolved, scored, candidate: plan.candidate });
    persistedPlaceIds.add(place.id);

    const link = await upsertPostPlace(tx, { ownerId, postId, placeId: place.id, jobId, scored });
    if (link) {
      persistedLinks.push({
        placeId: place.id,
        confidence: scored.confidence,
        precision: scored.precision as "EXACT" | "PROBABLE" | "APPROXIMATE",
      });
    }

    evidencePersisted += await insertCandidateEvidence(tx, {
      ownerId,
      postId,
      placeId: place.id,
      jobId,
      candidate: plan.candidate,
    });
    evidencePersisted += await insertProviderEvidence(tx, { ownerId, postId, placeId: place.id, jobId, resolved, scored });
  }

  await supersedeAutomaticApproximatePrimary(tx, { ownerId, postId, persistedLinks });
  await assignPrimaryLink(tx, { ownerId, postId, persistedLinks });

  const resolvedCount = plans.filter((plan) => plan.best).length;
  const status: AnalyzeRecordStatus =
    resolvedCount > 0 ? "SUCCEEDED" : plans.length > 0 ? "NEEDS_REVIEW" : "SUCCEEDED";

  await tx.placeAnalysisJob.update({
    where: { id: jobId },
    data: {
      status: status === "SUCCEEDED" ? "SUCCEEDED" : "NEEDS_REVIEW",
      stage: "COMPLETE",
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      result: {
        placesPersisted: persistedPlaceIds.size,
        linksPersisted: persistedLinks.length,
        evidencePersisted,
        unknownCandidates: plans.length - resolvedCount,
      },
    },
  });

  return {
    postId,
    jobId,
    status,
    placesPersisted: persistedPlaceIds.size,
    linksPersisted: persistedLinks.length,
    evidencePersisted,
    unknownCandidates: plans.length - resolvedCount,
  };
}

async function upsertCanonicalPlace(
  tx: TxClient,
  { ownerId, postId, resolved, scored, candidate }: { ownerId: string; postId: string; resolved: ResolvedPlaceCandidate; scored: ScoredResolution; candidate: PlaceCandidate },
) {
  const precision = scored.precision as "EXACT" | "PROBABLE" | "APPROXIMATE";
  // Exact/provider-verified places remain canonical. An approximate area is an
  // uncertainty envelope for one post, never a shared canonical destination.
  const providerPlaceId =
    precision === "APPROXIMATE"
      ? `${resolved.providerPlaceId}:post:${postId}`
      : resolved.providerPlaceId;
  // Read the current certainty after any concurrent writer has committed.
  // Otherwise a weaker post can overwrite a stronger shared resolution using
  // an earlier snapshot. The existing transaction owns this row lock.
  await tx.$queryRaw`SELECT id FROM places
    WHERE owner_id = ${ownerId} AND provider = ${resolved.provider}
      AND provider_place_id = ${providerPlaceId} FOR UPDATE`;
  const existing = await tx.place.findUnique({
    where: {
      ownerId_provider_providerPlaceId: {
        ownerId,
        provider: resolved.provider,
        providerPlaceId,
      },
    },
  });

  // scored.precision is never UNKNOWN here (UNKNOWN plans have best === null).
  const descriptive = {
    displayName: resolved.displayName,
    normalizedName: foldForSearch(resolved.displayName),
    category: categoryFromProposal(candidate.category),
    address: resolved.address,
    city: resolved.city,
    region: resolved.region,
    country: resolved.country,
    countryCode: resolved.countryCode,
    continentCode: continentCodeForCountry(resolved.countryCode),
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    precision,
    confidence: scored.confidence,
    approximationRadiusMeters: scored.approximationRadiusMeters,
    metadata: {
      provider: resolved.provider,
      sourceProviderPlaceId: resolved.providerPlaceId,
      providerResultType: resolved.providerResultType,
      providerRank: resolved.providerRank,
      providerMatchType: resolved.providerMatchType,
      attribution: resolved.attribution,
      classification: { source: "post_analysis", category: categoryFromProposal(candidate.category),
        reason: candidate.categoryReason ?? null, evidenceTypes: [...new Set(candidate.evidence.map(item => item.type))] },
    } satisfies Prisma.InputJsonValue,
  };

  if (!existing) {
    return tx.place.create({
      data: {
        ownerId,
        provider: resolved.provider,
        providerPlaceId,
        reviewStatus: "UNREVIEWED",
        isUserConfirmed: false,
        ...descriptive,
      },
    });
  }
  // Never overwrite a user-confirmed canonical place with automatic data.
  if (existing.isUserConfirmed) return existing;
  const sameResolution = (
    ["displayName", "category", "address", "city", "region", "country", "countryCode", "latitude", "longitude"] as const
  ).every(field => existing[field] === descriptive[field]);
  const precisionRank = { UNKNOWN: 0, APPROXIMATE: 1, PROBABLE: 2, EXACT: 3 };
  if (sameResolution && (
    precisionRank[existing.precision] > precisionRank[precision] ||
    (existing.precision === precision && existing.confidence > scored.confidence)
  )) {
    // Only the canonical certainty is shared. Links and evidence below keep
    // the new post's own score; changed locations still accept corrections.
    descriptive.precision = existing.precision as typeof precision;
    descriptive.confidence = existing.confidence;
    descriptive.approximationRadiusMeters = existing.approximationRadiusMeters;
  }
  // Keep the confirmation guard on the write as well as the locked read.
  await tx.place.updateMany({ where: { id: existing.id, ownerId, isUserConfirmed: false }, data: descriptive });
  return tx.place.findUniqueOrThrow({ where: { id: existing.id } });
}

async function upsertPostPlace(
  tx: TxClient,
  {
    ownerId,
    postId,
    placeId,
    jobId,
    scored,
  }: { ownerId: string; postId: string; placeId: string; jobId: string; scored: ScoredResolution },
) {
  const existing = await tx.postPlace.findUnique({
    where: { ownerId_postId_placeId: { ownerId, postId, placeId } },
  });
  // A user-confirmed link dominates any automatic re-analysis: leave it intact.
  if (existing?.isUserConfirmed) return null;

  const precision = scored.precision as "EXACT" | "PROBABLE" | "APPROXIMATE";
  if (!existing) {
    return tx.postPlace.create({
      data: {
        ownerId,
        postId,
        placeId,
        analysisJobId: jobId,
        isPrimary: false,
        isUserConfirmed: false,
        precision,
        confidence: scored.confidence,
      },
    });
  }
  const updated = await tx.postPlace.updateMany({
    where: { id: existing.id, ownerId, isUserConfirmed: false },
    data: { analysisJobId: jobId, precision, confidence: scored.confidence },
  });
  return updated.count ? tx.postPlace.findUniqueOrThrow({ where: { id: existing.id } }) : null;
}

async function supersedeAutomaticApproximatePrimary(
  tx: TxClient,
  {
    ownerId,
    postId,
    persistedLinks,
  }: {
    ownerId: string;
    postId: string;
    persistedLinks: PersistedLink[];
  },
): Promise<void> {
  if (!persistedLinks.some((link) => link.precision === "EXACT")) return;

  await tx.postPlace.deleteMany({
    where: {
      ownerId,
      postId,
      isPrimary: true,
      isUserConfirmed: false,
      precision: "APPROXIMATE",
      placeId: { notIn: persistedLinks.map((link) => link.placeId) },
    },
  });
}

// Assign exactly one primary link per post (design D5, enforced by a partial
// unique index). A user-confirmed primary is never displaced.
async function assignPrimaryLink(
  tx: TxClient,
  {
    ownerId,
    postId,
    persistedLinks,
  }: {
    ownerId: string;
    postId: string;
    persistedLinks: PersistedLink[];
  },
) {
  const confirmedPrimary = await tx.postPlace.findFirst({
    where: { ownerId, postId, isPrimary: true, isUserConfirmed: true },
  });
  if (confirmedPrimary || persistedLinks.length === 0) return;

  const best = [...persistedLinks].sort(
    (left, right) => right.confidence - left.confidence || left.placeId.localeCompare(right.placeId),
  )[0];

  await tx.postPlace.updateMany({
    where: { ownerId, postId, isPrimary: true, isUserConfirmed: false },
    data: { isPrimary: false },
  });
  await tx.postPlace.update({
    where: { ownerId_postId_placeId: { ownerId, postId, placeId: best.placeId } },
    data: { isPrimary: true },
  });
}

async function insertCandidateEvidence(
  tx: TxClient,
  {
    ownerId,
    postId,
    placeId,
    jobId,
    candidate,
  }: { ownerId: string; postId: string; placeId: string | null; jobId: string; candidate: PlaceCandidate },
): Promise<number> {
  if (candidate.evidence.length === 0) return 0;
  const normalizedValue = foldForSearch(candidate.name ?? candidate.city ?? "") || null;
  await tx.placeEvidence.createMany({
    data: candidate.evidence.map((item) => ({
      ownerId,
      postId,
      placeId,
      analysisJobId: jobId,
      evidenceType: EVIDENCE_TYPE_MAP[item.type],
      normalizedValue,
      excerpt: item.excerpt.slice(0, EXCERPT_MAX_LENGTH),
      videoTimestampMs: item.videoTimestampMs ?? null,
      metadata: item.mediaId ? { mediaId: item.mediaId } : {},
      confidence: candidate.confidence,
    })),
  });
  return candidate.evidence.length;
}

async function insertProviderEvidence(
  tx: TxClient,
  {
    ownerId,
    postId,
    placeId,
    jobId,
    resolved,
    scored,
  }: {
    ownerId: string;
    postId: string;
    placeId: string;
    jobId: string;
    resolved: ResolvedPlaceCandidate;
    scored: ScoredResolution;
  },
): Promise<number> {
  await tx.placeEvidence.create({
    data: {
      ownerId,
      postId,
      placeId,
      analysisJobId: jobId,
      evidenceType: "PROVIDER_MATCH",
      normalizedValue: `${resolved.provider}:${resolved.providerPlaceId}`,
      confidence: scored.confidence,
      metadata: { providerResultType: resolved.providerResultType } satisfies Prisma.InputJsonValue,
    },
  });
  return 1;
}

async function cancelNonTerminalJobs(ownerId: string, postId: string): Promise<void> {
  await prisma.placeAnalysisJob.updateMany({
    where: { ownerId, postId, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "CANCELLED", stage: "COMPLETE", completedAt: new Date() },
  });
}

async function markJobFailed(client: PrismaClient, jobId: string, error: unknown): Promise<void> {
  // Only a stable, bounded code is stored: never a raw message that could carry a
  // secret. Geoapify errors already expose a safe code.
  const errorCode =
    error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string"
      ? ((error as { code: string }).code).slice(0, 64)
      : "ANALYSIS_FAILED";
  await client.placeAnalysisJob.update({
    where: { id: jobId },
    data: { status: "FAILED", stage: "COMPLETE", completedAt: new Date(), errorCode, errorMessage: errorCode },
  });
}

function summarize(
  postId: string,
  jobId: string | null,
  status: AnalyzeRecordStatus,
  plans: CandidatePlan[],
): AnalyzeRecordResult {
  const resolvedCount = plans.filter((plan) => plan.best).length;
  const evidencePersisted = plans.reduce((total, plan) => total + plan.candidate.evidence.length, 0);
  return {
    postId,
    jobId,
    status,
    placesPersisted: resolvedCount,
    linksPersisted: resolvedCount,
    evidencePersisted,
    unknownCandidates: plans.length - resolvedCount,
  };
}
