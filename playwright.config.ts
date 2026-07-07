import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "INKPRESS_HOME=$PWD/.e2e-data RESOURCE_ROOT=$PWD/prisma pnpm tsx scripts/setup-e2e.ts && INKPRESS_HOME=$PWD/.e2e-data RESOURCE_ROOT=$PWD PORT=3100 HOSTNAME=127.0.0.1 pnpm start",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
