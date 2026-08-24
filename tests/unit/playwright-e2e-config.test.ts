import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@playwright/test", () => ({
  defineConfig: <T>(config: T) => config,
  devices: {
    "Desktop Chrome": {},
    "Pixel 7": {},
  },
}));

const originalBaseUrl = process.env.E2E_BASE_URL;

function restoreBaseUrl() {
  if (originalBaseUrl === undefined) delete process.env.E2E_BASE_URL;
  else process.env.E2E_BASE_URL = originalBaseUrl;
}

afterEach(() => {
  restoreBaseUrl();
  vi.resetModules();
});

describe("Playwright E2E configuration boundaries", () => {
  it("keeps real auth/import out of the database-less generic server", async () => {
    const { default: config } = await import("../../playwright.config");

    expect(config.testIgnore).toEqual(expect.arrayContaining(["auth-and-import.spec.ts"]));
    expect(config.webServer).toMatchObject({ env: { DATABASE_URL: "" } });
  });

  it("requires an explicit HTTP target for real auth/import E2E", async () => {
    delete process.env.E2E_BASE_URL;

    await expect(import("../../playwright.auth-import.config")).rejects.toThrow("E2E_BASE_URL");

    vi.resetModules();
    process.env.E2E_BASE_URL = "file:///tmp/not-a-test-target";
    await expect(import("../../playwright.auth-import.config")).rejects.toThrow("HTTP(S)");
  });

  it("uses only the dedicated target and starts no local server", async () => {
    process.env.E2E_BASE_URL = "http://127.0.0.1:4300";

    const { default: config } = await import("../../playwright.auth-import.config");

    expect(config.testMatch).toBe("auth-and-import.spec.ts");
    expect(config.use).toMatchObject({ baseURL: "http://127.0.0.1:4300" });
    expect(config.webServer).toBeUndefined();
  });
});
