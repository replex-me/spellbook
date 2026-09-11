import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const port = 3112;
const authState = path.join(process.cwd(), ".tmp-e2e", "auth.json");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: authState },
    },
  ],
  webServer: {
    command: `NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_APP_URL=http://localhost:${port} SPELLBOOK_LOCAL_EMAIL=owner@example.test SPELLBOOK_LOCAL_PASSWORD_HASH='scrypt:lvqS54O3x0TK248CgYmpqw:cNvInOIeHO97mx85EdMWthqxamajuduCuYmEAoliwvZu3hXy5sjlE0Wq9QCelWWd9lZ_fyADxTQlPOjdWg38QA' SPELLBOOK_SESSION_SECRET=spellbook-e2e-session-secret-000000000000 SPELLBOOK_WOPI_SECRET=spellbook-e2e-wopi-secret-000000000000000 SPELLBOOK_INTERNAL_TOKEN=spellbook-e2e-internal-token-000000000000 SPELLBOOK_DATA_DIR=.tmp-e2e/data pnpm exec next dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
