import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteBucketPolicyCommand,
  PutBucketPolicyCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { parseEnvironment } from "../src/config/environment";
import { EnvironmentService } from "../src/config/environment.service";
import { PrivateStorageService } from "../src/video/private-storage.service";
import { configureIncomingExpiry } from "./video-storage-fixtures";

config();
describe("C037 native MinIO privacy", () => {
  const bucket = `vera-storage-test-${randomUUID()}`;
  const values = parseEnvironment({ ...process.env, MINIO_BUCKET: bucket });
  const client = new S3Client({
    endpoint: values.minio.endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: values.minio.accessKey,
      secretAccessKey: values.minio.secretKey,
    },
  });
  const storage = new PrivateStorageService({ values } as EnvironmentService);
  const key = storage.key("incoming");
  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await configureIncomingExpiry(client, bucket);
  });
  afterAll(async () => {
    try {
      await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
      await storage.remove(key);
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    } finally {
      storage.onModuleDestroy();
      client.destroy();
    }
  });
  it("uploads only signed MIME/length; denies anonymous reads and lists", async () => {
    const bytes = Buffer.from([
      0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
    ]);
    const url = await storage.uploadUrl(key, "video/mp4", bytes.length);
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );
    expect(
      (
        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: bytes,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "video/mp4" },
          body: bytes,
        })
      ).status,
    ).toBe(200);
    expect((await storage.inspect(key)).size).toBe(bytes.length);
    const publicUrl = `${values.minio.endpoint}/${bucket}/${key}`;
    expect((await fetch(publicUrl)).status).toBe(403);
    expect((await fetch(`${values.minio.endpoint}/${bucket}`)).status).toBe(
      403,
    );
    const playback = await storage.playbackUrl(key, "video/mp4");
    expect(new URL(playback).searchParams.get("X-Amz-Expires")).toBe("60");
    expect((await fetch(playback)).status).toBe(200);
    await storage.remove(key);
    expect((await fetch(playback)).status).toBe(404);
  });
  it("refuses a bucket with a public policy", async () => {
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: "*",
              Action: "s3:GetObject",
              Resource: `arn:aws:s3:::${bucket}/*`,
            },
          ],
        }),
      }),
    );
    await expect(storage.assertPrivate()).rejects.toMatchObject({
      status: 503,
    });
    await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
  });
});
