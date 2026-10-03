import { describe, expect, it } from "vitest";

import { buildSyncKnownPosts } from "@/server/sync-session";

describe("sync session DB identity snapshot", () => {
  it("preserves external ID and post-code pairing for current and legacy DB rows", () => {
    expect(buildSyncKnownPosts([
      {
        externalId: "123",
        postUrl: "https://www.instagram.com/p/CURRENT_CODE/",
      },
      {
        externalId: null,
        postUrl: "https://www.instagram.com/reel/LEGACY_CODE/",
      },
      {
        externalId: "456",
        postUrl: "not a URL",
      },
      { externalId: null, postUrl: "https://instagram.com/p/%44ELETE_ME/" },
    ])).toEqual([
      { externalId: "123", postCode: "CURRENT_CODE" },
      { externalId: null, postCode: "LEGACY_CODE" },
      { externalId: "456", postCode: null },
      { externalId: null, postCode: "DELETE_ME" },
    ]);
  });
});
