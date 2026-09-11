// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Minimal environment for which the preflight passes when Places is disabled.
const BASE_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://neon:secretpw@db.neon.tech:5432/appdb?sslmode=require",
  AUTH_SECRET: "aGVsbG9zZWNyZXRhdXRoc2VjcmV0MTIzNDU2Nzg5MHF3",
  ADMIN_PASSWORD_HASH: "$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1",
  APP_OWNER_ID: "local",
};

function runPreflight(extraEnv: Record<string, string> = {}): { status: number | null; output: string } {
  const env = { PATH: process.env.PATH ?? "", ...BASE_ENV, ...extraEnv } as unknown as NodeJS.ProcessEnv;
  const result = spawnSync(process.execPath, ["scripts/vercel-preflight.mjs"], { env, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("vercel-preflight Places checks", () => {
  it("passes when Places is disabled and no Geoapify key is present", () => {
    expect(runPreflight().status).toBe(0);
  });

  it("fails when Places is enabled without a Geoapify key", () => {
    const { status, output } = runPreflight({ PLACES_ENABLED: "1" });
    expect(status).toBe(1);
    expect(output).toContain("GEOAPIFY_API_KEY");
  });

  it("passes when Places is enabled with a valid Geoapify configuration", () => {
    const { status } = runPreflight({
      PLACES_ENABLED: "1",
      GEOAPIFY_API_KEY: "a-valid-key",
      PLACES_RESOLVER_PROVIDER: "geoapify",
      GEOAPIFY_API_BASE_URL: "https://api.geoapify.com",
      PLACES_RESOLVER_TIMEOUT_MS: "8000",
      PLACES_RESOLVER_MAX_RESULTS: "5",
    });
    expect(status).toBe(0);
  });

  it("rejects out-of-range resolver bounds and a non-HTTPS base URL", () => {
    const { status, output } = runPreflight({
      PLACES_ENABLED: "1",
      GEOAPIFY_API_KEY: "a-valid-key",
      GEOAPIFY_API_BASE_URL: "http://insecure.example",
      PLACES_RESOLVER_MAX_RESULTS: "9",
    });
    expect(status).toBe(1);
    expect(output).toContain("GEOAPIFY_API_BASE_URL");
    expect(output).toContain("PLACES_RESOLVER_MAX_RESULTS");
  });

  it("rejects out-of-range resolver retry bounds", () => {
    const { status, output } = runPreflight({
      PLACES_ENABLED: "1",
      GEOAPIFY_API_KEY: "a-valid-key",
      PLACES_RESOLVER_MAX_ATTEMPTS: "9",
      PLACES_RESOLVER_RETRY_BASE_MS: "5000",
      PLACES_RESOLVER_RETRY_MAX_MS: "1000",
    });
    expect(status).toBe(1);
    expect(output).toContain("PLACES_RESOLVER_MAX_ATTEMPTS");
    expect(output).toContain("PLACES_RESOLVER_RETRY_MAX_MS");
  });

  it("accepts valid resolver retry bounds", () => {
    const { status } = runPreflight({
      PLACES_ENABLED: "1",
      GEOAPIFY_API_KEY: "a-valid-key",
      PLACES_RESOLVER_MAX_ATTEMPTS: "4",
      PLACES_RESOLVER_RETRY_BASE_MS: "250",
      PLACES_RESOLVER_RETRY_MAX_MS: "8000",
    });
    expect(status).toBe(0);
  });

  it("never prints the Geoapify key even on failure", () => {
    const { status, output } = runPreflight({
      PLACES_ENABLED: "1",
      GEOAPIFY_API_KEY: "SUPER-SECRET-GEOAPIFY-KEY",
      GEOAPIFY_API_BASE_URL: "http://insecure.example",
    });
    expect(status).toBe(1);
    expect(output).not.toContain("SUPER-SECRET-GEOAPIFY-KEY");
  });

  it("never prints the full DATABASE_URL", () => {
    const { output } = runPreflight({ PLACES_ENABLED: "1", GEOAPIFY_API_KEY: "a-valid-key" });
    expect(output).not.toContain("secretpw");
  });
});

describe("deployment preflight automatic sync capability", () => {
  const enabled = {
    INSTAGRAM_AUTO_SYNC_ENABLED: "1",
    INSTAGRAM_AUTO_SYNC_KEY_SHA256: "a".repeat(64),
    NEXT_PUBLIC_APP_URL: "https://insta-explorer.hz.kalyros.dev",
  };

  it("requires separate credentials and a canonical HTTPS origin only when enabled", () => {
    expect(runPreflight(enabled).status).toBe(0);
    const invalidConfigurations: Record<string, string>[] = [
      { INSTAGRAM_AUTO_SYNC_KEY_SHA256: "" },
      { INSTAGRAM_AUTO_SYNC_KEY_SHA256: "malformed" },
      { INSTAGRAM_AUTO_SYNC_TIMEZONE: "Invalid/Timezone" },
      { EXTERNAL_API_KEY_SHA256: "a".repeat(64) },
      { NEXT_PUBLIC_APP_URL: "http://example.test" },
      { NEXT_PUBLIC_APP_URL: "https://example.test/path" },
      { NEXT_PUBLIC_APP_URL: "https://user:secret@example.test/" },
    ];
    for (const override of invalidConfigurations) {
      expect(runPreflight({ ...enabled, ...override }).status).toBe(1);
    }
    expect(runPreflight({ INSTAGRAM_AUTO_SYNC_ENABLED: "0" }).status).toBe(0);
  });
});
