import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const baseURL = process.env.E2E_BASE_URL?.trim();

if (!baseURL) {
  throw new Error("E2E_BASE_URL is required for the real auth/import E2E suite.");
}

let protocol: string;
try {
  protocol = new URL(baseURL).protocol;
} catch {
  throw new Error("E2E_BASE_URL must use HTTP(S).");
}
if (protocol !== "http:" && protocol !== "https:") {
  throw new Error("E2E_BASE_URL must use HTTP(S).");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "auth-and-import.spec.ts",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
