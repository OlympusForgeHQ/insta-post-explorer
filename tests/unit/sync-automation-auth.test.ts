// @vitest-environment node

import { createHash } from "node:crypto";
import { decodeJwt, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requireExternalApiKey } from "@/auth/api-key";
import {
  getSyncAutomationConfiguration,
  requireSyncAutomationKey,
} from "@/auth/sync-automation";
import { createSyncToken, verifySyncToken } from "@/auth/sync-token";
import { createSessionToken, verifySessionToken } from "@/auth/token";
import { requireSyncToken } from "@/server/sync-auth";

const KEY = `ips_sync_${"A".repeat(43)}`;
const READ_KEY = "ipe_test-read-key";
const SECRET = "test-only-auth-secret-with-at-least-32-characters";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const request = (token: string) => new Request("https://example.test/api/v1/sync/session", {
  headers: { authorization: `Bearer ${token}` },
});

describe("automatic sync capability", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("ADMIN_PASSWORD_HASH", `$2b$12$${"A".repeat(53)}`);
    vi.stubEnv("APP_OWNER_ID", "test-owner");
    vi.stubEnv("AUTH_DISABLED", "false");
    vi.stubEnv("INSTAGRAM_AUTO_SYNC_ENABLED", "1");
    vi.stubEnv("INSTAGRAM_AUTO_SYNC_KEY_SHA256", digest(KEY));
    vi.stubEnv("EXTERNAL_API_KEY_SHA256", digest(READ_KEY));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://insta-explorer.hz.kalyros.dev/");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("separates automation, read-only API and administrator capabilities", async () => {
    expect(requireSyncAutomationKey(request(KEY))).toMatchObject({
      ownerId: "test-owner", apiBaseUrl: "https://insta-explorer.hz.kalyros.dev",
    });
    expect(() => requireSyncAutomationKey(request(READ_KEY))).toThrow("SYNC_AUTOMATION_UNAUTHORIZED");
    expect(() => requireSyncAutomationKey(request(""))).toThrow("SYNC_AUTOMATION_UNAUTHORIZED");
    expect(() => requireExternalApiKey(request(KEY))).toThrow("EXTERNAL_API_UNAUTHORIZED");
    expect(() => requireSyncAutomationKey(request(`ips_sync_${"B".repeat(43)}`))).toThrow("SYNC_AUTOMATION_UNAUTHORIZED");
    const adminToken = await createSessionToken();
    expect(() => requireSyncAutomationKey(request(adminToken))).toThrow("SYNC_AUTOMATION_UNAUTHORIZED");
    const { keyId } = requireSyncAutomationKey(request(KEY));
    const runToken = await createSyncToken("job-1", "test-owner", { automationKeyId: keyId });
    await expect(verifySessionToken(runToken)).resolves.toBeNull();
  });

  it("fails closed on disabled, incomplete, reused or unsafe configuration", () => {
    const cases: Array<[string, string | undefined]> = [
      ["INSTAGRAM_AUTO_SYNC_ENABLED", "0"],
      ["INSTAGRAM_AUTO_SYNC_ENABLED", ""],
      ["INSTAGRAM_AUTO_SYNC_KEY_SHA256", ""],
      ["INSTAGRAM_AUTO_SYNC_KEY_SHA256", "invalid"],
      ["INSTAGRAM_AUTO_SYNC_KEY_SHA256", digest(READ_KEY)],
      ["APP_OWNER_ID", undefined],
      ["APP_OWNER_ID", ""],
      ["INSTAGRAM_AUTO_SYNC_TIMEZONE", "Invalid/Timezone"],
      ["NEXT_PUBLIC_APP_URL", "http://example.test"],
      ["NEXT_PUBLIC_APP_URL", "https://name:password@example.test"],
      ["NEXT_PUBLIC_APP_URL", "https://example.test/path"],
      ["NEXT_PUBLIC_APP_URL", "https://example.test/?token=hidden"],
    ];
    for (const [name, value] of cases) {
      const previous = process.env[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
      expect(() => getSyncAutomationConfiguration(), name).toThrow("SYNC_AUTOMATION_UNAVAILABLE");
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  it("uses the configured local day and only permits loopback outside production", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-11T22:30:00Z"));
      vi.stubEnv("INSTAGRAM_AUTO_SYNC_TIMEZONE", "Europe/Brussels");
      expect(getSyncAutomationConfiguration().localDay).toBe("2026-09-12");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NODE_ENV", "test");
      expect(getSyncAutomationConfiguration().apiBaseUrl).toBe("http://localhost:3000");
      vi.stubEnv("NODE_ENV", "production");
      expect(() => getSyncAutomationConfiguration()).toThrow("SYNC_AUTOMATION_UNAVAILABLE");
    } finally { vi.useRealTimers(); }
  });

  it("expires automatic tokens after four hours while preserving manual tokens", async () => {
    const { keyId } = requireSyncAutomationKey(request(KEY));
    const automatic = await createSyncToken("auto-job", "test-owner", { automationKeyId: keyId });
    const manual = await createSyncToken("manual-job", "test-owner");
    const autoClaims = decodeJwt(automatic);
    const manualClaims = decodeJwt(manual);
    expect(autoClaims.exp! - autoClaims.iat!).toBe(14_400);
    expect(manualClaims.exp! - manualClaims.iat!).toBe(86_400);
    expect(autoClaims.automationKeyId).not.toBe(digest(KEY));
    await expect(verifySyncToken(automatic)).resolves.toMatchObject({ sub: "auto-job", ownerId: "test-owner" });
    await expect(verifySyncToken(`${automatic}x`)).rejects.toThrow();
    const expired = await new SignJWT({ ownerId: "test-owner", scope: "instagram-sync", automationKeyId: keyId })
      .setProtectedHeader({ alg: "HS256" }).setSubject("expired-job")
      .setIssuedAt().setExpirationTime("-1s").sign(new TextEncoder().encode(SECRET));
    await expect(verifySyncToken(expired)).rejects.toThrow();
  });

  it("revokes issued automatic tokens on disable, rotation or owner change, without revoking manual tokens", async () => {
    const { keyId } = requireSyncAutomationKey(request(KEY));
    const automatic = await createSyncToken("auto-job", "test-owner", { automationKeyId: keyId });
    const manual = await createSyncToken("manual-job", "test-owner");
    for (const [name, value] of [
      ["INSTAGRAM_AUTO_SYNC_ENABLED", "0"],
      ["INSTAGRAM_AUTO_SYNC_KEY_SHA256", digest(`ips_sync_${"B".repeat(43)}`)],
      ["APP_OWNER_ID", "other-owner"],
    ]) {
      const previous = process.env[name];
      process.env[name] = value;
      await expect(verifySyncToken(automatic)).rejects.toThrow();
      await expect(requireSyncToken(request(automatic))).rejects.toThrow("SYNC_UNAUTHORIZED");
      await expect(verifySyncToken(manual)).resolves.toMatchObject({ sub: "manual-job" });
      process.env[name] = previous;
    }
  });
});
