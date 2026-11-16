import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomBytes, randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { AppModule } from "../src/app.module";
import { EnvironmentService } from "../src/config/environment.service";
import { parseEnvironment } from "../src/config/environment";
import { PrismaService } from "../src/database/prisma.service";
import {
  ConsentPolicyRegistry,
  PolicySnapshot,
} from "../src/consent/consent.policy";
import { ConsentPurpose } from "@prisma/client";
import { configureApplication } from "../src/configure-app";
import { hashSessionToken } from "../src/auth/session-token";
import { createAuthDatabase } from "./disposable-auth-database";

class VideoTestPolicies extends ConsentPolicyRegistry {
  override current(purpose: ConsentPurpose): PolicySnapshot {
    return {
      purpose,
      policyVersion: "synthetic-video-v1",
      locale: "en-test",
      testOnly: true,
      content: `TEST ONLY video policy ${purpose}`,
    };
  }
}
describe("Private video / real PostgreSQL / native MinIO", () => {
  let database: Awaited<ReturnType<typeof createAuthDatabase>>;
  let app: INestApplication, base: string, client: S3Client;
  const bucket = `vera-video-test-${randomUUID()}`;
  const origin = "http://localhost:3000";
  beforeAll(async () => {
    database = await createAuthDatabase();
    const values = parseEnvironment({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: database.url,
      MINIO_BUCKET: bucket,
      CORS_ORIGIN: origin,
    });
    client = new S3Client({
      endpoint: values.minio.endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: values.minio.accessKey,
        secretAccessKey: values.minio.secretKey,
      },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EnvironmentService)
      .useValue({ values })
      .overrideProvider(PrismaService)
      .useValue(database.client)
      .overrideProvider(ConsentPolicyRegistry)
      .useClass(VideoTestPolicies)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  }, 60000);
  afterAll(async () => {
    try {
      await app?.close();
      if (client) {
        const items = await client.send(
          new ListObjectsV2Command({ Bucket: bucket }),
        );
        for (const item of items.Contents ?? [])
          await client.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: item.Key! }),
          );
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
    } finally {
      client?.destroy();
      await database?.close();
    }
  });
  async function member() {
    const token = randomBytes(32).toString("base64url");
    const user = await database.client.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: "synthetic-not-for-login",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        sessions: {
          create: {
            tokenHash: hashSessionToken(token),
            expiresAt: new Date(Date.now() + 600000),
          },
        },
      },
    });
    return {
      id: user.id,
      cookie: `${app.get(EnvironmentService).values.session.cookieName}=${token}`,
    };
  }
  const request = (
    cookie: string,
    path: string,
    body: unknown = {},
    method = "POST",
  ) =>
    fetch(`${base}/api/${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
  async function grant(cookie: string) {
    const result = await request(
      cookie,
      "consents/me",
      {
        expectedVersion: 0,
        consents: [
          {
            purpose: "VIDEO_STORAGE",
            granted: true,
            policyVersion: "synthetic-video-v1",
          },
        ],
      },
      "PATCH",
    );
    expect(result.status).toBe(200);
  }
  const valid = { mimeType: "video/mp4", sizeBytes: 12 };
  const videoBytes = Buffer.from([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
  ]);
  async function intent(cookie: string) {
    const response = await request(cookie, "videos/upload-intent", valid);
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; uploadUrl: string };
  }
  const put = (url: string, bytes = videoBytes) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: bytes,
    });
  it("confirms only actual valid objects, serializes duplicate confirmations and isolates playback from re-upload", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    expect(
      (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
    ).toBe(503);
    await put(upload.uploadUrl, Buffer.from("spoofed-file".padEnd(12)));
    expect(
      (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
    ).toBe(409);
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: upload.id },
        })
      ).status,
    ).toBe("UPLOADING");
    expect((await put(upload.uploadUrl)).status).toBe(200);
    const confirmations = await Promise.all([
      request(user.cookie, `videos/${upload.id}/confirm`),
      request(user.cookie, `videos/${upload.id}/confirm`),
    ]);
    expect(confirmations.map((x) => x.status)).toEqual([201, 201]);
    const row = await database.client.video.findUniqueOrThrow({
      where: { id: upload.id },
    });
    expect(row.status).toBe("READY");
    await put(upload.uploadUrl, Buffer.from("spoofed-file".padEnd(12)));
    const { PrivateStorageService } =
      await import("../src/video/private-storage.service");
    const checked = await app.get(PrivateStorageService).inspect(row.objectKey);
    expect(Buffer.from(checked.prefix)).toEqual(videoBytes);
    const other = await member();
    await grant(other.cookie);
    expect(
      (await request(other.cookie, `videos/${upload.id}/confirm`)).status,
    ).toBe(404);
    expect(
      (
        await request(user.cookie, `videos/${upload.id}/confirm`, {
          status: "READY",
        })
      ).status,
    ).toBe(400);
  });
  it("rejects expired uploads and changed signed lengths", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    expect((await put(upload.uploadUrl, Buffer.alloc(13))).status).toBe(403);
    await put(upload.uploadUrl);
    await database.client.video.update({
      where: { id: upload.id },
      data: { uploadExpiresAt: new Date(0) },
    });
    expect(
      (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
    ).toBe(409);
  });
  it("requires a session, current actual consent, safe metadata and session-derived owner", async () => {
    expect((await request("", "videos/upload-intent", valid)).status).toBe(401);
    const user = await member();
    expect(
      (await request(user.cookie, "videos/upload-intent", valid)).status,
    ).toBe(403);
    await grant(user.cookie);
    for (const body of [
      { ...valid, ownerId: "another-user" },
      { ...valid, mimeType: "text/plain" },
      { ...valid, sizeBytes: 104857601 },
      { ...valid, sizeBytes: 0 },
    ])
      expect(
        (await request(user.cookie, "videos/upload-intent", body)).status,
      ).toBe(400);
    const result = await request(user.cookie, "videos/upload-intent", valid);
    expect(result.status).toBe(201);
    expect(result.headers.get("cache-control")).toContain("no-store");
    const intent = (await result.json()) as { id: string; uploadUrl: string };
    expect(intent).toMatchObject({
      status: "UPLOADING",
      headers: { "Content-Type": "video/mp4" },
    });
    expect(intent).not.toHaveProperty("objectKey");
    expect(new URL(intent.uploadUrl).searchParams.get("X-Amz-Expires")).toBe(
      "300",
    );
    const row = await database.client.video.findUniqueOrThrow({
      where: { id: intent.id },
    });
    expect(row.ownerId).toBe(user.id);
    expect(row.uploadKey).not.toBe(row.objectKey);
  });
});
