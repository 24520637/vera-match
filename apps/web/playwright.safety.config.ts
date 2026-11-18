import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.safety-e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalTeardown: "./tests/auth-global-teardown.ts",
  use: {
    baseURL: "http://localhost:3100",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "safety-desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "safety-mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: "node ../../scripts/auth-e2e-server.cjs",
      url: "http://127.0.0.1:4100/api/health/ready",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "npm exec next -- start --hostname localhost --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      timeout: 120000,
      env: { API_INTERNAL_ORIGIN: "http://127.0.0.1:4100" },
    },
  ],
});
