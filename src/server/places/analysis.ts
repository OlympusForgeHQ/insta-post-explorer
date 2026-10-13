import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { foldForSearch } from "@/lib/import/normalize";
import type { PlaceCandidate, PlaceCandidateRecord } from "@/lib/places/candidates";
import { categoryFromProposal, isPlaceCategoryGroup } from "@/lib/places/categories";
import { canonicalPlacesTheme } from "@/lib/places/eligibility";
import { continentCodeForCountry } from "@/lib/places/continents";
import { distanceMeters } from "@/lib/places/distance";
import {addressAgreement, entityNamesAgree, type ScoredResolution} from "@/lib/places/scoring";
import { decidePlaceResolution, RESOLUTION_POLICY_VERSION } from '@/lib/places/resolution';
import { prisma } from "@/server/db";
import { computePlacesInputHash } from "@/server/places/hash";
import { createMetadataAnalysisJob, PlacesJobError } from "@/server/places/jobs";
import { loadAnalysisPostInputs } from "@/server/places/repository";
import {enrichFromVerifiedMemory, loadVerifiedResolutionMemory, type VerifiedPlaceMemory} from './resolution-memory';
import {cityBranchScope,type CityBranchSourceContext} from '@/lib/places/branch-scope';
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
  reasons?: string[];
  branches?: CandidatePlan[];
};

// Resolve one candidate and keep the best non-UNKNOWN resolution. Ordering is
// made deterministic by confidence then providerPlaceId so provider result order
// never changes the outcome.
async function planCandidate(
  candidate: PlaceCandidate,
  sourceTheme: "Voyages" | "Restaurant",
  resolver: PlaceResolver,
  sourceContext?:CityBranchSourceContext,
): Promise<CandidatePlan> {
  // Unidentified visual evidence still belongs in review. An empty provider
  // query is invalid and must never prevent other candidates from completing.
  if (![candidate.name, candidate.address, candidate.city, candidate.region, candidate.country]
    .some(value => Boolean(value?.trim()))) return { candidate, best: null, reasons: ['no_identity_context'] };
  const input: PlaceResolutionInput = { candidate, sourceTheme, sourceContext };
  const resolved = await resolver.resolve(input);
  const evaluated = resolved
    .map((candidateResolution) => ({
      resolved: candidateResolution,
      scored: decidePlaceResolution({ candidate, resolved: candidateResolution }),
    }));
  const viable = evaluated
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
  const branchScope=cityBranchScope(candidate,sourceContext);
  if (branchScope && specific.length > 1) {
    // Keep the source candidate immutable; each provider branch is a separate
    // resolution of that recommendation, not an invented source address.
    const sites:typeof specific=[];
    for(const entry of specific){
      if(!entry.scored.reasons.includes('city_match') ||
        (branchScope==='generic'&&!entry.scored.reasons.includes('country_match')))continue;
      if(!sites.some(site=>site.resolved.providerPlaceId===entry.resolved.providerPlaceId ||
        (site.resolved.address===entry.resolved.address && distanceMeters(site.resolved,entry.resolved)<=25)))sites.push(entry);
    }
    if(sites.length>1)return {candidate,best:sites[0],reasons:[branchScope==='generic'?'generic_city_branches':'explicit_city_branches'],
      branches:sites.map(best=>({candidate,best,reasons:best.scored.reasons}))};
  }
  if (specific.some((entry, index) =>
    specific.slice(index + 1).some(other => distanceMeters(entry.resolved, other.resolved) > 100))) {
    return { candidate, best: null, reasons: ['ambiguous_branches'] };
  }
  const best = viable[0] ?? null;
  return { candidate, best, reasons: best?.scored.reasons ?? [...new Set(evaluated.flatMap(entry => entry.scored.reasons)),
    ...(resolved.length ? [] : ['provider_no_results'])] };
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
    const plans = await planAll(input.record.candidates, sourceTheme, input.resolver, await loadVerifiedResolutionMemory(input.ownerId,input.record.candidates),{caption:post.caption,structuredLocation:post.structuredLocation});
    return summarize(post.id, null, "SKIPPED_DRY_RUN", plans);
  }

  // The job exists idempotently (created at export time or here). Provider
  // failures mark this job FAILED without any partial domain writes.
  const job = await createMetadataAnalysisJob({ ownerId: input.ownerId, postId: post.id, analysisVersion });

  let plans: CandidatePlan[];
  try {
    plans = await planAll(input.record.candidates, sourceTheme, input.resolver, await loadVerifiedResolutionMemory(input.ownerId,input.record.candidates),{caption:post.caption,structuredLocation:post.structuredLocation});
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
  memory: VerifiedPlaceMemory[] = [],
  sourceContext?:CityBranchSourceContext,
): Promise<CandidatePlan[]> {
  const plans: CandidatePlan[] = [];
  for (const candidate of candidates) {
    const enriched=enrichFromVerifiedMemory(candidate,memory);
    const plan=await planCandidate(enriched,sourceTheme,resolver,sourceContext);
    if(enriched!==candidate)plan.reasons=['verified_memory_context',...(plan.reasons??[])];
    plans.push(plan);
  }
  return plans;
}

export type PersistMetadataAnalysisInput = {
  ownerId: string;
  postId: string;
  jobId: string;
  plans: CandidatePlan[];
  preserveExisting?: boolean;
};

type PersistedLink = {
  placeId: string;
  confidence: number;
  precision: "EXACT" | "PROBABLE" | "APPROXIMATE";
};

// The single atomic domain transaction. Any thrown error rolls back every write.
export async function persistMetadataAnalysis(
  tx: TxClient,
  { ownerId, postId, jobId, plans, preserveExisting=false }: PersistMetadataAnalysisInput,
): Promise<AnalyzeRecordResult> {
  await tx.$queryRaw`SELECT id FROM place_analysis_jobs WHERE id=${jobId} AND owner_id=${ownerId} FOR UPDATE`;
  // Re-runs are idempotent: drop the job's previous automatic evidence, never a
  // user correction, then rebuild it.
  await tx.placeEvidence.deleteMany({
    where: { ownerId, postId, analysisJobId: jobId, evidenceType: { not: "USER_CORRECTION" } },
  });

  const persistedPlaceIds = new Set<string>();
  const persistedLinks: PersistedLink[] = [];
  let evidencePersisted = 0;

  for (const plan of plans.flatMap(source => source.branches ?? [source])) {
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
    if(resolved.provider!=='geoapify'){
      plan.best=null;plan.reasons=['provider_content_not_persistable'];
      evidencePersisted+=await insertCandidateEvidence(tx,{ownerId,postId,placeId:null,jobId,candidate:plan.candidate});
      continue;
    }
    const place = await upsertCanonicalPlace(tx, { ownerId, postId, resolved, scored, candidate: plan.candidate, preserveExisting });
    if(!place||place.reviewStatus==='REJECTED'){
      plan.best=null;plan.reasons=[place?'manual_identity_rejected':'existing_identity_conflict'];
      evidencePersisted+=await insertCandidateEvidence(tx,{ownerId,postId,placeId:null,jobId,candidate:plan.candidate});
      continue;
    }
    persistedPlaceIds.add(place.id);

    const link = await upsertPostPlace(tx, { ownerId, postId, placeId: place.id, jobId, scored, preserveExisting });
    if(!link&&!await tx.postPlace.findUnique({where:{ownerId_postId_placeId:{ownerId,postId,placeId:place.id}},select:{id:true}})){
      plan.best=null;plan.reasons=['manual_association_removed'];
      evidencePersisted+=await insertCandidateEvidence(tx,{ownerId,postId,placeId:null,jobId,candidate:plan.candidate});
      continue;
    }
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

  if(!preserveExisting)await supersedeAutomaticApproximatePrimary(tx, { ownerId, postId, persistedLinks });
  if(!preserveExisting||!await tx.postPlace.findFirst({where:{ownerId,postId,isPrimary:true}}))await assignPrimaryLink(tx, { ownerId, postId, persistedLinks });

  for(const plan of plans){
    if(!plan.branches)continue;
    // One unresolved source candidate if any branch is blocked, even when other
    // branches were added. This preserves the source evidence recovery contract.
    if(plan.branches.some(branch=>!branch.best)){
      plan.best=null;
      plan.reasons=['partial_city_branches',...new Set(plan.branches.filter(branch=>!branch.best).flatMap(branch=>branch.reasons??[]))];
    }
  }
  const resolvedCount = plans.filter((plan) => plan.best).length;
  const status: AnalyzeRecordStatus =
    resolvedCount < plans.length ? "NEEDS_REVIEW" : "SUCCEEDED";
  const prior=await tx.placeAnalysisJob.findUniqueOrThrow({where:{id:jobId},select:{result:true}});
  const usage=prior.result&&typeof prior.result==='object'&&!Array.isArray(prior.result)?prior.result.googleUsage:undefined;

  await tx.placeAnalysisJob.update({
    where: { id: jobId },
    data: {
      status: status === "SUCCEEDED" ? "SUCCEEDED" : "NEEDS_REVIEW",
      stage: "COMPLETE",
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      result: {
        ...(usage?{googleUsage:usage}:{}),
        placesPersisted: persistedPlaceIds.size,
        linksPersisted: persistedLinks.length,
        evidencePersisted,
        unknownCandidates: plans.length - resolvedCount,
        resolutionPolicy: RESOLUTION_POLICY_VERSION,
        decisions: plans.map((plan, index) => ({index, precision: plan.best?.scored.precision ?? 'UNKNOWN', reasons: plan.reasons ?? [],
          candidate:{name:plan.candidate.name,address:plan.candidate.address,city:plan.candidate.city,region:plan.candidate.region,country:plan.candidate.country},
          inferredFields: plan.candidate.inferredFields ?? [],
          ...(plan.branches?{branches:plan.branches.map(branch=>({providerPlaceId:branch.best?.resolved.providerPlaceId??null,
            precision:branch.best?.scored.precision??'UNKNOWN',reasons:branch.reasons??[]}))}:{})})),
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
  { ownerId, postId, resolved, scored, candidate, preserveExisting }: { ownerId: string; postId: string; resolved: ResolvedPlaceCandidate; scored: ScoredResolution; candidate: PlaceCandidate; preserveExisting:boolean },
) {
  const precision = scored.precision as "EXACT" | "PROBABLE" | "APPROXIMATE";
  // Exact/provider-verified places remain canonical. An approximate area is an
  // uncertainty envelope for one post, never a shared canonical destination.
  const providerPlaceId =
    precision === "APPROXIMATE"
      ? `${resolved.providerPlaceId}:post:${postId}`
      : resolved.providerPlaceId;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`place-identity:${ownerId}:${foldForSearch(resolved.city??'')}`},0))::text`;
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
        reason: candidate.categoryReason ?? null, evidenceTypes: [...new Set(candidate.evidence.map(item => item.type))] } as Prisma.InputJsonValue,
    } satisfies Prisma.InputJsonValue,
  };

  if (!existing) {
    // Provider IDs differ across catalogs. Reuse only the same named, addressed
    // physical site; never merge nearby branches or a business with a city.
    if(precision!=='APPROXIMATE'&&resolved.address&&resolved.city&&resolved.countryCode){
      const alternatives=await tx.place.findMany({where:{ownerId,
        city:{equals:resolved.city,mode:'insensitive'},countryCode:resolved.countryCode,provider:{not:resolved.provider},
        latitude:{gte:resolved.latitude-.002,lte:resolved.latitude+.002},
        precision:{in:['EXACT','PROBABLE']}},take:201});
      const nearby=alternatives.filter(place=>entityNamesAgree(place.displayName,resolved.providerName??resolved.displayName)&&distanceMeters(place,resolved)<=100);
      const sameSite=nearby.filter(place=>addressAgreement(place.address,resolved.address).match);
      if(alternatives.length<=200&&sameSite.length===1)return sameSite[0];
      if(nearby.length||alternatives.length>200)return null;
    }
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
  if (existing.isUserConfirmed || preserveExisting) return existing;
  // Earlier owner-authorized reviews recorded USER_CORRECTION evidence without
  // setting the later confirmation flag. Their decisions have the same priority.
  if (await tx.placeEvidence.findFirst({
    where: { ownerId, placeId: existing.id, evidenceType: "USER_CORRECTION",
      metadata: { path: ["action"], equals: "PLACE_CATEGORY_CORRECTED" },
    }, select: { id: true },
  })) return existing;
  // A later mention with no specific type must not erase knowledge shared by
  // earlier posts. Keep its provenance as well; the new evidence stays on its
  // own post. Explicit supported types and manual corrections can still change it.
  if (descriptive.category === "divers" && isPlaceCategoryGroup(existing.category) && existing.category !== "divers") {
    descriptive.category = existing.category;
    const previous = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? existing.metadata.classification : null;
    descriptive.metadata.classification = previous ?? {
      source: "preserved_existing_category", category: existing.category, reason: null, evidenceTypes: [],
    };
  }
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
    preserveExisting,
  }: { ownerId: string; postId: string; placeId: string; jobId: string; scored: ScoredResolution; preserveExisting:boolean },
) {
  const existing = await tx.postPlace.findUnique({
    where: { ownerId_postId_placeId: { ownerId, postId, placeId } },
  });
  // A user-confirmed link dominates any automatic re-analysis: leave it intact.
  if (existing && (existing.isUserConfirmed || preserveExisting)) return null;

  const precision = scored.precision as "EXACT" | "PROBABLE" | "APPROXIMATE";
  if (!existing) {
    // An explicitly removed association must not be resurrected by another run.
    const deletion=await tx.auditEvent.findFirst({where:{ownerId,tableName:'post_places',operation:'DELETE',AND:[
      {beforeData:{path:['post_id'],equals:postId}},{beforeData:{path:['place_id'],equals:placeId}},
    ]},select:{id:true}});
    if(deletion)return null;
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
      metadata: { ...(item.mediaId ? {mediaId: item.mediaId} : {}), inferredFields: candidate.inferredFields ?? [] },
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
      metadata: { providerResultType: resolved.providerResultType, resolutionPolicy: RESOLUTION_POLICY_VERSION,
        providerSource:resolved.providerSource??null,providerRank:resolved.providerRank,
        providerNameAliases:resolved.providerNameAliases??[],
        providerBounds:resolved.providerBounds??null,providerLocalityBoundary:resolved.providerLocalityBoundary??null,
        street:resolved.street??null,houseNumber:resolved.houseNumber??null,localityNames:resolved.localityNames??[],
        reasons: scored.reasons } satisfies Prisma.InputJsonValue,
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
