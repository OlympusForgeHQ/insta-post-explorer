// @vitest-environment node

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const ownerId = `sync-test-${randomUUID()}`;
const otherOwnerId = `sync-test-${randomUUID()}`;
const previousDatabaseUrl = process.env.DATABASE_URL;
let prisma: PrismaClient;
let createSyncSession: typeof import("@/server/create-sync-session").createSyncSession;

describeWithDatabase("sync session persistence on PostgreSQL", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("@/server/db"));
    ({ createSyncSession } = await import("@/server/create-sync-session"));
  });
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "test-only-auth-secret-with-at-least-32-characters");
    vi.stubEnv("ADMIN_PASSWORD_HASH", `$2b$12$${"A".repeat(53)}`);
    vi.stubEnv("AUTH_DISABLED", "false");
    vi.stubEnv("APP_OWNER_ID", ownerId);
  });
  afterEach(async () => {
    await prisma.syncJob.deleteMany({ where: { ownerId: { in: [ownerId, otherOwnerId] } } });
    await prisma.post.deleteMany({ where: { ownerId: { in: [ownerId, otherOwnerId] } } });
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("persists the issued job and excludes another owner's paired identities", async () => {
    await prisma.post.createMany({ data: [
      { ownerId, externalId: "123", postUrl: "https://www.instagram.com/p/OWNED/" },
      { ownerId: otherOwnerId, externalId: "456", postUrl: "https://www.instagram.com/p/PRIVATE/" },
    ].map((identity) => ({
      ...identity, thumbnailUrl: "https://example.test/image.jpg", authorUsername: "test",
      authorSortKey: "test", caption: "test", searchText: "test",
    })) });
    const result = await createSyncSession({ ownerId, apiBaseUrl: "https://example.test" });
    expect(result.knownPosts).toEqual([{ externalId: "123", postCode: "OWNED" }]);
    expect(await prisma.syncJob.findUnique({ where: { id: result.jobId } })).toMatchObject({ ownerId, status: "PENDING" });
  });

  it("rolls back the newly inserted pending job when token signing configuration is invalid", async () => {
    vi.stubEnv("AUTH_SECRET", "invalid");
    await expect(createSyncSession({ ownerId, apiBaseUrl: "https://example.test" }))
      .rejects.toThrow("AUTH_CONFIGURATION_ERROR");
    expect(await prisma.syncJob.count({ where: { ownerId } })).toBe(0);
  });
});
