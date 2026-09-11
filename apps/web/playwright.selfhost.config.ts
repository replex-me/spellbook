import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/selfhost",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 90_000,
  expect: { timeout: 45_000 },
  use: {
    baseURL: process.env.SPELLBOOK_SELFHOST_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
    ...devices["Desktop Chrome"],
  },
});
