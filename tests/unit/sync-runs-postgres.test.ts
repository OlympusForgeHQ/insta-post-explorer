// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const ownerId = `sync-runs-${randomUUID()}`;
const otherOwner = `${ownerId}-other`;
let prisma: PrismaClient;
let createSession: typeof import("@/server/create-sync-session").createSyncSession;
let runs: typeof import("@/server/sync-runs");
let importPosts: typeof import("@/server/import-posts").importPosts;
let automation: typeof import("@/auth/sync-automation");
const input = () => ({ ownerId, apiBaseUrl: "https://example.test" });
const claims = (id: string) => ({ sub: id, ownerId });

(databaseUrl ? describe : describe.skip)("exclusive sync runs on PostgreSQL", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", databaseUrl!);
    ({ prisma } = await import("@/server/db"));
    ({ createSyncSession: createSession } = await import("@/server/create-sync-session"));
    runs = await import("@/server/sync-runs");
    ({ importPosts } = await import("@/server/import-posts"));
    automation = await import("@/auth/sync-automation");
  });
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "test-only-auth-secret-with-at-least-32-characters");
    vi.stubEnv("ADMIN_PASSWORD_HASH", `$2b$12$${"A".repeat(53)}`);
    vi.stubEnv("AUTH_DISABLED", "false");
    vi.stubEnv("APP_OWNER_ID", ownerId);
    vi.stubEnv("INSTAGRAM_AUTO_SYNC_ENABLED", "1");
    vi.stubEnv("INSTAGRAM_AUTO_SYNC_KEY_SHA256", createHash("sha256").update("synthetic-automation-key").digest("hex"));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  });
  afterEach(async () => {
    const where = { ownerId: { in: [ownerId, otherOwner] } };
    await prisma.syncJob.deleteMany({ where });
    await prisma.importJob.deleteMany({ where });
    await prisma.post.deleteMany({ where });
    await prisma.tag.deleteMany({ where });
  });
  afterAll(async () => { await prisma?.$disconnect(); vi.unstubAllEnvs(); });

  it("admits only one simultaneous manual/automatic run for an owner", async () => {
    const keyId = automation.getSyncAutomationConfiguration().keyId;
    const results = await Promise.allSettled([
      createSession(input()), createSession({ ...input(), automationKeyId: keyId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const denied = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(denied.reason.message).toBe("SYNC_IN_PROGRESS");
    await expect(createSession({ ...input(), ownerId: otherOwner })).resolves.toHaveProperty("jobId");
  });

  it("renews a lease, reclaims an expired run, and fences every obsolete write", async () => {
    const first = await createSession(input());
    await prisma.syncJob.update({ where: { id: first.jobId }, data: { leaseExpiresAt: new Date(Date.now() + 1000) } });
    await runs.heartbeatSyncJob(claims(first.jobId));
    const renewed = await prisma.syncJob.findUniqueOrThrow({ where: { id: first.jobId } });
    expect(renewed.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 240_000);
    await prisma.syncJob.update({ where: { id: first.jobId }, data: { leaseExpiresAt: new Date(0) } });
    const next = await createSession(input());
    await expect(runs.withActiveSyncJob(claims(first.jobId), async (tx) => {
      await tx.syncJob.update({ where: { id: first.jobId }, data: { collected: 999 } });
    })).rejects.toThrow("SYNC_UNAUTHORIZED");
    expect(await prisma.syncJob.findUniqueOrThrow({ where: { id: first.jobId } })).toMatchObject({ status: "FAILED", collected: 0 });
    await runs.completeSyncJob(claims(next.jobId), { status: "completed", mediaFailed: 2 });
    await runs.completeSyncJob(claims(next.jobId), { status: "completed", mediaFailed: 2 });
    expect(await runs.getSyncJobStatus(claims(next.jobId))).toMatchObject({ status: "COMPLETED", mediaFailed: 2 });
  });

  it("rolls back imported posts and their import job with the enclosing sync mutation", async () => {
    const session = await createSession(input());
    await expect(runs.withActiveSyncJob(claims(session.jobId), async (tx) => {
      await importPosts([{
        post_url: "https://www.instagram.com/p/ROLLBACK/", username: "test", caption: "test",
        thumbnail_url: "https://example.test/image.jpg", content_type: "image",
      }], { ownerId, sourceName: "sync-test", batchSize: 1 }, tx);
      throw new Error("test-after-import-failure");
    })).rejects.toThrow("test-after-import-failure");
    expect(await prisma.post.count({ where: { ownerId } })).toBe(0);
    expect(await prisma.importJob.count({ where: { ownerId } })).toBe(0);
  });

  it("allows bounded retries but no second successful automatic run in one local day", async () => {
    const automaticInput = { ...input(), automationKeyId: automation.getSyncAutomationConfiguration().keyId };
    for (let attempt = 0; attempt < 3; attempt++) {
      const session = await createSession(automaticInput);
      await runs.completeSyncJob(claims(session.jobId), { status: "failed", mediaFailed: 0 });
    }
    await expect(createSession(automaticInput)).rejects.toThrow("SYNC_DAILY_LIMIT");
    const manual = await createSession(input());
    await runs.completeSyncJob(claims(manual.jobId), { status: "completed", mediaFailed: 0 });
    await prisma.syncJob.updateMany({ where: { ownerId, automationDay: { not: null } }, data: { status: "COMPLETED" } });
    await expect(createSession(automaticInput)).rejects.toThrow("SYNC_ALREADY_COMPLETED");
  });
});
