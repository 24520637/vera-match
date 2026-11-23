// Test-only cold-process reconciliation. Never accepts an ordinary database/bucket.
const { URL } = require("node:url");
async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  const storage = new URL(process.env.MINIO_ENDPOINT || "");
  if (process.env.NODE_ENV !== "test" || url.port !== "5433" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !/^vera_auth_test_[a-f0-9]{32}$/.test(url.searchParams.get("schema") || "") ||
      !["localhost", "127.0.0.1", "[::1]"].includes(storage.hostname) ||
      !/^vera-security-test-[a-f0-9-]{36}$/.test(process.env.MINIO_BUCKET || "")) {
    throw Error("Disposable local workflow fixtures required");
  }
  const { NestFactory } = require("@nestjs/core");
  const { AppModule } = require("../dist/app.module");
  const { EnvironmentService } = require("../dist/config/environment.service");
  const { AssignmentCancellationWorker } = require("../dist/assignment-cancellation/assignment-cancellation.worker");
  const { VideoCleanupService } = require("../dist/video/video-cleanup.service");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const values = app.get(EnvironmentService).values;
    if (values.nodeEnv !== "test" || values.databaseUrl !== process.env.DATABASE_URL ||
        values.minio.bucket !== process.env.MINIO_BUCKET) throw Error("Fixture configuration mismatch");
    await app.get(AssignmentCancellationWorker).runOnce();
    await app.get(VideoCleanupService).runOnce();
    console.log("PASS isolated workflow worker process");
  } finally { await app.close(); }
}
main().catch(() => { console.error("WORKFLOW_FIXTURE_RESTART_FAILED"); process.exitCode = 1; });
