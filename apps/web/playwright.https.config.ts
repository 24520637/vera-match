import { defineConfig } from "@playwright/test";
const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
  /^(PATH|SystemRoot|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|DISPLAY|LANG|LC_ALL|XDG_RUNTIME_DIR)$/i.test(key))) as Record<string, string>;
if (process.platform !== "win32") browserEnv.HOME = process.env.VERA_TLS_BROWSER_HOME!;
export default defineConfig({
  testDir: "./tests", testMatch: "**/*.https-e2e.ts", workers: 1, fullyParallel: false, retries: 0,
  reporter: [["list"]], globalTeardown: "./tests/auth-global-teardown.ts",
  use: { baseURL: "https://vera.test:3443", trace: "off", screenshot: "off", video: "off",
    ignoreHTTPSErrors: false,
    launchOptions: { env: browserEnv, args: ["--host-resolver-rules=MAP *.test 127.0.0.1", "--no-proxy-server"] } },
  projects: [
    { name: "https-desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    { name: "https-mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: "node ../../scripts/auth-e2e-server.cjs", url: "http://127.0.0.1:4140/api/health/ready", reuseExistingServer: false, timeout: 120000 },
    { command: "npm exec next -- start --hostname 127.0.0.1 --port 3140", url: "http://127.0.0.1:3140", reuseExistingServer: false, timeout: 120000,
      env: { API_INTERNAL_ORIGIN: "http://127.0.0.1:4140" } },
    { command: "node ../../scripts/https-e2e-proxy.cjs", url: "https://127.0.0.1:3443/__tls-probe", reuseExistingServer: false, timeout: 30000 },
  ],
});
