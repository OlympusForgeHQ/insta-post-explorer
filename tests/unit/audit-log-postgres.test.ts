// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const ownerId = `audit-${randomUUID()}`;
let prisma: PrismaClient;

(databaseUrl ? describe : describe.skip)("database mutation journal on PostgreSQL", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", databaseUrl!);
    ({ prisma } = await import("@/server/db"));
  });
  afterAll(async () => {
    await prisma?.post.deleteMany({ where: { ownerId } });
    await prisma?.collection.deleteMany({ where: { ownerId } });
    await prisma?.deletedPost.deleteMany({ where: { ownerId } });
    await prisma?.importJob.deleteMany({ where: { ownerId } });
    await prisma?.tag.deleteMany({ where: { ownerId } });
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
  });

  it("records SQL and Prisma changes with before/after values, but not reads or rolled-back writes", async () => {
    const tag = await prisma.tag.create({ data: { ownerId, name: "Before", slug: "audit" } });
    await prisma.$executeRaw`UPDATE tags SET name = 'After' WHERE id = ${tag.id}`;
    await prisma.tag.findUnique({ where: { id: tag.id } });
    await expect(prisma.$transaction(async (tx) => {
      await tx.tag.update({ where: { id: tag.id }, data: { name: "Rolled back" } });
      throw new Error("ROLLBACK");
    })).rejects.toThrow("ROLLBACK");
    await prisma.tag.delete({ where: { id: tag.id } });
    const events = await prisma.$queryRaw<Array<{ operation: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null }>>`
      SELECT operation, before_data, after_data FROM audit_events
      WHERE owner_id = ${ownerId} AND table_name = 'tags' ORDER BY id`;
    expect(events.map((event) => [event.operation, event.before_data?.name, event.after_data?.name]))
      .toEqual([["INSERT", undefined, "Before"], ["UPDATE", "Before", "After"], ["DELETE", "After", undefined]]);
  });

  it("keeps cascade ownership and the administrator's deletion intent after the parent disappears", async () => {
    const { importPosts } = await import("@/server/import-posts");
    const { deleteOwnedPost } = await import("@/server/admin-library");
    await importPosts([{
      post_url: "https://www.instagram.com/p/AUDIT/", username: "test", caption: "Remember this",
      thumbnail_url: "https://example.com/a.jpg", tags: ["audit-cascade"],
    }], { ownerId });
    const post = await prisma.post.findFirstOrThrow({ where: { ownerId } });
    const collection = await prisma.collection.create({ data: { ownerId, name: "Audit", slug: "audit" } });
    await prisma.collectionPost.create({ data: { postId: post.id, collectionId: collection.id } });
    await deleteOwnedPost({ ownerId, postId: post.id });
    const events = await prisma.auditEvent.findMany({ where: { ownerId, operation: "DELETE", action: "admin.delete_post" } });
    expect(events.map((event) => event.tableName)).toEqual(expect.arrayContaining(["posts", "post_media", "post_tags", "collection_posts", "tags"]));
    expect(events.find((event) => event.tableName === "posts")?.beforeData).toMatchObject({ id: post.id, caption: "Remember this" });
    expect(new Set(events.map((event) => event.transactionId)).size).toBe(1);
    await prisma.collection.delete({ where: { id: collection.id } });
    await prisma.deletedPost.deleteMany({ where: { ownerId } });
    await prisma.importJob.deleteMany({ where: { ownerId } });
  });

  it("captures restricted worker writes without granting the worker access to the journal", async () => {
    const role = `audit_worker_${randomUUID().replaceAll("-", "")}`;
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
    try {
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await prisma.$executeRawUnsafe(`GRANT INSERT ON public.tags TO ${role}`);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        await tx.$queryRaw`SELECT set_config('application_name', 'ipe-worker:audit-test', true)`;
        await tx.$executeRaw`INSERT INTO tags(id, owner_id, name, slug) VALUES (${id}, ${ownerId}, 'Worker', ${id})`;
      });
      expect(await prisma.auditEvent.findFirst({ where: { ownerId, applicationName: "ipe-worker:audit-test" } }))
        .toMatchObject({ operation: "INSERT", tableName: "tags", afterData: { name: "Worker" }, action: null });
      await expect(prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        await tx.$queryRaw`SELECT * FROM audit_events LIMIT 1`;
      })).rejects.toThrow(/permission denied/);
    } finally {
      await prisma.$executeRawUnsafe(`REVOKE ALL ON public.tags FROM ${role}`);
      await prisma.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM ${role}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
  });

  it("rejects journal tampering and records truncate effects transactionally", async () => {
    for (const sql of ["UPDATE audit_events SET action = 'changed'", "DELETE FROM audit_events", "TRUNCATE audit_events"]) {
      await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow(/append-only/);
    }
    const postUrl = `https://www.instagram.com/p/${randomUUID()}`;
    await prisma.deletedPost.create({ data: { ownerId, postUrl } });
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRaw`TRUNCATE deleted_posts`;
      expect(await tx.auditEvent.findFirst({ where: { ownerId, tableName: "deleted_posts", operation: "TRUNCATE", recordKey: { path: ["post_url"], equals: postUrl } } }))
        .toMatchObject({ beforeData: { post_url: postUrl }, afterData: null });
      throw new Error("TRUNCATE_ROLLBACK");
    })).rejects.toThrow("TRUNCATE_ROLLBACK");
    expect(await prisma.deletedPost.findUnique({ where: { ownerId_postUrl: { ownerId, postUrl } } })).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { ownerId, operation: "TRUNCATE" } })).toBe(0);
  });

  it("covers all business tables and exposes a bounded owner-scoped history", async () => {
    const missing = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables t WHERE schemaname = 'public'
      AND tablename NOT IN ('audit_events', '_prisma_migrations')
      AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || quote_ident(t.tablename))::regclass
        AND tgname IN ('00_audit_row_write', 'audit_row_delete', 'audit_table_truncate')) <> 3`;
    expect(missing).toEqual([]);
    const { getAuditLog } = await import("@/server/audit-log");
    const first = await getAuditLog(ownerId, { table: "tags", operation: "INSERT", limit: "2" });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await getAuditLog(ownerId, { table: "tags", operation: "INSERT", limit: "2", cursor: first.nextCursor! });
    expect(second.items.length).toBeGreaterThan(0);
    expect(new Set([...first.items, ...second.items].map((event) => event.id)).size).toBe(first.items.length + second.items.length);
    expect([...first.items, ...second.items].every((event) => event.tableName === "tags" && event.operation === "INSERT")).toBe(true);
    expect(await getAuditLog(`${ownerId}-other`, {})).toEqual({ items: [], nextCursor: null });
    for (const query of [{ limit: "101" }, { cursor: "-1" }, { cursor: "9223372036854775808" }, { table: "audit_events" }, { operation: "SELECT" }]) {
      await expect(getAuditLog(ownerId, query)).rejects.toThrow();
    }
  });

  it("does not execute function overloads from a writable public schema with journal-owner privileges", async () => {
    const name = `audit_probe_${randomUUID().replaceAll("-", "")}`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE public.${name} (id text, owner_id text)`);
      await tx.$executeRawUnsafe(`CREATE FUNCTION public.to_jsonb(public.${name}) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'UNTRUSTED_OVERLOAD_EXECUTED'; END; $$`);
      await tx.$executeRawUnsafe(`CREATE TRIGGER audit_probe AFTER INSERT ON public.${name} FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row('id')`);
      await tx.$executeRawUnsafe(`INSERT INTO public.${name} VALUES ('probe', '${ownerId}')`);
      expect(await tx.auditEvent.findFirst({ where: { tableName: name, ownerId } })).toMatchObject({ afterData: { id: "probe" } });
      throw new Error("PROBE_ROLLBACK");
    })).rejects.toThrow("PROBE_ROLLBACK");
  });

  it("splits owner transfers without exposing the other owner's values, including renamed parent IDs", async () => {
    const otherOwner = `${ownerId}-transfer`;
    const firstId = randomUUID();
    const secondId = randomUUID();
    const renamedId = randomUUID();
    await expect(prisma.$transaction(async (tx) => {
      const post = { ownerId, authorUsername: "audit", authorSortKey: "audit", caption: "Private A", searchText: "audit", thumbnailUrl: "https://example.com/a.jpg" };
      await tx.post.create({ data: { ...post, id: firstId, postUrl: `https://www.instagram.com/p/${firstId}` } });
      await tx.post.create({ data: { ...post, ownerId: otherOwner, id: secondId, caption: "Private B", postUrl: `https://www.instagram.com/p/${secondId}` } });
      const tag = await tx.tag.create({ data: { ownerId, name: "Transfer", slug: "transfer" } });
      await tx.postTag.create({ data: { postId: firstId, tagId: tag.id } });
      await tx.postTag.update({ where: { postId_tagId: { postId: firstId, tagId: tag.id } }, data: { postId: secondId } });
      await tx.post.update({ where: { id: secondId }, data: { id: renamedId, ownerId, caption: "Now A" } });
      const events = await tx.auditEvent.findMany({ where: { ownerId: { in: [ownerId, otherOwner] }, operation: "UPDATE", tableName: { in: ["posts", "post_tags"] } }, orderBy: { id: "asc" } });
      expect(events.map((event) => [event.tableName, event.ownerId, event.beforeData !== null, event.afterData !== null])).toEqual([
        ["post_tags", ownerId, true, false], ["post_tags", otherOwner, false, true],
        ["posts", otherOwner, true, false], ["posts", ownerId, false, true],
        ["post_tags", otherOwner, true, false], ["post_tags", ownerId, false, true],
      ]);
      expect(JSON.stringify(events.filter((event) => event.ownerId === ownerId).map((event) => [event.beforeData, event.afterData]))).not.toContain("Private B");
      throw new Error("TRANSFER_ROLLBACK");
    })).rejects.toThrow("TRANSFER_ROLLBACK");
  });
});
