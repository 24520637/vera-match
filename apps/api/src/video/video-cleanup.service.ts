import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { PrivateStorageService } from "./private-storage.service";

/** Durable at-least-once removal. No raw storage/SQL errors or object keys in logs. */
@Injectable()
export class VideoCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateStorageService,
    private readonly environment: EnvironmentService,
  ) {}
  onModuleInit() {
    // Tests explicitly drive the real worker to exercise failures and restart recovery.
    if (this.environment.values.nodeEnv === "test") return;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined);
    }, 15000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  runOnce() {
    if (this.running) return this.running;
    this.running = this.process().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async process() {
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
        });
      } catch {
        await this.prisma.videoCleanupTask.updateMany({
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
      }
    }
  }
}
