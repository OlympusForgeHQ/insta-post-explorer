// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("server-only", () => ({}));

import * as mergeState from "@/lib/places/merge-state";
import * as reviewActor from "@/lib/places/review-actor";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const OWNER_A = "owner-review-a";
const OWNER_B = "owner-review-b";

// A valid review context: an actor and a bounded reason.
const CTX = { actor: { type: "USER" as const, id: "local-admin" }, reason: "manual review" };

let prisma: PrismaClient;
let review: typeof import("@/server/places/review");
const previousDatabaseUrl = process.env.DATABASE_URL;

describeWithDatabase("Places review and merge services on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("@/server/db"));
    review = await import("@/server/places/review");
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(resetDatabase);

  it("confirms a place with an audit trail", async () => {
    const place = await seedPlace(OWNER_A);
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, place.id, job);

    const result = await review.confirmPlace(OWNER_A, place.id, CTX);
    expect(result.reviewStatus).toBe("CONFIRMED");
    expect(result.isUserConfirmed).toBe(true);
    const audit = await prisma.placeEvidence.findFirstOrThrow({ where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" } });
    expect(audit.excerpt).toBe("manual review");
    expect(audit.metadata).toMatchObject({ action: "PLACE_CONFIRMED", actorType: "USER", actorId: "local-admin" });
    expect(audit.analysisJobId).toBe(job);
  });

  it("rejects a place durably so automatic re-analysis cannot overwrite it", async () => {
    const place = await seedPlace(OWNER_A);
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, place.id, job);
    await seedEvidence(OWNER_A, post, place.id, job);

    const result = await review.rejectPlaceResult(OWNER_A, place.id, CTX);
    expect(result.reviewStatus).toBe("REJECTED");
    expect(result.isUserConfirmed).toBe(true); // durable: F2 will not treat it as an unconfirmed automatic result
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(1);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" } })).toBe(1);
    // The original CAPTION evidence is kept too.
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "CAPTION" } })).toBe(1);
  });

  it("records a user correction with actor metadata and makes the link the single primary", async () => {
    const place = await seedPlace(OWNER_A);
    const other = await seedPlace(OWNER_A, "geo-other");
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, other.id, job, true); // existing primary
    await linkPostPlace(OWNER_A, post, place.id, job, false);

    const updated = await review.correctPostPlace(
      OWNER_A,
      { postId: post, placeId: place.id, isPrimary: true },
      { actor: { type: "ADMIN", id: "admin-7" }, reason: "user picked this" },
    );
    expect(updated.isUserConfirmed).toBe(true);
    expect(updated.isPrimary).toBe(true);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, postId: post, isPrimary: true } })).toBe(1);
    const audit = await prisma.placeEvidence.findFirstOrThrow({ where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" } });
    expect(audit.excerpt).toBe("user picked this");
    expect(audit.metadata).toMatchObject({ action: "POST_PLACE_CORRECTED", actorType: "ADMIN", actorId: "admin-7" });
  });

  it("rejects an invalid actor or reason with a stable code and never leaks them", async () => {
    const place = await seedPlace(OWNER_A);
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, place.id, job);

    // Empty reason, oversized reason, empty actor id, and unknown actor type.
    await expect(review.confirmPlace(OWNER_A, place.id, { actor: CTX.actor, reason: "" })).rejects.toMatchObject({ code: "INVALID_REVIEW_CONTEXT" });
    await expect(review.confirmPlace(OWNER_A, place.id, { actor: CTX.actor, reason: "x".repeat(501) })).rejects.toMatchObject({ code: "INVALID_REVIEW_CONTEXT" });
    await expect(review.confirmPlace(OWNER_A, place.id, { actor: { type: "USER", id: "" }, reason: "ok" })).rejects.toMatchObject({ code: "INVALID_REVIEW_CONTEXT" });
    await expect(review.confirmPlace(OWNER_A, place.id, { actor: { type: "HACKER", id: "x" }, reason: "ok" })).rejects.toMatchObject({ code: "INVALID_REVIEW_CONTEXT" });

    // The actor and reason never appear in the thrown error.
    try {
      await review.confirmPlace(OWNER_A, place.id, { actor: { type: "HACKER", id: "SECRET-ACTOR" }, reason: "SECRET-REASON-123" });
      throw new Error("expected a review error");
    } catch (error) {
      const serialized = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
      expect(serialized).not.toContain("SECRET-REASON-123");
      expect(serialized).not.toContain("SECRET-ACTOR");
    }
    // No mutation happened.
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).reviewStatus).toBe("UNREVIEWED");
  });

  it("fails before mutating when no post/job audit context exists", async () => {
    const place = await seedPlace(OWNER_A); // no links, no jobs
    await expect(review.confirmPlace(OWNER_A, place.id, CTX)).rejects.toMatchObject({ code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING" });
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).reviewStatus).toBe("UNREVIEWED");
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("rolls back the mutation when audit evidence creation fails", async () => {
    const place = await seedPlace(OWNER_A);
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, place.id, job);

    const spy = vi.spyOn(reviewActor, "buildAuditMetadata").mockImplementationOnce(() => {
      throw new Error("injected audit failure");
    });
    try {
      await expect(review.confirmPlace(OWNER_A, place.id, CTX)).rejects.toThrow("injected audit failure");
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).reviewStatus).toBe("UNREVIEWED");
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" } })).toBe(0);
  });

  it("refuses to confirm, reject, or correct another owner's data without creating audit", async () => {
    const place = await seedPlace(OWNER_A);
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, place.id, job);

    await expect(review.confirmPlace(OWNER_B, place.id, CTX)).rejects.toMatchObject({ code: "PLACE_NOT_FOUND" });
    await expect(review.rejectPlaceResult(OWNER_B, place.id, CTX)).rejects.toMatchObject({ code: "PLACE_NOT_FOUND" });
    await expect(review.correctPostPlace(OWNER_B, { postId: "nope", placeId: place.id }, CTX)).rejects.toMatchObject({ code: "POST_PLACE_NOT_FOUND" });
    expect(await prisma.placeEvidence.count({ where: { ownerId: { in: [OWNER_A, OWNER_B] }, evidenceType: "USER_CORRECTION" } })).toBe(0);
  });

  it("merges a place into another, deduplicating links, keeping one primary, and auditing", async () => {
    const source = await seedPlace(OWNER_A, "geo-source");
    const target = await seedPlace(OWNER_A, "geo-target");
    const sharedPost = await seedPost(OWNER_A);
    const onlySourcePost = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, sharedPost);
    const job2 = await seedJob(OWNER_A, onlySourcePost);
    await linkPostPlace(OWNER_A, sharedPost, target.id, job, true);
    await linkPostPlace(OWNER_A, sharedPost, source.id, job, false);
    await linkPostPlace(OWNER_A, onlySourcePost, source.id, job2, true);
    await seedEvidence(OWNER_A, sharedPost, source.id, job);

    const result = await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    expect(result.id).toBe(target.id);
    expect(await prisma.place.count({ where: { id: source.id } })).toBe(0);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, postId: sharedPost } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, postId: onlySourcePost, placeId: target.id } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, postId: sharedPost, isPrimary: true } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, postId: onlySourcePost, isPrimary: true } })).toBe(1);
    // The moved CAPTION evidence is re-pointed to the target, not lost.
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, placeId: target.id, evidenceType: "CAPTION" } })).toBe(1);
    // Merge audit evidence is owner/place/post/job scoped to the target.
    const audits = await prisma.placeEvidence.findMany({ where: { ownerId: OWNER_A, placeId: target.id, evidenceType: "USER_CORRECTION" } });
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits) {
      expect(audit.metadata).toMatchObject({ action: "PLACES_MERGED", actorType: "USER" });
      expect([sharedPost, onlySourcePost]).toContain(audit.postId);
      expect(audit.analysisJobId).toBeTruthy();
    }
  });

  it("preserves a user correction when merging", async () => {
    const source = await seedPlace(OWNER_A, "geo-s2");
    const target = await seedPlace(OWNER_A, "geo-t2");
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, target.id, job, true, false);
    await linkPostPlace(OWNER_A, post, source.id, job, false, true); // user-confirmed on source

    await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    const link = await prisma.postPlace.findFirstOrThrow({ where: { ownerId: OWNER_A, postId: post } });
    expect(link.placeId).toBe(target.id);
    expect(link.isUserConfirmed).toBe(true);
  });

  it("refuses a cross-owner or self merge", async () => {
    const a = await seedPlace(OWNER_A, "geo-a");
    const b = await seedPlace(OWNER_B, "geo-b");
    await expect(review.mergePlaces(OWNER_A, { sourcePlaceId: a.id, targetPlaceId: b.id }, CTX)).rejects.toMatchObject({ code: "PLACE_NOT_FOUND" });
    await expect(review.mergePlaces(OWNER_A, { sourcePlaceId: a.id, targetPlaceId: a.id }, CTX)).rejects.toMatchObject({ code: "INVALID_MERGE" });
  });

  it("carries a confirmed source review state onto an unreviewed target (F2 protection)", async () => {
    const source = await seedPlaceState(OWNER_A, "CONFIRMED", true, "geo-src-1");
    const target = await seedPlaceState(OWNER_A, "UNREVIEWED", false, "geo-tgt-1");
    await linkAuditableSource(source.id); // a valid audit context lets the merge proceed

    const result = await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    expect(result.reviewStatus).toBe("CONFIRMED");
    expect(result.isUserConfirmed).toBe(true); // F2 automatic re-analysis can no longer overwrite it
    expect(await prisma.place.count({ where: { id: source.id } })).toBe(0);
  });

  it("keeps an already-confirmed target confirmed", async () => {
    const source = await seedPlaceState(OWNER_A, "UNREVIEWED", false, "geo-src-2");
    const target = await seedPlaceState(OWNER_A, "CONFIRMED", true, "geo-tgt-2");
    await linkAuditableSource(source.id);
    const result = await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    expect(result).toMatchObject({ reviewStatus: "CONFIRMED", isUserConfirmed: true });
  });

  it("keeps CONFIRMED when both sides are confirmed", async () => {
    const source = await seedPlaceState(OWNER_A, "CONFIRMED", true, "geo-src-3");
    const target = await seedPlaceState(OWNER_A, "CONFIRMED", true, "geo-tgt-3");
    await linkAuditableSource(source.id);
    const result = await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    expect(result).toMatchObject({ reviewStatus: "CONFIRMED", isUserConfirmed: true });
  });

  it("resolves a confirmation-versus-rejection to CONFLICT while keeping the confirmation", async () => {
    const source = await seedPlaceState(OWNER_A, "CONFIRMED", true, "geo-src-4");
    const target = await seedPlaceState(OWNER_A, "REJECTED", false, "geo-tgt-4");
    await linkAuditableSource(source.id);
    const result = await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    expect(result).toMatchObject({ reviewStatus: "CONFLICT", isUserConfirmed: true });
  });

  it("never downgrades an existing CONFLICT to UNREVIEWED", async () => {
    const source = await seedPlaceState(OWNER_A, "CONFLICT", false, "geo-src-5");
    const target = await seedPlaceState(OWNER_A, "UNREVIEWED", false, "geo-tgt-5");
    await linkAuditableSource(source.id);
    const result = await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    expect(result.reviewStatus).toBe("CONFLICT");
  });

  it("lets a rejection dominate an unreviewed target when no confirmation exists", async () => {
    const source = await seedPlaceState(OWNER_A, "REJECTED", false, "geo-src-6");
    const target = await seedPlaceState(OWNER_A, "UNREVIEWED", false, "geo-tgt-6");
    await linkAuditableSource(source.id);
    const result = await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    expect(result).toMatchObject({ reviewStatus: "REJECTED", isUserConfirmed: false });
  });

  it("rolls back completely when the merge fails mid-transaction", async () => {
    const source = await seedPlaceState(OWNER_A, "CONFIRMED", true, "geo-src-7");
    const target = await seedPlaceState(OWNER_A, "UNREVIEWED", false, "geo-tgt-7");
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await linkPostPlace(OWNER_A, post, source.id, job, true);
    await seedEvidence(OWNER_A, post, source.id, job);

    // Inject a failure at the review-state resolution step, after links and
    // evidence have been moved inside the transaction.
    const spy = vi.spyOn(mergeState, "resolveMergedPlaceReviewState").mockImplementationOnce(() => {
      throw new Error("injected merge failure");
    });
    try {
      await expect(
        review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX),
      ).rejects.toThrow("injected merge failure");
    } finally {
      spy.mockRestore();
    }

    // Nothing changed: source present, target untouched, links and evidence on source.
    expect(await prisma.place.count({ where: { id: source.id } })).toBe(1);
    const targetAfter = await prisma.place.findUniqueOrThrow({ where: { id: target.id } });
    expect(targetAfter.reviewStatus).toBe("UNREVIEWED");
    expect(targetAfter.isUserConfirmed).toBe(false);
    const link = await prisma.postPlace.findFirstOrThrow({ where: { ownerId: OWNER_A, postId: post } });
    expect(link.placeId).toBe(source.id);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, placeId: source.id } })).toBe(1);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, placeId: target.id } })).toBe(0);
  });

  // --- Complete audit context (Problems 1, 2 and 3) ---

  it("refuses to confirm a place when any linked post has no auditable job context", async () => {
    const place = await seedPlace(OWNER_A);
    const auditablePost = await seedPost(OWNER_A);
    const auditableJob = await seedJob(OWNER_A, auditablePost);
    await linkPostPlace(OWNER_A, auditablePost, place.id, auditableJob);
    const orphanPost = await seedPost(OWNER_A); // link without a job and no job at all
    await linkPostPlaceWithoutJob(OWNER_A, orphanPost, place.id);

    await expect(review.confirmPlace(OWNER_A, place.id, CTX)).rejects.toMatchObject({
      code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING",
    });
    // No partial audit and no state change: the auditable post is not confirmed alone.
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).reviewStatus).toBe("UNREVIEWED");
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("refuses to reject a place when any linked post has no auditable job context", async () => {
    const place = await seedPlace(OWNER_A);
    const auditablePost = await seedPost(OWNER_A);
    const auditableJob = await seedJob(OWNER_A, auditablePost);
    await linkPostPlace(OWNER_A, auditablePost, place.id, auditableJob);
    const orphanPost = await seedPost(OWNER_A);
    await linkPostPlaceWithoutJob(OWNER_A, orphanPost, place.id);

    await expect(review.rejectPlaceResult(OWNER_A, place.id, CTX)).rejects.toMatchObject({
      code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING",
    });
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).reviewStatus).toBe("UNREVIEWED");
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" } })).toBe(0);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A } })).toBe(2); // links intact
  });

  it("confirms a multi-post place with exactly one audit per post, using the latest job as fallback", async () => {
    const place = await seedPlace(OWNER_A);
    const postWithLinkJob = await seedPost(OWNER_A);
    const linkJob = await seedJob(OWNER_A, postWithLinkJob);
    await linkPostPlace(OWNER_A, postWithLinkJob, place.id, linkJob);
    // Second post: the link carries no job, but a latest owner-scoped job exists.
    const postWithLatestJob = await seedPost(OWNER_A);
    const latestJob = await seedJob(OWNER_A, postWithLatestJob);
    await linkPostPlaceWithoutJob(OWNER_A, postWithLatestJob, place.id);

    const result = await review.confirmPlace(OWNER_A, place.id, CTX);
    expect(result.reviewStatus).toBe("CONFIRMED");
    const audits = await prisma.placeEvidence.findMany({
      where: { ownerId: OWNER_A, placeId: place.id, evidenceType: "USER_CORRECTION" },
    });
    // One audit per distinct affected post, each bound to its resolved job.
    expect(audits.length).toBe(2);
    const jobByPost = new Map(audits.map((audit) => [audit.postId, audit.analysisJobId]));
    expect(jobByPost.get(postWithLinkJob)).toBe(linkJob);
    expect(jobByPost.get(postWithLatestJob)).toBe(latestJob);
  });

  it("refuses a merge when any affected post has no auditable job context and writes nothing", async () => {
    const source = await seedPlace(OWNER_A, "geo-partial-src");
    const target = await seedPlace(OWNER_A, "geo-partial-tgt");
    const auditablePost = await seedPost(OWNER_A);
    const auditableJob = await seedJob(OWNER_A, auditablePost);
    await linkPostPlace(OWNER_A, auditablePost, source.id, auditableJob, true);
    const orphanPost = await seedPost(OWNER_A); // link without a job and no job at all
    await linkPostPlaceWithoutJob(OWNER_A, orphanPost, source.id);
    await seedEvidence(OWNER_A, auditablePost, source.id, auditableJob);

    await expect(
      review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX),
    ).rejects.toMatchObject({ code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING" });

    // Nothing moved, deleted or audited: no partially-auditable merge.
    expect(await prisma.place.count({ where: { id: source.id } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, placeId: source.id } })).toBe(2);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, placeId: target.id } })).toBe(0);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" } })).toBe(0);
    expect(
      await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, placeId: source.id, evidenceType: "CAPTION" } }),
    ).toBe(1);
  });

  it("audits a merge with exactly one evidence per affected post", async () => {
    const source = await seedPlace(OWNER_A, "geo-full-src");
    const target = await seedPlace(OWNER_A, "geo-full-tgt");
    const postA = await seedPost(OWNER_A);
    const jobA = await seedJob(OWNER_A, postA);
    const postB = await seedPost(OWNER_A);
    const jobB = await seedJob(OWNER_A, postB);
    await linkPostPlace(OWNER_A, postA, source.id, jobA, true);
    await linkPostPlace(OWNER_A, postB, source.id, jobB, true);

    await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    const audits = await prisma.placeEvidence.findMany({
      where: { ownerId: OWNER_A, placeId: target.id, evidenceType: "USER_CORRECTION" },
    });
    expect(audits.length).toBe(2); // one per distinct affected post, not one for the whole merge
    const jobByPost = new Map(audits.map((audit) => [audit.postId, audit.analysisJobId]));
    expect(jobByPost.get(postA)).toBe(jobA);
    expect(jobByPost.get(postB)).toBe(jobB);
    for (const audit of audits) expect(audit.metadata).toMatchObject({ action: "PLACES_MERGED" });
  });

  it("refuses a merge when the source place has no links to audit", async () => {
    const source = await seedPlace(OWNER_A, "geo-linkless-src");
    const target = await seedPlace(OWNER_A, "geo-linkless-tgt");

    await expect(
      review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX),
    ).rejects.toMatchObject({ code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING" });

    // A link-free merge is refused before any write: the source survives untouched.
    expect(await prisma.place.count({ where: { id: source.id } })).toBe(1);
    expect(await prisma.place.count({ where: { id: target.id } })).toBe(1);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("refuses a link-free merge even when stray evidence exists on the source", async () => {
    const source = await seedPlace(OWNER_A, "geo-orphan-src");
    const target = await seedPlace(OWNER_A, "geo-orphan-tgt");
    const post = await seedPost(OWNER_A);
    const job = await seedJob(OWNER_A, post);
    await seedEvidence(OWNER_A, post, source.id, job); // evidence but no PostPlace link

    await expect(
      review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX),
    ).rejects.toMatchObject({ code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING" });

    // Stray evidence is not a link-level audit context: nothing is moved or deleted.
    expect(await prisma.place.count({ where: { id: source.id } })).toBe(1);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, placeId: source.id } })).toBe(1);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, placeId: target.id } })).toBe(0);
  });

  it("audits a merge for a link without its own job by falling back to the latest job", async () => {
    const source = await seedPlace(OWNER_A, "geo-fallback-src");
    const target = await seedPlace(OWNER_A, "geo-fallback-tgt");
    const post = await seedPost(OWNER_A);
    const latestJob = await seedJob(OWNER_A, post);
    await linkPostPlaceWithoutJob(OWNER_A, post, source.id, true); // link carries no job

    await review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX);
    const audit = await prisma.placeEvidence.findFirstOrThrow({
      where: { ownerId: OWNER_A, placeId: target.id, evidenceType: "USER_CORRECTION" },
    });
    expect(audit.postId).toBe(post);
    expect(audit.analysisJobId).toBe(latestJob);
    expect(audit.metadata).toMatchObject({ action: "PLACES_MERGED" });
  });

  // --- Audit job ownership isolation (link-carried job must match owner + post) ---

  it("ignores a cross-owner link job and refuses when no valid fallback exists", async () => {
    const place = await seedPlace(OWNER_A);
    const postA = await seedPost(OWNER_A);
    await linkPostPlaceWithoutJob(OWNER_A, postA, place.id);
    // A job owned by OWNER_B; the composite FK normally forbids referencing it.
    const otherPost = await seedPost(OWNER_B);
    const crossOwnerJob = await seedJob(OWNER_B, otherPost);
    await breakLinkJob(OWNER_A, postA, place.id, crossOwnerJob);

    await expect(review.confirmPlace(OWNER_A, place.id, CTX)).rejects.toMatchObject({
      code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING",
    });
    expect((await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).reviewStatus).toBe("UNREVIEWED");
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("ignores a cross-post link job and refuses when no valid fallback exists", async () => {
    const place = await seedPlace(OWNER_A);
    const postA = await seedPost(OWNER_A);
    const postB = await seedPost(OWNER_A);
    const jobB = await seedJob(OWNER_A, postB); // a real job, but for another post
    await linkPostPlaceWithoutJob(OWNER_A, postA, place.id);
    await breakLinkJob(OWNER_A, postA, place.id, jobB);

    await expect(review.confirmPlace(OWNER_A, place.id, CTX)).rejects.toMatchObject({
      code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING",
    });
    // post B's job must never become post A's audit context.
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("falls back to a valid owner/post job when the link job is cross-owner", async () => {
    const place = await seedPlace(OWNER_A);
    const postA = await seedPost(OWNER_A);
    const validJob = await seedJob(OWNER_A, postA); // valid fallback for post A
    await linkPostPlaceWithoutJob(OWNER_A, postA, place.id);
    const otherPost = await seedPost(OWNER_B);
    const crossOwnerJob = await seedJob(OWNER_B, otherPost);
    await breakLinkJob(OWNER_A, postA, place.id, crossOwnerJob);

    const result = await review.confirmPlace(OWNER_A, place.id, CTX);
    expect(result.reviewStatus).toBe("CONFIRMED");
    const audit = await prisma.placeEvidence.findFirstOrThrow({
      where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" },
    });
    expect(audit.analysisJobId).toBe(validJob); // never the cross-owner job
  });

  it("falls back to a valid owner/post job when the link job belongs to another post", async () => {
    const place = await seedPlace(OWNER_A);
    const postA = await seedPost(OWNER_A);
    const validJob = await seedJob(OWNER_A, postA); // valid fallback for post A
    const postB = await seedPost(OWNER_A);
    const jobB = await seedJob(OWNER_A, postB);
    await linkPostPlaceWithoutJob(OWNER_A, postA, place.id);
    await breakLinkJob(OWNER_A, postA, place.id, jobB);

    const result = await review.confirmPlace(OWNER_A, place.id, CTX);
    expect(result.reviewStatus).toBe("CONFIRMED");
    const audit = await prisma.placeEvidence.findFirstOrThrow({
      where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" },
    });
    expect(audit.analysisJobId).toBe(validJob); // never post B's job
  });

  it("refuses a merge when an affected post's only job is a cross-owner link job", async () => {
    const source = await seedPlace(OWNER_A, "geo-iso-src");
    const target = await seedPlace(OWNER_A, "geo-iso-tgt");
    const postA = await seedPost(OWNER_A);
    const jobA = await seedJob(OWNER_A, postA);
    await linkPostPlace(OWNER_A, postA, source.id, jobA, true); // valid
    const postB = await seedPost(OWNER_A);
    await linkPostPlaceWithoutJob(OWNER_A, postB, source.id);
    const otherPost = await seedPost(OWNER_B);
    const crossOwnerJob = await seedJob(OWNER_B, otherPost);
    await breakLinkJob(OWNER_A, postB, source.id, crossOwnerJob); // post B has no valid context
    await seedEvidence(OWNER_A, postA, source.id, jobA);

    await expect(
      review.mergePlaces(OWNER_A, { sourcePlaceId: source.id, targetPlaceId: target.id }, CTX),
    ).rejects.toMatchObject({ code: "PLACE_REVIEW_AUDIT_CONTEXT_MISSING" });

    // Nothing moved, deleted or audited.
    expect(await prisma.place.count({ where: { id: source.id } })).toBe(1);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, placeId: source.id } })).toBe(2);
    expect(await prisma.postPlace.count({ where: { ownerId: OWNER_A, placeId: target.id } })).toBe(0);
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" } })).toBe(0);
    expect(
      await prisma.placeEvidence.count({ where: { ownerId: OWNER_A, placeId: source.id, evidenceType: "CAPTION" } }),
    ).toBe(1);
  });

  it("never leaks a job, post, or owner id when refusing on an invalid link job", async () => {
    const place = await seedPlace(OWNER_A);
    const postA = await seedPost(OWNER_A);
    await linkPostPlaceWithoutJob(OWNER_A, postA, place.id);
    const otherPost = await seedPost(OWNER_B);
    const crossOwnerJob = await prisma.placeAnalysisJob.create({
      data: {
        id: "SECRET-JOB-ID",
        ownerId: OWNER_B,
        postId: otherPost,
        sourceTheme: "Voyages",
        analysisVersion: "places-v1",
        inputHash: "rh-secret",
      },
      select: { id: true },
    });
    await breakLinkJob(OWNER_A, postA, place.id, crossOwnerJob.id);

    try {
      await review.confirmPlace(OWNER_A, place.id, CTX);
      throw new Error("expected a review error");
    } catch (error) {
      const serialized = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
      expect(serialized).toContain("PLACE_REVIEW_AUDIT_CONTEXT_MISSING");
      expect(serialized).not.toContain("SECRET-JOB-ID"); // job id
      expect(serialized).not.toContain(postA); // post id
      expect(serialized).not.toContain(OWNER_A); // owner id
    }
    expect(await prisma.placeEvidence.count({ where: { ownerId: OWNER_A } })).toBe(0);
  });

  it("prefers a valid direct link job over the latest fallback and creates one evidence", async () => {
    const place = await seedPlace(OWNER_A);
    const postA = await seedPost(OWNER_A);
    const directJob = await seedJob(OWNER_A, postA); // carried by the link
    await seedJob(OWNER_A, postA); // a newer latest job for the same post
    await linkPostPlace(OWNER_A, postA, place.id, directJob);

    const result = await review.confirmPlace(OWNER_A, place.id, CTX);
    expect(result.reviewStatus).toBe("CONFIRMED");
    const audits = await prisma.placeEvidence.findMany({
      where: { ownerId: OWNER_A, evidenceType: "USER_CORRECTION" },
    });
    // Deterministic: the valid direct link job wins over a newer latest job, and a
    // single post yields exactly one evidence row.
    expect(audits.length).toBe(1);
    expect(audits[0].analysisJobId).toBe(directJob);
  });
});

let placeCounter = 0;
let postCounter = 0;
let jobCounter = 0;

async function seedPlace(ownerId: string, providerPlaceId?: string) {
  placeCounter += 1;
  return prisma.place.create({
    data: {
      ownerId,
      displayName: "Place",
      normalizedName: "place",
      provider: "geoapify",
      providerPlaceId: providerPlaceId ?? `geo-${placeCounter}`,
      latitude: 25.1,
      longitude: 55.1,
      precision: "EXACT",
      confidence: 0.9,
    },
  });
}

async function seedPlaceState(
  ownerId: string,
  reviewStatus: "UNREVIEWED" | "CONFIRMED" | "REJECTED" | "CONFLICT",
  isUserConfirmed: boolean,
  providerPlaceId: string,
) {
  return prisma.place.create({
    data: {
      ownerId,
      displayName: "Place",
      normalizedName: "place",
      provider: "geoapify",
      providerPlaceId,
      latitude: 25.1,
      longitude: 55.1,
      precision: "EXACT",
      confidence: 0.9,
      reviewStatus,
      isUserConfirmed,
    },
  });
}

async function seedPost(ownerId: string): Promise<string> {
  postCounter += 1;
  const post = await prisma.post.create({
    data: {
      ownerId,
      postUrl: `https://instagram.com/p/PR${postCounter}`,
      thumbnailUrl: "https://example.com/t.jpg",
      authorUsername: "alice",
      authorSortKey: "alice",
      caption: "A trip",
      searchText: "alice trip",
      contentType: "IMAGE",
      mainTheme: "Voyages",
    },
    select: { id: true },
  });
  return post.id;
}

async function seedJob(ownerId: string, postId: string): Promise<string> {
  jobCounter += 1;
  const job = await prisma.placeAnalysisJob.create({
    data: { ownerId, postId, sourceTheme: "Voyages", analysisVersion: "places-v1", inputHash: `rh-${jobCounter}` },
    select: { id: true },
  });
  return job.id;
}

async function linkPostPlace(
  ownerId: string,
  postId: string,
  placeId: string,
  analysisJobId: string,
  isPrimary = false,
  isUserConfirmed = false,
): Promise<void> {
  await prisma.postPlace.create({
    data: { ownerId, postId, placeId, analysisJobId, isPrimary, isUserConfirmed, precision: "EXACT", confidence: 0.9 },
  });
}

// Give a source place a single fully-auditable link (post + job) so a merge that
// exercises only the review-state policy still has a valid audit context.
async function linkAuditableSource(placeId: string): Promise<void> {
  const post = await seedPost(OWNER_A);
  const job = await seedJob(OWNER_A, post);
  await linkPostPlace(OWNER_A, post, placeId, job, true);
}

// Force an existing link to reference a job that violates owner/post consistency,
// simulating a legacy/incoherent row that predates the composite owner/post FK.
// The real schema forbids inserting such a row, so a superuser-only FK bypass is
// used for a single transaction. The resolver must ignore the invalid direct job.
async function breakLinkJob(ownerId: string, postId: string, placeId: string, brokenJobId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.$executeRawUnsafe(
      "UPDATE post_places SET analysis_job_id = $1 WHERE owner_id = $2 AND post_id = $3 AND place_id = $4",
      brokenJobId,
      ownerId,
      postId,
      placeId,
    );
  });
}

// A link whose analysis job is unknown (analysisJobId stays null): its audit
// context must be resolved from the latest owner-scoped job, or refused.
async function linkPostPlaceWithoutJob(
  ownerId: string,
  postId: string,
  placeId: string,
  isPrimary = false,
  isUserConfirmed = false,
): Promise<void> {
  await prisma.postPlace.create({
    data: { ownerId, postId, placeId, isPrimary, isUserConfirmed, precision: "EXACT", confidence: 0.9 },
  });
}

async function seedEvidence(ownerId: string, postId: string, placeId: string, analysisJobId: string): Promise<void> {
  await prisma.placeEvidence.create({
    data: { ownerId, postId, placeId, analysisJobId, evidenceType: "CAPTION", excerpt: "snippet", confidence: 0.8 },
  });
}

async function resetDatabase(): Promise<void> {
  const owners = { ownerId: { in: [OWNER_A, OWNER_B] } };
  await prisma.post.deleteMany({ where: owners });
  await prisma.place.deleteMany({ where: owners });
}
