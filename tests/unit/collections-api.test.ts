import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getLibraryCollections: vi.fn(),
  createCollection: vi.fn(),
  setPostFavorite: vi.fn(),
  setPostCollection: vi.fn(),
}));

vi.mock("@/auth/config", () => ({ getConfiguredOwnerId: () => "owner-public", AuthConfigurationError: class extends Error {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({ requireSession: mocks.requireSession, UnauthorizedError: class extends Error {} }));
vi.mock("@/server/library", () => ({ getLibraryCollections: mocks.getLibraryCollections }));
vi.mock("@/server/collections", () => ({ createCollection: mocks.createCollection, setPostFavorite: mocks.setPostFavorite, setPostCollection: mocks.setPostCollection, FavoriteCollectionUnavailableError: class extends Error {} }));

describe("API collections", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://library.example"); });
  afterEach(() => vi.unstubAllEnvs());

  it("expose publiquement les collections du owner configuré", async () => {
    mocks.getLibraryCollections.mockResolvedValue([{ id: "favorites", name: "Favoris", slug: "favoris", isSystem: true, count: 1 }]);
    const { GET } = await import("@/app/api/collections/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.getLibraryCollections).toHaveBeenCalledWith("owner-public");
  });

  it("utilise exclusivement le owner de session pour créer", async () => {
    mocks.requireSession.mockResolvedValue({ ownerId: "owner-admin", role: "admin" });
    mocks.createCollection.mockResolvedValue({ id: "c1", name: "Voyages", slug: "voyages", isSystem: false });
    const { POST } = await import("@/app/api/collections/route");
    const response = await POST(new Request("http://localhost/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Voyages" }) }));
    expect(response.status).toBe(201);
    expect(mocks.createCollection).toHaveBeenCalledWith("owner-admin", "Voyages");
  });
});


describe("public shared favorites API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://library.example");
    mocks.requireSession.mockRejectedValue(new Error("UNAUTHORIZED"));
    mocks.setPostFavorite.mockImplementation(async (_owner, _post, included) => ({ included }));
  });
  afterEach(() => vi.unstubAllEnvs());

  function request(method: string, origin: string | null = "https://library.example", extra: Record<string, string> = {}) {
    return new Request("https://proxy.internal/api/posts/p1/favorite?ownerId=foreign&collectionId=arbitrary", {
      method, headers: { ...(origin === null ? {} : { Origin: origin }), ...extra },
      body: JSON.stringify({ ownerId: "foreign", collectionId: "arbitrary", tag: "Other" }),
    });
  }
  const context = () => ({ params: Promise.resolve({ id: "p1" }) });

  it("sets an explicit favorite state anonymously using only the configured owner and post", async () => {
    const route = await import("@/app/api/posts/[id]/favorite/route");
    for (const [method, included] of [["PUT", true], ["DELETE", false]] as const) {
      const response = await route[method](request(method), context());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ included });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
      expect(mocks.setPostFavorite).toHaveBeenLastCalledWith("owner-public", "p1", included);
    }
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("rejects untrusted browser origins before mutating, even with a forged request host", async () => {
    const { PUT } = await import("@/app/api/posts/[id]/favorite/route");
    for (const origin of [null, "null", "garbage", "https://evil.example", "https://library.example/extra", "https://user:pass@library.example"]) {
      expect((await PUT(request("PUT", origin), context())).status).toBe(403);
    }
    expect((await PUT(request("PUT", "https://library.example", { "Sec-Fetch-Site": "cross-site" }), context())).status).toBe(403);
    expect((await PUT(request("PUT", "https://proxy.internal"), context())).status).toBe(403);
    expect(mocks.setPostFavorite).not.toHaveBeenCalled();
  });

  it("fails closed for invalid production configuration and permits local fallback only outside production", async () => {
    const { PUT } = await import("@/app/api/posts/[id]/favorite/route");
    for (const site of ["", "invalid", "http://library.example", "https://user:pass@library.example", "file:///tmp/site"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", site);
      const response = await PUT(request("PUT"), context());
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(mocks.setPostFavorite).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect((await PUT(request("PUT", "https://proxy.internal"), context())).status).toBe(200);
  });

  it("maps missing posts and failures to bounded non-cacheable responses", async () => {
    const { PUT } = await import("@/app/api/posts/[id]/favorite/route");
    const { AdminResourceNotFoundError } = await import("@/server/admin-library");
    const { FavoriteCollectionUnavailableError } = await import("@/server/collections");
    for (const [error, status, body] of [
      [new AdminResourceNotFoundError(), 404, { error: "NOT_FOUND" }],
      [new FavoriteCollectionUnavailableError(), 409, { error: "FAVORITES_UNAVAILABLE" }],
      [new Error("private database connection details"), 500, { error: "INTERNAL_ERROR" }],
    ] as const) {
      mocks.setPostFavorite.mockRejectedValueOnce(error);
      const response = await PUT(request("PUT"), context());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("keeps generic collection, arbitrary tag and post deletion mutations authenticated", async () => {
    const collections = await import("@/app/api/collections/route");
    const membership = await import("@/app/api/collections/[id]/posts/[postId]/route");
    const collection = await import("@/app/api/collections/[id]/route");
    const tags = await import("@/app/api/posts/[id]/tags/route");
    const posts = await import("@/app/api/posts/[id]/route");
    const responses = [
      await collections.POST(request("POST")),
      await collection.PATCH(request("PATCH"), context()),
      await collection.DELETE(request("DELETE"), context()),
      await membership.PUT(request("PUT"), { params: Promise.resolve({ id: "other", postId: "p1" }) }),
      await membership.DELETE(request("DELETE"), { params: Promise.resolve({ id: "other", postId: "p1" }) }),
      await tags.POST(request("POST"), context()),
      await tags.DELETE(request("DELETE"), context()),
      await posts.DELETE(request("DELETE"), context()),
    ];
    expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401, 401]);
    expect(mocks.setPostCollection).not.toHaveBeenCalled();
    expect(mocks.createCollection).not.toHaveBeenCalled();
    expect(mocks.setPostFavorite).not.toHaveBeenCalled();
  });
});
