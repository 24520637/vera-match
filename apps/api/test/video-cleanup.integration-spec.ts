import { AssignmentCancellationService } from "../src/assignment-cancellation/assignment-cancellation.service";
import { VideoService } from "../src/video/video.service";
import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { parseEnvironment } from "../src/config/environment";
import { EnvironmentService } from "../src/config/environment.service";
import { PrismaService } from "../src/database/prisma.service";
import { PrivateStorageService } from "../src/video/private-storage.service";
import { VideoCleanupService } from "../src/video/video-cleanup.service";
import { createAuthDatabase } from "./disposable-auth-database";
import { ConsentService } from "../src/consent/consent.service";
import { ConsentPolicyRegistry } from "../src/consent/consent.policy";

config();
describe("Video cleanup outage recovery / disposable PostgreSQL / native MinIO", () => {
  let database: Awaited<ReturnType<typeof createAuthDatabase>>;
  let offline: PrismaClient;
  let storage: PrivateStorageService,
    client: S3Client,
    environment: EnvironmentService;
  const bucket = `vera-cleanup-test-${randomUUID()}`;
  beforeAll(async () => {
    database = await createAuthDatabase();
    const values = parseEnvironment({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: database.url,
      MINIO_BUCKET: bucket,
    });
    environment = { values } as EnvironmentService;
    storage = new PrivateStorageService(environment);
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
    const disconnected = new URL(database.url);
    disconnected.hostname = "127.0.0.1";
    disconnected.port = "1";
    disconnected.searchParams.set("connect_timeout", "1");
    disconnected.searchParams.set("pool_timeout", "1");
    offline = new PrismaClient({
      datasources: { db: { url: disconnected.toString() } },
      log: [],
    });
  }, 60000);
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      if (client) {
        const list = await client.send(
          new ListObjectsV2Command({ Bucket: bucket }),
        );
        for (const item of list.Contents ?? [])
          await client.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: item.Key! }),
          );
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
    } finally {
      storage?.onModuleDestroy();
      client?.destroy();
      await offline?.$disconnect();
      await database?.close();
    }
  });
  async function fixture() {
    const user = await database.client.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: "SYNTHETIC-ONLY",
      },
    });
    const key = storage.key("video");
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from([
          0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
        ]),
        ContentType: "video/mp4",
      }),
    );
    const video = await database.client.video.create({
      data: {
        ownerId: user.id,
        bucket,
        objectKey: key,
        mimeType: "video/mp4",
        sizeBytes: 12,
        status: "DELETED",
        deletedAt: new Date(),
      },
    });
    const task = await database.client.videoCleanupTask.create({
      data: { videoId: video.id, bucket, objectKey: key },
    });
    // Provider capability for synthetic fixture verification, not an auth route.
    const url = await storage.playbackUrl(key, "video/mp4");
    return { video, task, url };
  }
  async function verifyComplete(id: string, url: string) {
    expect(
      (
        await database.client.videoCleanupTask.findUniqueOrThrow({
          where: { videoId: id },
        })
      ).status,
    ).toBe("COMPLETE");
    expect(
      (await database.client.video.findUniqueOrThrow({ where: { id } }))
        .cleanupCompletedAt,
    ).not.toBeNull();
    expect((await fetch(url)).status).toBe(404);
  }
  test("missing subject mappings do not starve a later live withdrawal or get falsely acknowledged", async () => {
    const consents = new ConsentService(
      database.client as PrismaService,
      new ConsentPolicyRegistry(),
      environment,
    );
    async function member() {
      return database.client.user.create({
        data: {
          email: `${randomUUID()}@example.invalid`,
          passwordHash: "SYNTHETIC-ONLY",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
    }
    const orphanTasks: string[] = [];
    for (let index = 0; index < 20; index++) {
      const user = await member();
      await consents.patch(
        user.id,
        {
          expectedVersion: 0,
          consents: [{ purpose: "VIDEO_STORAGE", granted: false }],
        },
        randomUUID(),
      );
      const ledger = await database.client.consentLedger.findUniqueOrThrow({
        where: { userId: user.id },
      });
      const task = await database.client.consentWithdrawalTask.findFirstOrThrow(
        { where: { subjectId: ledger.subjectId } },
      );
      orphanTasks.push(task.id);
      await database.client.user.delete({ where: { id: user.id } });
    }
    const user = await member(),
      key = storage.key("video");
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.alloc(12),
        ContentType: "video/mp4",
      }),
    );
    const video = await database.client.video.create({
      data: {
        ownerId: user.id,
        bucket,
        objectKey: key,
        mimeType: "video/mp4",
        status: "READY",
        storageConsentVersion: 0n,
      },
    });
    await consents.patch(
      user.id,
      {
        expectedVersion: 0,
        consents: [{ purpose: "VIDEO_STORAGE", granted: false }],
      },
      randomUUID(),
    );
    await new VideoCleanupService(
      database.client as PrismaService,
      storage,
      environment,
    ).runOnce();
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: video.id },
        })
      ).status,
    ).toBe("DELETED");
    expect(
      await database.client.consentWithdrawalTask.count({
        where: { id: { in: orphanTasks }, status: "PENDING" },
      }),
    ).toBe(20);
    expect(
      await database.client.videoWithdrawalReceipt.count({
        where: { withdrawalTaskId: { in: orphanTasks } },
      }),
    ).toBe(0);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      "VIDEO_CLEANUP_WITHDRAWAL_MAPPING_UNAVAILABLE",
    );
    await verifyComplete(video.id, await storage.playbackUrl(key, "video/mp4"));
  });
  test("an unreachable PostgreSQL connection leaves jobs intact and a later scan recovers", async () => {
    const { video, task, url } = await fixture();
    let active: PrismaClient = offline;
    const proxy = new Proxy({} as PrismaService, {
      get(_target, key) {
        const value = Reflect.get(active, key);
        return typeof value === "function" ? value.bind(active) : value;
      },
    });
    const worker = new VideoCleanupService(proxy, storage, environment);
    await expect(worker.runOnce()).rejects.toBeInstanceOf(
      Prisma.PrismaClientInitializationError,
    );
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "VIDEO_CLEANUP_SCAN_FAILED",
    );
    expect(
      await database.client.videoCleanupTask.findUniqueOrThrow({
        where: { id: task.id },
      }),
    ).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: video.id },
        })
      ).cleanupCompletedAt,
    ).toBeNull();
    expect((await fetch(url)).status).toBe(200);
    active = database.client;
    await worker.runOnce();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "VIDEO_CLEANUP_SCAN_RECOVERED",
    );
    await verifyComplete(video.id, url);
  });
  test("an unreachable MinIO endpoint persists a retry without claiming erasure", async () => {
    const { video, task, url } = await fixture();
    const unavailable = new PrivateStorageService({
      values: {
        ...environment.values,
        minio: { ...environment.values.minio, endpoint: "http://127.0.0.1:1" },
      },
    } as EnvironmentService);
    try {
      await new VideoCleanupService(
        database.client as PrismaService,
        unavailable,
        environment,
      ).runOnce();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        "VIDEO_CLEANUP_RETRY_SCHEDULED",
      );
      expect(
        await database.client.videoCleanupTask.findUniqueOrThrow({
          where: { id: task.id },
        }),
      ).toMatchObject({
        status: "PENDING",
        lastErrorCode: "STORAGE_CLEANUP_FAILED",
        completedAt: null,
      });
      expect(
        (
          await database.client.video.findUniqueOrThrow({
            where: { id: video.id },
          })
        ).cleanupCompletedAt,
      ).toBeNull();
      expect((await fetch(url)).status).toBe(200);
      await database.client.videoCleanupTask.update({
        where: { id: task.id },
        data: { nextAttemptAt: new Date(0) },
      });
      await new VideoCleanupService(
        database.client as PrismaService,
        storage,
        environment,
      ).runOnce();
      await verifyComplete(video.id, url);
    } finally {
      unavailable.onModuleDestroy();
    }
  });
  test("PostgreSQL loss after verified provider deletion preserves the lease until safe retry", async () => {
    const { video, task, url } = await fixture();
    let active: PrismaClient = database.client;
    let disconnectAtFinalization = true;
    let providerVerified = false;
    const remove = storage.remove.bind(storage);
    jest.spyOn(storage, "remove").mockImplementation(async (key) => {
      await remove(key);
      if (key === video.objectKey) providerVerified = true;
    });
    const proxy = new Proxy({} as PrismaService, {
      get(_target, key) {
        if (
          key === "$transaction" &&
          disconnectAtFinalization &&
          providerVerified
        ) {
          disconnectAtFinalization = false;
          active = offline;
        }
        const value = Reflect.get(active, key);
        return typeof value === "function" ? value.bind(active) : value;
      },
    });
    const worker = new VideoCleanupService(proxy, storage, environment);
    await expect(worker.runOnce()).rejects.toBeInstanceOf(
      Prisma.PrismaClientInitializationError,
    );
    expect(providerVerified).toBe(true);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "VIDEO_CLEANUP_SCAN_FAILED",
    );
    expect((await fetch(url)).status).toBe(404);
    expect(
      await database.client.videoCleanupTask.findUniqueOrThrow({
        where: { id: task.id },
      }),
    ).toMatchObject({ status: "RUNNING", attempts: 1, completedAt: null });
    expect(
      (
        await database.client.video.findUniqueOrThrow({
          where: { id: video.id },
        })
      ).cleanupCompletedAt,
    ).toBeNull();
    // The failed scan has settled. Advance only this isolated fixture's lease.
    await database.client.videoCleanupTask.update({
      where: { id: task.id },
      data: { nextAttemptAt: new Date(0) },
    });
    active = database.client;
    await worker.runOnce();
    await verifyComplete(video.id, url);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "VIDEO_CLEANUP_SCAN_RECOVERED",
    );
  });

  test.each(["before", "after"] as const)(
    "owner DELETE %s claim preserves full cleanup until provider verification",
    async (timing) => {
      const { video, task, url } = await fixture();
      const uploadKey = storage.key("incoming"),
        uploadExpiresAt = new Date(0);
      await database.client.user.update({
        where: { id: video.ownerId },
        data: { status: "ACTIVE", emailVerifiedAt: new Date() },
      });
      await database.client.video.update({
        where: { id: video.id },
        data: { status: "READY", deletedAt: null, uploadKey, uploadExpiresAt },
      });
      await database.client.videoCleanupTask.update({
        where: { id: task.id },
        data: { removeFinal: false, uploadKey, uploadExpiresAt },
      });
      const remove = new VideoService(
        database.client as PrismaService,
        null!,
        storage,
        new AssignmentCancellationService(database.client as PrismaService),
      );
      const delegate = database.client.videoCleanupTask;
      const update = delegate.updateMany.bind(delegate);
      let requeued = false;
      const updateClaim = async (
        args: Prisma.VideoCleanupTaskUpdateManyArgs,
      ) => {
        if (
          timing === "after" &&
          !requeued &&
          args.where?.id === task.id &&
          args.data.status === "RUNNING"
        ) {
          requeued = true;
          const result = await update(args);
          await remove.remove(video.ownerId, video.id);
          return result;
        }
        return update(args);
      };
      const proxy = new Proxy(database.client as PrismaService, {
        get(target, key) {
          if (key === "videoCleanupTask")
            return new Proxy(delegate, {
              get(model, method) {
                if (method === "updateMany") return updateClaim;
                if (method === "findMany")
                  return async (args: Prisma.VideoCleanupTaskFindManyArgs) => {
                    const rows = await model.findMany(args);
                    if (
                      timing === "before" &&
                      !requeued &&
                      rows.some((row) => row.id === task.id)
                    ) {
                      requeued = true;
                      await remove.remove(video.ownerId, video.id);
                    }
                    return rows;
                  };
                const value = Reflect.get(model, method);
                return typeof value === "function" ? value.bind(model) : value;
              },
            });
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const worker = new VideoCleanupService(proxy, storage, environment);
      await worker.runOnce();
      expect(requeued).toBe(true);
      expect(
        await delegate.findUniqueOrThrow({ where: { id: task.id } }),
      ).toMatchObject({
        status: "PENDING",
        removeFinal: true,
        completedAt: null,
      });
      expect(
        (
          await database.client.video.findUniqueOrThrow({
            where: { id: video.id },
          })
        ).cleanupCompletedAt,
      ).toBeNull();
      expect((await fetch(url)).status).toBe(200);
      await worker.runOnce();
      await verifyComplete(video.id, url);
    },
  );
});
