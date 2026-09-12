// @vitest-environment node

import { createHash } from "node:crypto";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  transaction: vi.fn(), posts: vi.fn(), createJob: vi.fn(), session: vi.fn(),
}));
vi.mock("@/server/db", () => ({ prisma: { $transaction: db.transaction } }));
vi.mock("@/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/auth/session")>(),
  requireSession: db.session,
}));

import { POST as automaticSession } from "@/app/api/v1/sync/session/route";
import { POST as manualSession } from "@/app/api/sync/session/route";
import { UnauthorizedError } from "@/auth/session";
import { verifySyncToken } from "@/auth/sync-token";

const KEY = `ips_sync_${"A".repeat(43)}`;
const READ_KEY = "ipe_read-only-test";
const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const request = (token = KEY) => new Request("http://internal-container:3000/api/v1/sync/session", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ ownerId: "attacker", apiBaseUrl: "https://attacker.test" }),
});

describe("manual and automatic sync sessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH_SECRET", "test-only-auth-secret-with-at-least-32-characters");
    vi.stubEnv("ADMIN_PASSWORD_HASH", `$2b$12$${"A".repeat(53)}`);
    vi.stubEnv("AUTH_DISABLED", "false");
    vi.stubEnv("APP_OWNER_ID", "test-owner");
    vi.stubEnv("INSTAGRAM_AUTO_SYNC_ENABLED", "1");
    vi.stubEnv("INSTAGRAM_AUTO_SYNC_KEY_SHA256", hash(KEY));
    vi.stubEnv("EXTERNAL_API_KEY_SHA256", hash(READ_KEY));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://insta-explorer.hz.kalyros.dev");
    db.session.mockResolvedValue({ ownerId: "test-owner" });
    db.posts.mockResolvedValue([
      { externalId: "123", postUrl: "https://www.instagram.com/p/CURRENT/" },
      { externalId: null, postUrl: "https://www.instagram.com/reel/LEGACY/" },
    ]);
    db.createJob.mockResolvedValue({ id: "new-job" });
    db.transaction.mockImplementation((operation) => operation({
      $queryRaw: async () => [],
      post: { findMany: db.posts }, syncJob: { create: db.createJob, findMany: async () => [] },
    }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns the compatible owner-scoped snapshot and canonical URL without an admin cookie", async () => {
    const response = await automaticSession(request());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      jobId: "new-job", token: expect.any(String),
      apiBaseUrl: "https://insta-explorer.hz.kalyros.dev",
      knownExternalIds: ["123"], knownPostCodes: ["CURRENT", "LEGACY"],
      knownPosts: [{ externalId: "123", postCode: "CURRENT" }, { externalId: null, postCode: "LEGACY" }],
      expiresInSeconds: 14_400,
      heartbeatIntervalSeconds: 30,
    });
    expect(db.posts).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: "test-owner" }, take: 10_000 }));
    expect(db.createJob).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: "test-owner" }) });
    expect(db.session).not.toHaveBeenCalled();
    await expect(verifySyncToken(body.token)).resolves.toMatchObject({ sub: "new-job", ownerId: "test-owner" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
  });

  it("rejects denied automation requests before touching persistent state", async () => {
    for (const token of ["", "wrong", READ_KEY]) {
      const response = await automaticSession(request(token));
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("UNAUTHORIZED");
    }
    vi.stubEnv("INSTAGRAM_AUTO_SYNC_ENABLED", "0");
    const disabled = await automaticSession(request());
    expect(disabled.status).toBe(503);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("preserves manual cookie authorization, snapshot and token lifetime with automation disabled", async () => {
    vi.stubEnv("INSTAGRAM_AUTO_SYNC_ENABLED", "0");
    const response = await manualSession(request());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.expiresInSeconds).toBe(86_400);
    expect(body.knownPostCodes).toEqual(["CURRENT", "LEGACY"]);
    expect(decodeJwt(body.token).automationKeyId).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    db.session.mockRejectedValue(new UnauthorizedError());
    const denied = await manualSession(request());
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  it("does not expose database or signing errors or return a session on transaction failure", async () => {
    db.transaction.mockRejectedValue(new Error("database password=private-internal-value"));
    for (const route of [automaticSession, manualSession]) {
      const response = await route(request());
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toContain("INTERNAL_ERROR");
      expect(text).not.toContain("private-internal-value");
      expect(text).not.toContain("token");
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });
});
