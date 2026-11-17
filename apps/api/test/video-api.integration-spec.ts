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
import { VideoCleanupService } from "../src/video/video-cleanup.service";
import { PrivateStorageService } from "../src/video/private-storage.service";
import { configureIncomingExpiry } from "./video-storage-fixtures";

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
    await configureIncomingExpiry(client, bucket);
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
  it("rejects test-only consent evidence for video access outside the test environment", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    expect(
      (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
    ).toBe(201);
    const environment = app.get(EnvironmentService),
      previous = environment.values;
    try {
      for (const nodeEnv of ["development", "production"] as const) {
        Object.defineProperty(environment, "values", {
          value: { ...previous, nodeEnv },
          configurable: true,
        });
        expect(
          (await request(user.cookie, "videos/upload-intent", valid)).status,
        ).toBe(403);
        expect(
          (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
        ).toBe(403);
        expect(
          (await request(user.cookie, `videos/${upload.id}/playback`)).status,
        ).toBe(403);
        expect(
          (
            await request(
              user.cookie,
              "consents/me",
              {
                expectedVersion: 1,
                consents: [
                  {
                    purpose: "VIDEO_STORAGE",
                    granted: true,
                    policyVersion: "synthetic-video-v1",
                  },
                ],
              },
              "PATCH",
            )
          ).status,
        ).toBe(400);
        // Safe own metadata and deletion never require granting consent again.
        expect(
          (await request(user.cookie, "videos/me", {}, "GET")).status,
        ).toBe(200);
      }
      expect(
        (await request(user.cookie, `videos/${upload.id}`, {}, "DELETE"))
          .status,
      ).toBe(202);
    } finally {
      Object.defineProperty(environment, "values", {
        value: previous,
        configurable: true,
      });
    }
  });
  it("does not delete final media when reaping incoming bytes for an under-review video", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    await request(user.cookie, `videos/${upload.id}/confirm`);
    const row = await database.client.video.update({
      where: { id: upload.id },
      data: { status: "UNDER_REVIEW", uploadExpiresAt: new Date(0) },
    });
    await app.get(VideoCleanupService).runOnce();
    expect(
      (await database.client.video.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe("UNDER_REVIEW");
    expect(
      (await app.get(PrivateStorageService).inspect(row.objectKey)).size,
    ).toBe(12);
    expect(
      (
        await database.client.videoCleanupTask.findUniqueOrThrow({
          where: { videoId: row.id },
        })
      ).removeFinal,
    ).toBe(false);
  });
  it("serializes URL issuance against withdrawal using the shared database lock", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    await request(user.cookie, `videos/${upload.id}/confirm`);
    const storage = app.get(PrivateStorageService);
    const original = storage.playbackUrl.bind(storage);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest
      .spyOn(storage, "playbackUrl")
      .mockImplementationOnce(async (key, mime) => {
        entered();
        await gate;
        return original(key, mime);
      });
    try {
      const issuance = request(user.cookie, `videos/${upload.id}/playback`);
      await started;
      const withdrawal = request(
        user.cookie,
        "consents/me",
        {
          expectedVersion: 1,
          consents: [{ purpose: "VIDEO_STORAGE", granted: false }],
        },
        "PATCH",
      );
      release();
      expect((await issuance).status).toBe(201);
      expect((await withdrawal).status).toBe(200);
      expect(
        (await request(user.cookie, `videos/${upload.id}/playback`)).status,
      ).toBe(403);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it("serializes confirmation and deletion and cleans a lost storage acknowledgement safely", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    const storage = app.get(PrivateStorageService);
    const originalPromote = storage.promote.bind(storage);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest
      .spyOn(storage, "promote")
      .mockImplementationOnce(async (...args) => {
        entered();
        await gate;
        return originalPromote(...args);
      });
    try {
      const confirmation = request(user.cookie, `videos/${upload.id}/confirm`);
      await started;
      const deletion = request(
        user.cookie,
        `videos/${upload.id}`,
        {},
        "DELETE",
      );
      release();
      expect((await confirmation).status).toBe(201);
      expect((await deletion).status).toBe(202);
      expect(
        (await request(user.cookie, `videos/${upload.id}/playback`)).status,
      ).toBe(404);
    } finally {
      release();
      spy.mockRestore();
    }
    const row = await database.client.video.findUniqueOrThrow({
      where: { id: upload.id },
    });
    const originalRemove = storage.remove.bind(storage);
    let lost = false;
    const loss = jest
      .spyOn(storage, "remove")
      .mockImplementation(async (key) => {
        await originalRemove(key);
        if (key === row.objectKey && !lost) {
          lost = true;
          throw Error("synthetic lost acknowledgement");
        }
      });
    await app.get(VideoCleanupService).runOnce();
    loss.mockRestore();
    expect(
      await database.client.videoCleanupTask.findUniqueOrThrow({
        where: { videoId: row.id },
      }),
    ).toMatchObject({
      status: "PENDING",
      lastErrorCode: "STORAGE_CLEANUP_FAILED",
    });
    expect(lost).toBe(true);
    await database.client.videoCleanupTask.update({
      where: { videoId: row.id },
      data: { uploadExpiresAt: new Date(0), nextAttemptAt: new Date(0) },
    });
    await new VideoCleanupService(
      app.get(PrismaService),
      storage,
      app.get(EnvironmentService),
    ).runOnce();
    expect(
      (
        await database.client.videoCleanupTask.findUniqueOrThrow({
          where: { videoId: row.id },
        })
      ).status,
    ).toBe("COMPLETE");
  });
  it("rejects a source replacement between validation and conditional promotion", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    const storage = app.get(PrivateStorageService),
      promote = storage.promote.bind(storage);
    const spy = jest
      .spyOn(storage, "promote")
      .mockImplementationOnce(async (...args) => {
        await put(upload.uploadUrl, Buffer.from("replaced".padEnd(12)));
        return promote(...args);
      });
    try {
      expect(
        (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
      ).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: upload.id },
        })
      ).status,
    ).toBe("UPLOADING");
  });
  it("writes minimal privacy audit events atomically and never returns a URL after audit failure", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    await request(user.cookie, `videos/${upload.id}/confirm`);
    expect(
      (
        await request(
          user.cookie,
          "videos/attacker-selected-private-value/playback",
        )
      ).status,
    ).toBe(404);
    const denial = await database.client.auditLog.findFirstOrThrow({
      where: { actorId: user.id, action: "VIDEO_ACCESS_DENIED" },
    });
    expect(denial.subjectId).toBeNull();
    await database.client.$executeRawUnsafe(
      `CREATE FUNCTION video_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'VIDEO_PLAYBACK_ISSUED' THEN RAISE EXCEPTION 'synthetic-private-value'; END IF; RETURN NEW; END $$`,
    );
    await database.client.$executeRawUnsafe(
      `CREATE TRIGGER video_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION video_audit_failure()`,
    );
    try {
      const response = await request(
        user.cookie,
        `videos/${upload.id}/playback`,
      );
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).not.toMatch(
        /synthetic-private-value|X-Amz|Signature|objectKey/,
      );
      expect(
        await database.client.auditLog.count({
          where: { actorId: user.id, action: "VIDEO_PLAYBACK_ISSUED" },
        }),
      ).toBe(0);
    } finally {
      await database.client.$executeRawUnsafe(
        `DROP TRIGGER video_audit_failure ON "AuditLog"`,
      );
      await database.client.$executeRawUnsafe(
        `DROP FUNCTION video_audit_failure()`,
      );
    }
    expect(
      (await request(user.cookie, `videos/${upload.id}/playback`)).status,
    ).toBe(201);
    await request(user.cookie, `videos/${upload.id}`, {}, "DELETE");
    const audits = await database.client.auditLog.findMany({
      where: { actorId: user.id, subjectType: "Video" },
    });
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "VIDEO_UPLOAD_CONFIRMED",
        "VIDEO_ACCESS_DENIED",
        "VIDEO_PLAYBACK_ISSUED",
        "VIDEO_DELETE_REQUESTED",
      ]),
    );
    expect(JSON.stringify(audits)).not.toMatch(
      /attacker-selected|X-Amz|Signature|incoming\/|video\/|example.invalid|passwordHash/,
    );
  });
  it("never resurrects a withdrawn video on re-consent and never deletes a newly authorized generation", async () => {
    const user = await member();
    await grant(user.cookie);
    const old = await intent(user.cookie);
    await put(old.uploadUrl);
    await request(user.cookie, `videos/${old.id}/confirm`);
    expect(
      (
        await request(
          user.cookie,
          "consents/me",
          {
            expectedVersion: 1,
            consents: [{ purpose: "VIDEO_STORAGE", granted: false }],
          },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          user.cookie,
          "consents/me",
          {
            expectedVersion: 2,
            consents: [
              {
                purpose: "VIDEO_STORAGE",
                granted: true,
                policyVersion: "synthetic-video-v1",
              },
            ],
          },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      (await request(user.cookie, `videos/${old.id}/playback`)).status,
    ).toBe(409);
    expect(
      (await request(user.cookie, `videos/${old.id}/confirm`)).status,
    ).toBe(409);
    const fresh = await intent(user.cookie);
    await put(fresh.uploadUrl);
    await request(user.cookie, `videos/${fresh.id}/confirm`);
    await app.get(VideoCleanupService).runOnce();
    expect(
      (await database.client.video.findUniqueOrThrow({ where: { id: old.id } }))
        .status,
    ).toBe("DELETED");
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: fresh.id },
        })
      ).status,
    ).toBe("READY");
    expect(
      (await request(user.cookie, `videos/${fresh.id}/playback`)).status,
    ).toBe(201);
    const ledger = await database.client.consentLedger.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const task = await database.client.consentWithdrawalTask.findFirstOrThrow({
      where: { subjectId: ledger.subjectId, purpose: "VIDEO_STORAGE" },
    });
    expect(task.status).toBe("PENDING"); // Other domain consumers still own their work.
    expect(
      await database.client.videoWithdrawalReceipt.findUnique({
        where: { withdrawalTaskId: task.id },
      }),
    ).not.toBeNull();
  });
  it("reaps abandoned uploads and incoming bytes without deleting ready playback objects", async () => {
    const user = await member();
    await grant(user.cookie);
    const abandoned = await intent(user.cookie);
    await put(abandoned.uploadUrl);
    const ready = await intent(user.cookie);
    await put(ready.uploadUrl);
    await request(user.cookie, `videos/${ready.id}/confirm`);
    await database.client.video.updateMany({
      where: { id: { in: [abandoned.id, ready.id] } },
      data: { uploadExpiresAt: new Date(0) },
    });
    await app.get(VideoCleanupService).runOnce();
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: abandoned.id },
        })
      ).status,
    ).toBe("DELETED");
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: ready.id },
        })
      ).uploadKey,
    ).toBeNull();
    expect(
      (await request(user.cookie, `videos/${ready.id}/playback`)).status,
    ).toBe(201);
  });
  it("deletes access atomically, persists storage failures and safely retries after restart", async () => {
    const user = await member();
    await grant(user.cookie);
    const other = await member();
    await grant(other.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    await request(user.cookie, `videos/${upload.id}/confirm`);
    const playback = (await (
      await request(user.cookie, `videos/${upload.id}/playback`)
    ).json()) as { url: string };
    expect(
      (await request(other.cookie, `videos/${upload.id}`, {}, "DELETE")).status,
    ).toBe(404);
    expect(
      (await request(user.cookie, `videos/${upload.id}`, {}, "DELETE")).status,
    ).toBe(202);
    expect(
      (await request(user.cookie, `videos/${upload.id}/playback`)).status,
    ).toBe(404);
    expect(
      (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
    ).toBe(409);
    const storage = app.get(PrivateStorageService);
    const target = await database.client.video.findUniqueOrThrow({
      where: { id: upload.id },
    });
    const realRemove = storage.remove.bind(storage);
    const failure = jest
      .spyOn(storage, "remove")
      .mockImplementation(async (key) => {
        if (key === target.objectKey)
          throw Error("synthetic private storage failure");
        return realRemove(key);
      });
    await app.get(VideoCleanupService).runOnce();
    failure.mockRestore();
    const job = await database.client.videoCleanupTask.findUniqueOrThrow({
      where: { videoId: upload.id },
    });
    expect(job).toMatchObject({
      status: "PENDING",
      lastErrorCode: "STORAGE_CLEANUP_FAILED",
    });
    expect((await fetch(playback.url)).status).toBe(200);
    // Simulate a later durable retry in a fresh worker, rather than waiting 5 minutes.
    await database.client.videoCleanupTask.update({
      where: { id: job.id },
      data: { nextAttemptAt: new Date(0), uploadExpiresAt: new Date(0) },
    });
    const restarted = new VideoCleanupService(
      app.get(PrismaService),
      storage,
      app.get(EnvironmentService),
    );
    await restarted.runOnce();
    expect((await fetch(playback.url)).status).toBe(404);
    expect(
      await database.client.videoCleanupTask.findUniqueOrThrow({
        where: { id: job.id },
      }),
    ).toMatchObject({ status: "COMPLETE", lastErrorCode: null });
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: upload.id },
        })
      ).cleanupCompletedAt,
    ).not.toBeNull();
    expect(
      (await request(user.cookie, `videos/${upload.id}`, {}, "DELETE")).status,
    ).toBe(202);
    const requeued = await database.client.videoCleanupTask.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(requeued.status).toBe("PENDING");
    const metadata = (await (
      await request(user.cookie, "videos/me", {}, "GET")
    ).json()) as {
      videos: { id: string; cleanupCompletedAt: string | null }[];
    };
    expect(
      metadata.videos.find((video) => video.id === upload.id)
        ?.cleanupCompletedAt,
    ).toBeNull();
  });
  it("denies new access after actual consent withdrawal while acknowledging pre-issued bearer access", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    await request(user.cookie, `videos/${upload.id}/confirm`);
    const issued = await request(user.cookie, `videos/${upload.id}/playback`);
    const playback = (await issued.json()) as { url: string };
    const revoke = await request(
      user.cookie,
      "consents/me",
      {
        expectedVersion: 1,
        consents: [{ purpose: "VIDEO_STORAGE", granted: false }],
      },
      "PATCH",
    );
    expect(revoke.status).toBe(200);
    expect(
      (await request(user.cookie, `videos/${upload.id}/playback`)).status,
    ).toBe(403);
    expect(
      (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
    ).toBe(403);
    expect(
      (await request(user.cookie, "videos/upload-intent", valid)).status,
    ).toBe(403);
    // Revocation blocks API issuance immediately; it is not retroactive URL revocation.
    expect((await fetch(playback.url)).status).toBe(200);
  });
  it("denies staff/expert, changed accounts, malformed identity and cross-origin video requests", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    const crossOrigin = await fetch(`${base}/api/videos/${upload.id}/confirm`, {
      method: "POST",
      headers: {
        Cookie: user.cookie,
        Origin: "https://attacker.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);
    for (const role of ["EXPERT", "ADMIN", "MODERATOR"] as const) {
      await database.client.user.update({
        where: { id: user.id },
        data: { role },
      });
      expect(
        (await request(user.cookie, `videos/${upload.id}/playback`)).status,
      ).toBe(403);
    }
    await database.client.user.update({
      where: { id: user.id },
      data: { role: "MEMBER", status: "SUSPENDED" },
    });
    expect((await request(user.cookie, "videos/me", {}, "GET")).status).toBe(
      401,
    );
  });
  it("enforces the complete 60-second playback TTL on actual MinIO", async () => {
    const user = await member();
    await grant(user.cookie);
    const upload = await intent(user.cookie);
    await put(upload.uploadUrl);
    await request(user.cookie, `videos/${upload.id}/confirm`);
    const result = await request(user.cookie, `videos/${upload.id}/playback`);
    const playback = (await result.json()) as { url: string };
    expect((await fetch(playback.url)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 61000));
    expect((await fetch(playback.url)).status).toBe(403);
    expect(
      (await fetch(playback.url, { headers: { Range: "bytes=0-3" } })).status,
    ).toBe(403);
  }, 75000);
  it("lists only owner metadata and issues private playback only for ready owned videos", async () => {
    const user = await member();
    await grant(user.cookie);
    const other = await member();
    await grant(other.cookie);
    const upload = await intent(user.cookie);
    expect(
      (await request(user.cookie, `videos/${upload.id}/playback`)).status,
    ).toBe(404);
    await put(upload.uploadUrl);
    expect(
      (await request(user.cookie, `videos/${upload.id}/confirm`)).status,
    ).toBe(201);
    const list = await request(user.cookie, "videos/me", {}, "GET");
    const metadata = (await list.json()) as { videos: { id: string }[] };
    expect(metadata.videos.map((x) => x.id)).toContain(upload.id);
    expect(JSON.stringify(metadata)).not.toMatch(
      /objectKey|uploadKey|bucket|uploadUrl/,
    );
    const otherList = await request(other.cookie, "videos/me", {}, "GET");
    expect(await otherList.json()).toEqual({ videos: [] });
    expect(
      (await request(other.cookie, `videos/${upload.id}/playback`)).status,
    ).toBe(404);
    const response = await request(user.cookie, `videos/${upload.id}/playback`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const playback = (await response.json()) as { url: string };
    expect(new URL(playback.url).searchParams.get("X-Amz-Expires")).toBe("60");
    const media = await fetch(playback.url);
    expect(media.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await media.arrayBuffer())).toEqual(videoBytes);
  });
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
