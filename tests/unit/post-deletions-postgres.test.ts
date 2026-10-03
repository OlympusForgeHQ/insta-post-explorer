// @vitest-environment node

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Only the external R2 HEAD request is replaced; reference validation and all
// sync/import/database writes use their real implementations.
vi.mock("@/server/r2", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/r2")>(),
  verifyR2Object: async () => ({ contentType: "image/jpeg", etag: "test-etag" }),
}));

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const ownerId = `deletion-${randomUUID()}`;
const otherOwner = `${ownerId}-other`;
let prisma: PrismaClient;
let importPosts: typeof import("@/server/import-posts").importPosts;
let deleteOwnedPost: typeof import("@/server/admin-library").deleteOwnedPost;
let createSyncSession: typeof import("@/server/create-sync-session").createSyncSession;
let importSyncedPost: typeof import("@/server/sync-post").importSyncedPost;

const source = {
  external_id: "123456789",
  post_url: "https://www.instagram.com/p/DELETE_ME/",
  username: "test",
  caption: "A manually deleted post",
  thumbnail_url: "https://example.com/image.jpg",
  content_type: "image",
  tags: ["deleted-only"],
};

(databaseUrl ? describe : describe.skip)("permanent manual post deletions on PostgreSQL", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", databaseUrl!);
    ({ prisma } = await import("@/server/db"));
    ({ importPosts } = await import("@/server/import-posts"));
    ({ deleteOwnedPost } = await import("@/server/admin-library"));
    ({ createSyncSession } = await import("@/server/create-sync-session"));
    ({ importSyncedPost } = await import("@/server/sync-post"));
    vi.stubEnv("AUTH_SECRET", "test-only-auth-secret-with-at-least-32-characters");
    vi.stubEnv("ADMIN_PASSWORD_HASH", `$2b$12$${"A".repeat(53)}`);
    vi.stubEnv("AUTH_DISABLED", "false");
    vi.stubEnv("APP_OWNER_ID", ownerId);
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "https://example.com/");
    vi.stubEnv("MEDIA_PATH_PREFIX", "originals");
  });

  afterEach(async () => {
    const where = { ownerId: { in: [ownerId, otherOwner] } };
    await prisma.importJob.deleteMany({ where });
    await prisma.syncJob.deleteMany({ where });
    await prisma.post.deleteMany({ where });
    await prisma.tag.deleteMany({ where });
    await prisma.deletedPost.deleteMany({ where });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
  });

  it("keeps a manually deleted post absent when the next import sees it again", async () => {
    await importPosts([source], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    await deleteOwnedPost({ ownerId, postId: post.id });

    const report = await importPosts([source], { ownerId });

    expect(await prisma.post.count({ where: { ownerId } })).toBe(0);
    expect(report).toMatchObject({ total: 1, imported: 0, updated: 0, skipped: 1, invalid: 0 });
    expect(await prisma.tag.count({ where: { ownerId } })).toBe(0);
  });

  it.each([
    { external_id: undefined, post_url: "https://instagram.com/reel/DELETE_ME/?igsh=tracking#fragment" },
    { external_id: undefined, post_url: "https://www.instagram.com/p/%44ELETE_ME/" },
    { external_id: "123456789", post_url: "https://www.instagram.com/p/DIFFERENT_CODE/" },
  ])("recognizes a deleted identity with alternate input $post_url", async (identity) => {
    await importPosts([source], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    await deleteOwnedPost({ ownerId, postId: post.id });

    const report = await importPosts([{ ...source, ...identity }], { ownerId });

    expect(report).toMatchObject({ imported: 0, updated: 0, skipped: 1 });
    expect(await prisma.post.count({ where: { ownerId } })).toBe(0);
  });

  it("rejects another owner's deletion without suppressing either owner's imports", async () => {
    await importPosts([source], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    await expect(deleteOwnedPost({ ownerId: otherOwner, postId: post.id })).rejects.toThrow("NOT_FOUND");
    expect(await prisma.deletedPost.count({ where: { ownerId: otherOwner } })).toBe(0);
    await deleteOwnedPost({ ownerId, postId: post.id });

    expect(await importPosts([source], { ownerId: otherOwner })).toMatchObject({ imported: 1, skipped: 0 });
    expect(await prisma.post.count({ where: { ownerId: otherOwner } })).toBe(1);
  });

  it("removes existing URL aliases of the same post and remembers all their identities", async () => {
    const alias = { ...source, external_id: undefined, post_url: "https://instagram.com/reel/%44ELETE_ME/" };
    const changedCode = { ...source, post_url: "https://www.instagram.com/p/OLDER_CODE/" };
    const unrelated = { ...source, external_id: "987654", post_url: "https://www.instagram.com/p/DELETE_ME_OTHER/" };
    await importPosts([source, alias, changedCode, unrelated], { ownerId });
    await importPosts([alias], { ownerId: otherOwner });
    // Select the legacy alias without an external ID; the other row supplies
    // the ID needed to recognize OLDER_CODE as part of the same identity.
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId, postUrl: "https://instagram.com/reel/%44ELETE_ME" } });

    await deleteOwnedPost({ ownerId, postId: post.id });

    expect(await prisma.post.findMany({ where: { ownerId }, select: { externalId: true } }))
      .toEqual([{ externalId: "987654" }]);
    expect(await prisma.post.count({ where: { ownerId: otherOwner } })).toBe(1);
    expect(await importPosts([{ ...changedCode, external_id: undefined }], { ownerId }))
      .toMatchObject({ imported: 0, skipped: 1 });
  });

  it("counts deletion skips alongside duplicates and invalid items, including idempotent replay", async () => {
    const retained = { ...source, external_id: "222", post_url: "https://www.instagram.com/p/KEEP/" };
    await importPosts([source, retained], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId, externalId: source.external_id } });
    await deleteOwnedPost({ ownerId, postId: post.id });
    const payload = [source, source, retained, { ...retained, external_id: "333", post_url: "https://www.instagram.com/p/NEW/" }, {}];
    const options = { ownerId, idempotencyKey: "deletion-mixed-import", batchSize: 1 };

    const report = await importPosts(payload, options);

    expect(report).toMatchObject({ total: 5, imported: 1, updated: 1, skipped: 2, invalid: 1 });
    expect(await importPosts(payload, options)).toEqual(report);
    expect(await prisma.post.count({ where: { ownerId } })).toBe(2);
  });

  it("includes deleted identities in the next sync snapshot without exposing other owners", async () => {
    await importPosts([source], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    await deleteOwnedPost({ ownerId, postId: post.id });
    await importPosts([{ ...source, external_id: "private", post_url: "https://www.instagram.com/p/PRIVATE/" }], { ownerId: otherOwner });
    const privatePost = await prisma.post.findFirstOrThrow({ where: { ownerId: otherOwner } });
    await deleteOwnedPost({ ownerId: otherOwner, postId: privatePost.id });

    const session = await createSyncSession({ ownerId, apiBaseUrl: "https://example.test" });

    expect(session.knownPosts).toEqual([{ externalId: "123456789", postCode: "DELETE_ME" }]);
    expect(session.knownExternalIds).toEqual(["123456789"]);
    expect(session.knownPostCodes).toEqual(["DELETE_ME"]);
  });

  it("skips a post deleted after the worker's sync session was issued", async () => {
    await importPosts([source], { ownerId });
    const session = await createSyncSession({ ownerId, apiBaseUrl: "https://example.test" });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    await deleteOwnedPost({ ownerId, postId: post.id });

    const report = await importSyncedPost({ sub: session.jobId, ownerId }, {
      external_id: source.external_id, post_url: source.post_url,
      username: source.username, caption: source.caption, content_type: "image",
      media: [{ type: "image", objectKey: "originals/test/DELETE_ME.jpg", sourcePath: "test/DELETE_ME.jpg", byteSize: 123 }],
    });

    expect(report).toMatchObject({ imported: 0, updated: 0, skipped: 1 });
    expect(await prisma.post.count({ where: { ownerId } })).toBe(0);
    expect(await prisma.postMedia.count({ where: { ownerId } })).toBe(0);
    expect(await prisma.syncJob.findUniqueOrThrow({ where: { id: session.jobId } }))
      .toMatchObject({ status: "RUNNING", collected: 1, imported: 0, updated: 0 });
  });

  it("bounds the sync snapshot even when suppressed posts fill its capacity", async () => {
    await prisma.deletedPost.createMany({ data: Array.from({ length: 10_001 }, (_, index) => ({
      ownerId, postUrl: `https://www.instagram.com/p/GONE_${index}`,
      postCode: `GONE_${index}`, externalId: null,
    })) });
    await importPosts([source], { ownerId });

    const session = await createSyncSession({ ownerId, apiBaseUrl: "https://example.test" });

    expect(session.knownPosts).toHaveLength(10_000);
    expect(session.knownPostCodes).toHaveLength(10_000);
    expect(session.knownExternalIds).toEqual([]);
    // The server guard must still cover a deletion omitted from the snapshot.
    const codes = new Set(session.knownPostCodes);
    const omitted = Array.from({ length: 10_001 }, (_, index) => `GONE_${index}`).find((code) => !codes.has(code))!;
    expect(await importPosts([{ ...source, external_id: undefined, post_url: `https://www.instagram.com/p/${omitted}` }], { ownerId }))
      .toMatchObject({ imported: 0, skipped: 1 });
  });

  it("rolls back the suppression marker when the post deletion fails", async () => {
    await importPosts([source], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    const hook = `deletion_failure_${randomUUID().replaceAll("-", "")}`;
    // An owner-specific database fault tests atomicity after the marker write.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${hook}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.owner_id = TG_ARGV[0] THEN RAISE EXCEPTION 'synthetic deletion failure'; END IF; RETURN OLD; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${hook}" BEFORE DELETE ON posts FOR EACH ROW EXECUTE FUNCTION "${hook}"('${ownerId}')`);
      await expect(deleteOwnedPost({ ownerId, postId: post.id })).rejects.toThrow("synthetic deletion failure");
      expect(await prisma.deletedPost.count({ where: { ownerId } })).toBe(0);
      expect(await prisma.post.findUnique({ where: { id: post.id } })).not.toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${hook}" ON posts`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${hook}"()`);
    }
  });

  it("does not resurrect a post while its deletion transaction is still committing", async () => {
    await importPosts([source], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    const hook = `deletion_gate_${randomUUID().replaceAll("-", "")}`;
    const gateReady = Promise.withResolvers<number>();
    const releaseGate = Promise.withResolvers<void>();
    const gate = prisma.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}), 1783)::text`;
      gateReady.resolve(pid);
      await releaseGate.promise;
    }, { timeout: 10_000 });
    let deletion: Promise<void> | undefined;
    let importing: ReturnType<typeof importPosts> | undefined;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${hook}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.owner_id = TG_ARGV[0] THEN PERFORM pg_advisory_xact_lock(hashtext(OLD.owner_id), 1783); END IF; RETURN OLD; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${hook}" BEFORE DELETE ON posts FOR EACH ROW EXECUTE FUNCTION "${hook}"('${ownerId}')`);
      const blockerPid = await gateReady.promise;
      deletion = deleteOwnedPost({ ownerId, postId: post.id });
      const blockedBy = (pid: number) => prisma.$queryRaw<Array<{ pid: number }>>`
        SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`;
      await expect.poll(async () => (await blockedBy(blockerPid)).length).toBe(1);
      const [{ pid: deletionPid }] = await blockedBy(blockerPid);
      importing = importPosts([source], { ownerId });
      await expect.poll(async () => (await blockedBy(deletionPid)).length).toBe(1);
      releaseGate.resolve();
      await gate;
      await deletion;
      expect(await importing).toMatchObject({ imported: 0, updated: 0, skipped: 1 });
      expect(await prisma.post.count({ where: { ownerId } })).toBe(0);
    } finally {
      releaseGate.resolve();
      await Promise.allSettled([gate, deletion, importing]);
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${hook}" ON posts`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${hook}"()`);
    }
  });

  it("deletes an import that was already writing when the admin requested removal", async () => {
    await importPosts([source], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    const imported = Promise.withResolvers<void>();
    const releaseImport = Promise.withResolvers<void>();
    const importing = prisma.$transaction(async (tx) => {
      await importPosts([{ ...source, post_url: "https://instagram.com/reel/DELETE_ME" }], { ownerId }, tx);
      imported.resolve();
      await releaseImport.promise;
    }, { timeout: 10_000 });
    let deletion: Promise<void> | undefined;
    try {
      await imported.promise;
      deletion = deleteOwnedPost({ ownerId, postId: post.id });
      releaseImport.resolve();
      await importing;
      await deletion;
      expect(await prisma.post.count({ where: { ownerId } })).toBe(0);
      expect(await importPosts([source], { ownerId })).toMatchObject({ imported: 0, skipped: 1 });
    } finally {
      releaseImport.resolve();
      await Promise.allSettled([importing, deletion]);
    }
  });
});
