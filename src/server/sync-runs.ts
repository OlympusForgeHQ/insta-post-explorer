import "server-only";

import type { Prisma, SyncJob } from "@prisma/client";
import { prisma } from "@/server/db";

export const SYNC_LEASE_MS = 300_000;
export const SYNC_HEARTBEAT_SECONDS = 30;
type Claims = { sub: string; ownerId: string };
type Transaction = Prisma.TransactionClient;

export class SyncAdmissionError extends Error {
  constructor(public readonly code: "SYNC_IN_PROGRESS" | "SYNC_ALREADY_COMPLETED" | "SYNC_DAILY_LIMIT") {
    super(code);
    this.name = "SyncAdmissionError";
  }
}

export function withSyncOwnerLock<T>(ownerId: string, operation: (tx: Transaction) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Hash collisions only serialize unrelated owners; ownership is checked separately.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`instagram-sync:${ownerId}`}, 0))::text`;
    return operation(tx);
  }, { maxWait: 5000, timeout: 20_000 });
}

export function syncRunIsActive(job: SyncJob, now = Date.now()) {
  const legacyExpiry = job.startedAt.getTime() + 86_400_000;
  return (job.status === "PENDING" || job.status === "RUNNING") &&
    (job.runExpiresAt?.getTime() ?? legacyExpiry) > now &&
    (job.leaseExpiresAt?.getTime() ?? legacyExpiry) > now;
}

export async function admitSyncRun(tx: Transaction, ownerId: string, automationDay: string | null) {
  const active = await tx.syncJob.findMany({ where: { ownerId, status: { in: ["PENDING", "RUNNING"] } } });
  if (active.some((job) => syncRunIsActive(job))) throw new SyncAdmissionError("SYNC_IN_PROGRESS");
  if (active.length) {
    await tx.syncJob.updateMany({
      where: { ownerId, id: { in: active.map((job) => job.id) } },
      data: { status: "FAILED", errorCode: "SYNC_LEASE_EXPIRED", finishedAt: new Date() },
    });
  }
  if (automationDay) {
    const attempts = await tx.syncJob.findMany({ where: { ownerId, automationDay }, select: { status: true } });
    if (attempts.some((job) => job.status === "COMPLETED")) throw new SyncAdmissionError("SYNC_ALREADY_COMPLETED");
    if (attempts.length >= 3) throw new SyncAdmissionError("SYNC_DAILY_LIMIT");
  }
}

export function withActiveSyncJob<T>(claims: Claims, operation: (tx: Transaction, job: SyncJob) => Promise<T>) {
  return withSyncOwnerLock(claims.ownerId, async (tx) => {
    const job = await tx.syncJob.findFirst({ where: { id: claims.sub, ownerId: claims.ownerId } });
    if (!job || !syncRunIsActive(job)) throw new Error("SYNC_UNAUTHORIZED");
    return operation(tx, job);
  });
}

export async function heartbeatSyncJob(claims: Claims) {
  await withActiveSyncJob(claims, async (tx, job) => {
    await tx.syncJob.update({ where: { id: job.id }, data: {
      leaseExpiresAt: new Date(Math.min(Date.now() + SYNC_LEASE_MS, job.runExpiresAt?.getTime() ?? job.startedAt.getTime() + 86_400_000)),
    } });
  });
}

export async function getSyncJobStatus(claims: Claims) {
  const job = await prisma.syncJob.findFirst({ where: { id: claims.sub, ownerId: claims.ownerId }, select: {
    id: true, status: true, collected: true, imported: true, updated: true, mediaFailed: true,
    errorCode: true, leaseExpiresAt: true,
  } });
  if (!job) throw new Error("SYNC_UNAUTHORIZED");
  return job;
}

export function completeSyncJob(claims: Claims, body: { status: "completed" | "failed"; error?: string | null; mediaFailed: number }) {
  return withSyncOwnerLock(claims.ownerId, async (tx) => {
    const job = await tx.syncJob.findFirst({ where: { id: claims.sub, ownerId: claims.ownerId } });
    if (!job) throw new Error("SYNC_UNAUTHORIZED");
    // Completion is idempotent, and late failures must not undo durable success.
    if (job.status === "COMPLETED" || job.status === "FAILED") return job.status;
    if (!syncRunIsActive(job)) throw new Error("SYNC_UNAUTHORIZED");
    const status = body.status === "completed" ? "COMPLETED" : "FAILED";
    await tx.syncJob.update({ where: { id: job.id }, data: {
      status, errorCode: body.error ?? null, mediaFailed: { increment: body.mediaFailed },
      heartbeatAt: new Date(), finishedAt: new Date(),
    } });
    return status;
  });
}
