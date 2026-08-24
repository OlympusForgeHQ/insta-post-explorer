import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["places.spec.ts", "places-globe.spec.ts"],
  // ponytail: one local WebGL stack; raise this only after stable parallel runs.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: "node scripts/places/visual-globe-harness.mjs --port 3000",
    url: "http://127.0.0.1:3000/places",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile-only/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      grep: /@mobile/,
    },
  ],
});
