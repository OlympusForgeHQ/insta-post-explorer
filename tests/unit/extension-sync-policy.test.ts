import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildWebsiteReconciliationTargets,
  canonicalizePostIdentities,
  isFeedPageTerminal,
  reconciliationCompletionError,
  selectLocalIncrementalPage,
  selectWebsiteReconciliationPage,
  synchronizeWebsitePage,
} from "../../extension/ig-saved-sync/sync-policy.js";

describe("extension-to-web reconciliation policy", () => {
  it("reconciles an extension-only post behind a newer website-known post", () => {
    const pendingTargetIds = buildWebsiteReconciliationTargets(
      ["known-newest", "missing-middle", "known-old"],
      ["known-newest", "known-old"],
    );

    const result = selectWebsiteReconciliationPage(
      [
        { pk: "known-newest", code: "KNOWN_NEWEST" },
        { pk: "missing-middle", code: "MISSING_MIDDLE" },
        { pk: "known-old", code: "KNOWN_OLD" },
      ],
      new Set(["known-newest", "KNOWN_NEWEST", "known-old", "KNOWN_OLD"]),
      pendingTargetIds,
    );

    expect(result.fresh.map((post) => post.pk)).toEqual(["missing-middle"]);
    expect(result.remainingTargetIds).toEqual([]);
    expect(result.pendingUploadTargetIds).toEqual(["missing-middle"]);
    expect(result.stopEarly).toBe(true);
  });

  it("aligns a fresh or locally advanced extension index to the DB snapshot without duplicates", () => {
    const dbSnapshot = canonicalizePostIdentities([], [
      { pk: "db-pk", code: "DB_CODE" },
      { code: "LEGACY_DB_CODE" },
    ]);
    const extensionAfterLocalExport = canonicalizePostIdentities(dbSnapshot, [
      { pk: "local-pk", code: "LOCAL_CODE" },
      { code: "LOCAL_CODE" },
    ]);

    expect(dbSnapshot).toEqual([
      { pk: "db-pk", code: "DB_CODE" },
      { pk: null, code: "LEGACY_DB_CODE" },
    ]);
    expect(extensionAfterLocalExport).toHaveLength(3);
    expect(buildWebsiteReconciliationTargets(
      extensionAfterLocalExport,
      dbSnapshot,
    )).toEqual(["local-pk"]);

    const alignedAfterDbAcceptsLocalPost = canonicalizePostIdentities(
      dbSnapshot,
      [{ pk: "local-pk", code: "LOCAL_CODE" }],
    );
    expect(alignedAfterDbAcceptsLocalPost).toHaveLength(3);
  });

  it("keeps the healthy web path and local incremental path bounded", () => {
    const posts = [
      { pk: "new-post", code: "NEW_POST" },
      { pk: "known-post", code: "KNOWN_POST" },
      { pk: "older-post", code: "OLDER_POST" },
    ];

    const web = selectWebsiteReconciliationPage(
      posts,
      new Set(["known-post", "KNOWN_POST"]),
      [],
    );
    const local = selectLocalIncrementalPage(
      posts,
      new Set(["known-post", "KNOWN_POST"]),
    );

    expect(web).toMatchObject({
      fresh: [{ pk: "new-post", code: "NEW_POST" }],
      remainingTargetIds: [],
      pendingUploadTargetIds: [],
      stopEarly: true,
    });
    expect(local).toEqual({
      fresh: [{ pk: "new-post", code: "NEW_POST" }],
      stopEarly: true,
    });
  });

  it("never reports the web library current while archive targets remain unresolved", () => {
    expect(reconciliationCompletionError([])).toBeNull();
    expect(reconciliationCompletionError(["missing-one", "missing-two"])).toBe(
      "La synchronisation n’a pas retrouvé 2 posts exportés localement. Relancez un export complet puis réessayez.",
    );
  });

  it("treats a repeated Instagram cursor as a terminal page", () => {
    expect(isFeedPageTerminal({
      currentCursor: "cursor-at-feed-end",
      nextCursor: "cursor-at-feed-end",
      moreAvailable: true,
    })).toBe(true);
    expect(isFeedPageTerminal({
      currentCursor: "cursor-before-next-page",
      nextCursor: "cursor-next-page",
      moreAvailable: true,
    })).toBe(false);
  });

  it("commits target resolution only after every selected post succeeds", async () => {
    const events: string[] = [];
    const posts = [{ pk: "missing-one" }, { pk: "missing-two" }];

    await expect(
      synchronizeWebsitePage(
        posts,
        async (post) => {
          events.push(`upload:${post.pk}`);
          if (post.pk === "missing-two") throw new Error("upload failed");
          return 1;
        },
        async (post) => {
          events.push(`record:${post.pk}`);
        },
        async () => {
          events.push("commit");
        },
      ),
    ).rejects.toThrow("upload failed");
    expect(events).toEqual([
      "upload:missing-one",
      "record:missing-one",
      "upload:missing-two",
    ]);
  });

  it("ships a coherent corrected extension version and version-neutral recovery copy", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "extension/ig-saved-sync/manifest.json"), "utf8"),
    ) as {
      version?: string;
      host_permissions?: string[];
      content_scripts?: Array<{ matches?: string[] }>;
    };
    const readme = readFileSync(
      resolve(process.cwd(), "extension/ig-saved-sync/README.md"),
      "utf8",
    );
    const contentBridge = readFileSync(
      resolve(process.cwd(), "extension/ig-saved-sync/content-bridge.js"),
      "utf8",
    );
    const background = readFileSync(
      resolve(process.cwd(), "extension/ig-saved-sync/background.js"),
      "utf8",
    );
    const refreshButton = readFileSync(
      resolve(process.cwd(), "src/features/library/components/refresh-posts-button.tsx"),
      "utf8",
    );
    const allowedOrigins = [
      "https://insta-explorer.hz.kalyros.dev",
      "https://preview-insta-explorer.hz.kalyros.dev",
      "http://localhost:3000",
    ];

    expect(manifest.version).toBe("4.2.8");
    expect(readme).toContain("Insta Saved Sync 4.2.8");
    for (const origin of allowedOrigins) {
      expect(manifest.host_permissions).toContain(`${origin}/*`);
      expect(manifest.content_scripts?.[0]?.matches).toContain(`${origin}/*`);
      expect(contentBridge).toContain(`"${origin}"`);
      expect(background).toContain(`"${origin}"`);
    }
    expect(manifest.content_scripts?.[0]?.matches).toEqual(allowedOrigins.map((origin) => `${origin}/*`));
    for (const source of [JSON.stringify(manifest), contentBridge, background]) {
      expect(source).not.toContain("vercel.app");
      expect(source).not.toContain("*.kalyros.dev");
    }
    expect(JSON.stringify(manifest)).not.toContain("*.vercel.app");
    expect(contentBridge).not.toContain("*.vercel.app");
    expect(background).not.toContain("*.vercel.app");
    expect(background).toContain("progressVersion: task.progressVersion");
    expect(refreshButton).not.toContain("Insta Saved Sync 4.2.1");
    expect(refreshButton).toContain("dernière version d’Insta Saved Sync");
  });
});


describe("extension bridge API destination", () => {
  const bridge = readFileSync(resolve(process.cwd(), "extension/ig-saved-sync/content-bridge.js"), "utf8");

  function startFrom(origin: string, apiBaseUrl: string) {
    const forwarded: Array<{ type: string; data: Record<string, unknown> }> = [];
    let listener: (event: unknown) => void = () => {};
    const page = {
      location: { origin },
      addEventListener: (_type: string, callback: typeof listener) => { listener = callback; },
      postMessage: () => {},
    };
    const chrome = { runtime: {
      id: "test-extension",
      getManifest: () => ({ version: "4.2.8" }),
      sendMessage: (message: typeof forwarded[number]) => { forwarded.push(message); },
    } };
    runInNewContext(bridge, { window: page, chrome });
    const payload = { apiBaseUrl, token: "synthetic-token", jobId: "test-job", knownPosts: [] };
    listener({ source: page, origin, data: {
      channel: "INSTA_POST_EXPLORER_SYNC_V2", type: "START",
      targetExtensionId: "test-extension", requestId: "test-request", payload,
    } });
    return { forwarded, payload };
  }

  it("binds synchronization to the allowed page origin despite a proxy-derived API address", () => {
    for (const origin of ["https://insta-explorer.hz.kalyros.dev", "https://preview-insta-explorer.hz.kalyros.dev", "http://localhost:3000"]) {
      const internalUrl = "https://0.0.0.0:3000";
      const { forwarded, payload } = startFrom(origin, internalUrl);
      expect(forwarded).toEqual([{ type: "startWebSync", data: { ...payload, apiBaseUrl: origin } }]);
      expect(payload.apiBaseUrl).toBe(internalUrl);
    }
  });

  it("rejects a start from an unauthorized page even when its API destination is allowed", () => {
    for (const origin of ["https://insta-saved-post-explorer.vercel.app", "https://unrelated.hz.kalyros.dev"]) {
      expect(startFrom(origin, "https://insta-explorer.hz.kalyros.dev").forwarded).toEqual([]);
    }
  });
});
