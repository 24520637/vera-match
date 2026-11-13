const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const root = resolve(__dirname, "..");
const env = {
  ...process.env,
  VERA_AUTH_E2E_RUN_ID: randomUUID(),
  NEXT_PUBLIC_API_BASE_URL: "http://localhost:4100/api",
  API_INTERNAL_BASE_URL: "http://localhost:4100/api",
};
for (const [script, args, cwd] of [
  [
    resolve(root, "node_modules/@nestjs/cli/bin/nest.js"),
    ["build"],
    resolve(root, "apps/api"),
  ],
  [
    resolve(root, "node_modules/next/dist/bin/next"),
    ["build"],
    resolve(root, "apps/web"),
  ],
  [
    resolve(root, "node_modules/playwright/cli.js"),
    ["test", "--config", "playwright.auth.config.ts", ...process.argv.slice(2)],
    resolve(root, "apps/web"),
  ],
]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
