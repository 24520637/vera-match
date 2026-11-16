import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
export default async function teardown() {
  const root = resolve(__dirname, "../../..");
  const file = resolve(root, "apps/web/.video-e2e-runtime.json");
  let metadata: { kind: string; runId: string; schema: string; bucket: string };
  try {
    metadata = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    metadata.kind !== "vera-video-e2e-v1" ||
    metadata.runId !== process.env.VERA_VIDEO_E2E_RUN_ID ||
    !/^vera_auth_test_[a-f0-9]{32}$/.test(metadata.schema) ||
    !/^vera-video-e2e-[a-f0-9-]{36}$/.test(metadata.bucket)
  )
    throw Error("Unknown runtime; refusing cleanup");
  for (const env of ["apps/api/.env", ".env"]) {
    try {
      process.loadEnvFile(resolve(root, env));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  const endpoint = new URL(
    process.env.MINIO_ENDPOINT || "http://localhost:9000",
  );
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "5433" ||
    !["localhost", "127.0.0.1"].includes(endpoint.hostname) ||
    endpoint.port !== "9000"
  )
    throw Error("Local services required");
  const client = new PrismaClient({ log: [] });
  const storage = new S3Client({
    endpoint: endpoint.origin,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ROOT_USER!,
      secretAccessKey: process.env.MINIO_ROOT_PASSWORD!,
    },
  });
  try {
    const list = await storage.send(
      new ListObjectsV2Command({ Bucket: metadata.bucket }),
    );
    for (const item of list.Contents ?? [])
      await storage.send(
        new DeleteObjectCommand({ Bucket: metadata.bucket, Key: item.Key! }),
      );
    await storage.send(new DeleteBucketCommand({ Bucket: metadata.bucket }));
    await client.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${metadata.schema}" CASCADE`,
    );
  } finally {
    storage.destroy();
    await client.$disconnect();
  }
  await unlink(file);
}
