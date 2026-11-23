import { resolve } from "node:path";

const { cleanupVideoFixture } = require("../../../scripts/video-e2e-fixtures.cjs");

export default async function teardown() {
  const root = resolve(__dirname, "../../..");
  for (const env of ["apps/api/.env", ".env"]) {
    try {
      process.loadEnvFile(resolve(root, env));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await cleanupVideoFixture(process.env);
}
