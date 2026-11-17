import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { PrivateStorageService } from "./private-storage.service";

/** Durable at-least-once removal. No raw storage/SQL errors or object keys in logs. */
@Injectable()
export class VideoCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(VideoCleanupService.name);
  private scanFailed = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateStorageService,
    private readonly environment: EnvironmentService,
  ) {}
  onModuleInit() {
    // Tests explicitly drive the real worker to exercise failures and restart recovery.
    if (this.environment.values.nodeEnv === "test") return;
    this.timer = setInterval(() => {
      // runOnce reports failures without private error payloads. Consume the
      // rejection so one failed scan does not stop future scheduled retries.
      void this.runOnce().catch(() => undefined);
    }, 15000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    // Failure was already reported by runOnce; let the remaining services close
    // without passing a raw driver exception to the application shutdown logger.
    await this.running?.catch(() => undefined);
  }
  runOnce() {
    if (this.running) return this.running;
    this.running = this.process()
      .then(() => {
        if (this.scanFailed) this.logger.log("VIDEO_CLEANUP_SCAN_RECOVERED");
        this.scanFailed = false;
      })
      .catch((error: unknown) => {
        this.scanFailed = true;
        // Never forward error.message, stack, task IDs or driver/SDK metadata.
        this.logger.error("VIDEO_CLEANUP_SCAN_FAILED");
        throw error;
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async process() {
    await this.enqueueWithdrawals();
    await this.enqueueExpiredUploads();
    const tasks = await this.prisma.videoCleanupTask.findMany({
      where: {
        status: { in: ["PENDING", "RUNNING"] },
        nextAttemptAt: { lte: new Date() },
      },
      take: 20,
      orderBy: { nextAttemptAt: "asc" },
    });
    for (const task of tasks) {
      const claim = await this.prisma.videoCleanupTask.updateMany({
        where: {
          id: task.id,
          status: task.status,
          attempts: task.attempts,
          // Owner deletion can upgrade staging-only work after this scan. A
          // stale payload must remain pending for a fresh scan, not complete it.
          videoId: task.videoId,
          bucket: task.bucket,
          objectKey: task.objectKey,
          removeFinal: task.removeFinal,
          uploadKey: task.uploadKey,
          uploadExpiresAt: task.uploadExpiresAt,
          nextAttemptAt: { lte: new Date() },
        },
        data: {
          status: "RUNNING",
          attempts: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + 60000),
        },
      });
      if (!claim.count) continue;
      const lease = {
        id: task.id,
        status: "RUNNING",
        attempts: task.attempts + 1,
      };
      try {
        if (task.bucket !== this.storage.bucket)
          throw new Error("Storage configuration changed");
        if (task.removeFinal) await this.storage.remove(task.objectKey);
        if (task.uploadKey) await this.storage.remove(task.uploadKey);
        const waitForUploadExpiry =
          !!task.uploadKey &&
          !!task.uploadExpiresAt &&
          task.uploadExpiresAt > new Date();
        await this.prisma.$transaction(async (tx) => {
          const result = await tx.videoCleanupTask.updateMany({
            where: lease,
            data: {
              status: waitForUploadExpiry ? "PENDING" : "COMPLETE",
              lastErrorCode: null,
              nextAttemptAt: waitForUploadExpiry
                ? new Date(task.uploadExpiresAt!.getTime() + 1000)
                : new Date(),
              completedAt: waitForUploadExpiry ? null : new Date(),
            },
          });
          if (result.count && !waitForUploadExpiry && task.removeFinal)
            await tx.video.updateMany({
              where: { id: task.videoId, status: "DELETED" },
              data: { cleanupCompletedAt: new Date() },
            });
          if (result.count && !waitForUploadExpiry)
            await tx.video.updateMany({
              where: { id: task.videoId },
              data: { uploadKey: null },
            });
        });
      } catch {
        const retry = await this.prisma.videoCleanupTask.updateMany({
          where: lease,
          data: {
            status: "PENDING",
            lastErrorCode: "STORAGE_CLEANUP_FAILED",
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(3600000, 1000 * 2 ** Math.min(task.attempts + 1, 12)),
            ),
          },
        });
        if (retry.count) this.logger.warn("VIDEO_CLEANUP_RETRY_SCHEDULED");
      }
    }
  }
  private async enqueueWithdrawals() {
    // A media-only receipt never marks the shared task COMPLETE: matching/report
    // cleanup belongs to other consumers and must not be silently acknowledged.
    const pending = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM "ConsentWithdrawalTask" t
      LEFT JOIN "ConsentLedger" l ON l."subjectId" = t."subjectId"
      WHERE t.purpose = 'VIDEO_STORAGE' AND NOT EXISTS
        (SELECT 1 FROM "VideoWithdrawalReceipt" r WHERE r."withdrawalTaskId" = t.id)
      ORDER BY (l."userId" IS NULL), t."createdAt", t.id LIMIT 20`;
    let mappingUnavailable = false;
    for (const item of pending) {
      await this.prisma.$transaction(async (tx) => {
        const task = await tx.consentWithdrawalTask.findUniqueOrThrow({
          where: { id: item.id },
        });
        const ledger = await tx.consentLedger.findUnique({
          where: { subjectId: task.subjectId },
        });
        if (!ledger) {
          // Leave this shared task pending for explicit reconciliation. Never
          // infer an owner or acknowledge erasure from a missing live mapping.
          mappingUnavailable = true;
          return;
        }
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ledger.userId} FOR UPDATE`;
        if (
          await tx.videoWithdrawalReceipt.findUnique({
            where: { withdrawalTaskId: task.id },
          })
        )
          return;
        const videos = await tx.video.findMany({
          where: {
            ownerId: ledger.userId,
            status: { not: "DELETED" },
            OR: [
              { storageConsentVersion: null },
              { storageConsentVersion: { lt: task.version } },
            ],
          },
          take: 20,
        });
        for (const video of videos) {
          await tx.auditLog.create({
            data: {
              action: "VIDEO_CONSENT_WITHDRAWN",
              subjectType: "Video",
              subjectId: video.id,
            },
          });
          await tx.video.update({
            where: { id: video.id },
            data: { status: "DELETED", deletedAt: new Date() },
          });
          await tx.videoCleanupTask.upsert({
            where: { videoId: video.id },
            create: {
              videoId: video.id,
              bucket: video.bucket,
              objectKey: video.objectKey,
              uploadKey: video.uploadKey,
              uploadExpiresAt: video.uploadExpiresAt,
            },
            update: {
              removeFinal: true,
              status: "PENDING",
              completedAt: null,
              nextAttemptAt: new Date(),
            },
          });
        }
        if (videos.length < 20)
          await tx.videoWithdrawalReceipt.create({
            data: { withdrawalTaskId: task.id },
          });
      });
    }
    if (mappingUnavailable)
      this.logger.warn("VIDEO_CLEANUP_WITHDRAWAL_MAPPING_UNAVAILABLE");
  }
  private async enqueueExpiredUploads() {
    const candidates = await this.prisma.video.findMany({
      where: { uploadKey: { not: null }, uploadExpiresAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    for (const candidate of candidates) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.ownerId} FOR UPDATE`;
        const video = await tx.video.findUnique({
          where: { id: candidate.id },
        });
        if (!video?.uploadKey) return;
        const removeFinal =
          video.status === "UPLOADING" || video.status === "DELETED";
        if (video.status === "UPLOADING")
          await tx.video.update({
            where: { id: video.id },
            data: { status: "DELETED", deletedAt: new Date() },
          });
        await tx.videoCleanupTask.upsert({
          where: { videoId: video.id },
          create: {
            videoId: video.id,
            bucket: video.bucket,
            objectKey: video.objectKey,
            uploadKey: video.uploadKey,
            uploadExpiresAt: video.uploadExpiresAt,
            removeFinal,
          },
          update: {},
        });
      });
    }
  }
}
