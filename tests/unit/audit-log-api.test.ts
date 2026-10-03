// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { requireSessionMock, getAuditLogMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn(), getAuditLogMock: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({ requireSession: requireSessionMock, UnauthorizedError: class UnauthorizedError extends Error {} }));
vi.mock("@/server/audit-log", () => ({ getAuditLog: getAuditLogMock }));
import { UnauthorizedError } from "@/auth/session";
import { GET } from "@/app/api/admin/audit/route";

describe("admin audit API", () => {
  beforeEach(() => { requireSessionMock.mockReset(); getAuditLogMock.mockReset(); });
  it("requires authentication before querying private deleted content", async () => {
    requireSessionMock.mockRejectedValue(new UnauthorizedError());
    expect((await GET(new Request("http://localhost/api/admin/audit"))).status).toBe(401);
    expect(getAuditLogMock).not.toHaveBeenCalled();
  });
  it("uses the session owner, serializes the page and disables caching", async () => {
    requireSessionMock.mockResolvedValue({ ownerId: "owner-a", role: "admin" });
    getAuditLogMock.mockResolvedValue({ items: [], nextCursor: null });
    const response = await GET(new Request("http://localhost/api/admin/audit?ownerId=other&table=posts"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(getAuditLogMock).toHaveBeenCalledWith("owner-a", { ownerId: "other", table: "posts" });
  });
  it("returns a validation response for an invalid filter", async () => {
    requireSessionMock.mockResolvedValue({ ownerId: "owner-a" });
    getAuditLogMock.mockRejectedValue(z.number().safeParse("invalid").error);
    expect((await GET(new Request("http://localhost/api/admin/audit?limit=invalid"))).status).toBe(400);
  });
});
