const { readFile, unlink } = require("node:fs/promises");
const { resolve } = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteBucketCommand } = require("@aws-sdk/client-s3");

const manifestPath = resolve(__dirname, "../apps/web/.video-e2e-runtime.json");

function fixtureEndpoints(env) {
  const database = new URL(env.DATABASE_URL || "");
  const minio = new URL(env.MINIO_ENDPOINT || "http://localhost:9000");
  if (!["postgresql:", "postgres:"].includes(database.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.port !== "5433" ||
      minio.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(minio.hostname) || minio.port !== "9000")
    throw new Error("Isolated local services required");
  return { database, minio };
}

async function verifyBucketWritable(storage, bucket) {
  try {
    await storage.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "fixture-write-probe",
      Body: Buffer.from("synthetic video fixture storage probe\n"),
    }), { abortSignal: AbortSignal.timeout(5000) });
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const code = /^[a-z0-9_-]{1,80}$/i.test(error?.name ?? "") ? error.name : undefined;
    const detail = [Number.isInteger(status) ? `HTTP ${status}` : undefined, code].filter(Boolean);
    return { writable: false, detail: detail.join(", ") };
  }
  return { writable: true };
}

async function deleteBucket(bucket, endpoint, env) {
  const storage = new S3Client({
    endpoint: endpoint.origin, region: "us-east-1", forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: env.MINIO_ROOT_USER, secretAccessKey: env.MINIO_ROOT_PASSWORD },
  });
  const send = command => storage.send(command, { abortSignal: AbortSignal.timeout(5000) });
  try {
    // Always list from the beginning after deleting a page.
    for (;;) {
      const page = await send(new ListObjectsV2Command({ Bucket: bucket }));
      const objects = page.Contents ?? [];
      if (!objects.length) break;
      for (const object of objects) await send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
    }
    await send(new DeleteBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (error.name !== "NoSuchBucket") throw error;
  } finally {
    storage.destroy();
  }
}

async function dropSchema(schema, database) {
  // The name was generated for this invocation and checked against the manifest below.
  const client = new PrismaClient({ datasourceUrl: database.toString(), log: [] });
  try {
    await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.$disconnect();
  }
}

async function cleanupVideoFixture(env, {
  file = manifestPath, removeBucket = deleteBucket, removeSchema = dropSchema,
} = {}) {
  let fixture;
  try {
    fixture = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (fixture?.kind !== "vera-video-e2e-v1" ||
      !/^[a-f0-9-]{36}$/.test(env.VERA_VIDEO_E2E_RUN_ID || "") ||
      fixture.runId !== env.VERA_VIDEO_E2E_RUN_ID ||
      !/^vera_auth_test_[a-f0-9]{32}$/.test(fixture.schema) ||
      !/^vera-video-e2e-[a-f0-9-]{36}$/.test(fixture.bucket))
    throw new Error("Unknown runtime; refusing cleanup");
  const { database, minio } = fixtureEndpoints(env);
  const results = await Promise.allSettled([
    removeBucket(fixture.bucket, minio, env),
    removeSchema(fixture.schema, database),
  ]);
  // Keep the ownership record so the runner can retry after partial cleanup.
  if (results.some(result => result.status === "rejected"))
    throw new Error("Unable to clean all owned video fixtures; retained the runtime manifest");
  await unlink(file);
}

module.exports = { cleanupVideoFixture, fixtureEndpoints, manifestPath, verifyBucketWritable };
