const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const root = resolve(__dirname, "..");
for (const file of ["apps/api/.env", ".env"]) {
  try {
    process.loadEnvFile(resolve(root, file));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const runId = randomUUID();
const env = {
  ...process.env,
  NODE_ENV: "production",
  VERA_AUTH_E2E_RUN_ID: runId,
  VERA_SAFETY_E2E_RUN_ID: runId,
  API_INTERNAL_ORIGIN: "http://127.0.0.1:4100",
};
for (const [file, args, cwd] of [
  ["node_modules/@nestjs/cli/bin/nest.js", ["build"], "apps/api"],
  ["node_modules/next/dist/bin/next", ["build"], "apps/web"],
  [
    "node_modules/playwright/cli.js",
    [
      "test",
      "--config",
      "playwright.safety.config.ts",
      ...process.argv.slice(2),
    ],
    "apps/web",
  ],
]) {
  const result = spawnSync(process.execPath, [resolve(root, file), ...args], {
    cwd: resolve(root, cwd),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
