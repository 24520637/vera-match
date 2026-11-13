import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [{
    command: "npm run start --workspace apps/api",
    cwd: "../..",
    url: "http://localhost:4000/api/health",
    env: { API_PORT: "4000" },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  }, {
    command: `npm exec next -- ${process.env.CI ? "start" : "dev"} --hostname 127.0.0.1 --port 3100`,
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  }, {
    command: "npm exec next -- dev tests/fixtures/auth-loading --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 120_000,
  }],
});
