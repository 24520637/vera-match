const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { cleanupVideoFixture } = require("./video-e2e-fixtures.cjs");
const root = resolve(__dirname, "..");
for (const file of ["apps/api/.env", ".env"]) {
  try {
    process.loadEnvFile(resolve(root, file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const env = {
  ...process.env,
  NODE_ENV: "production",
  VERA_VIDEO_E2E_RUN_ID: randomUUID(),
  API_INTERNAL_ORIGIN: "http://localhost:4100",
  MAILPIT_BASE_URL: "http://127.0.0.1:8025",
};
for (const [file, args, cwd] of [
  ["node_modules/@nestjs/cli/bin/nest.js", ["build"], "apps/api"],
  ["node_modules/next/dist/bin/next", ["build"], "apps/web"],
]) {
  const result = spawnSync(process.execPath, [resolve(root, file), ...args], {
    cwd: resolve(root, cwd),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const result = spawnSync(process.execPath, [
  resolve(root, "node_modules/playwright/cli.js"),
  "test", "--config", "playwright.video.config.ts", ...process.argv.slice(2),
], { cwd: resolve(root, "apps/web"), env, stdio: "inherit", windowsHide: true });
process.exitCode = result.status ?? 1;
// A web server can fail before Playwright registers its global teardown.
cleanupVideoFixture(env).catch(() => {
  console.error("Video runner could not clean its fixtures; inspect the owned runtime manifest.");
  process.exitCode ||= 1;
});
