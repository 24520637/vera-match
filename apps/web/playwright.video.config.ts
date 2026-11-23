import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.video-e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: process.platform === "win32" ? "./tests/video-windows-setup.ts" : undefined,
  globalTeardown: "./tests/video-global-teardown.ts",
  // Never record signed URLs/cookies in traces or recordings.
  use: {
    baseURL: "http://localhost:3100",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  projects: [
    {
      name: "video-desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "video-mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.platform === "win32" ? undefined : [
    {
      command: "node ../../scripts/video-e2e-server.cjs",
      url: "http://localhost:4100/api/health/ready",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "npm exec next -- start --hostname localhost --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      timeout: 120000,
      env: { API_INTERNAL_ORIGIN: "http://localhost:4100" },
    },
  ],
});
