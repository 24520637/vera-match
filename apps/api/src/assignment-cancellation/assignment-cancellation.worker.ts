import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { AssignmentCancellationService } from "./assignment-cancellation.service";

@Injectable()
export class AssignmentCancellationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private failed = false;
  private readonly logger = new Logger(AssignmentCancellationWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellation: AssignmentCancellationService,
    private readonly environment: EnvironmentService,
  ) {}
  onModuleInit() {
    if (this.environment.values.nodeEnv === "test") return;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined);
    }, 15000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }
  runOnce() {
    if (this.running) return this.running;
    this.running = this.process()
      .then(() => {
        if (this.failed)
          this.logger.log("ASSIGNMENT_CANCELLATION_SCAN_RECOVERED");
        this.failed = false;
      })
      .catch((error: unknown) => {
        this.failed = true;
        this.logger.error("ASSIGNMENT_CANCELLATION_SCAN_FAILED");
        throw error;
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async process() {
    const tasks = await this.prisma.$queryRaw<
      { id: string }[]
    >`SELECT t.id FROM "ConsentWithdrawalTask" t
      LEFT JOIN "ConsentLedger" l ON l."subjectId"=t."subjectId"
      WHERE t.purpose IN ('VIDEO_STORAGE','EXPERT_VIDEO_REVIEW') AND NOT EXISTS
       (SELECT 1 FROM "AssignmentWithdrawalReceipt" r WHERE r."withdrawalTaskId"=t.id)
      ORDER BY (l."userId" IS NULL),t."createdAt",t.id LIMIT 20`;
    let retry = false,
      mappingMissing = false;
    for (const task of tasks)
      try {
        const result = await this.cancellation.processWithdrawal(task.id);
        if (result.mappingMissing) mappingMissing = true;
      } catch {
        retry = true;
      }
    const videos = await this.prisma.video.findMany({
      where: {
        status: "DELETED",
        assignments: {
          some: { status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] } },
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 20,
    });
    for (const video of videos)
      try {
        await this.cancellation.processDeletedVideo(video.id);
      } catch {
        retry = true;
      }
    if (mappingMissing)
      this.logger.warn("ASSIGNMENT_CANCELLATION_MAPPING_UNAVAILABLE");
    if (retry) this.logger.warn("ASSIGNMENT_CANCELLATION_RETRY_SCHEDULED");
  }
}
