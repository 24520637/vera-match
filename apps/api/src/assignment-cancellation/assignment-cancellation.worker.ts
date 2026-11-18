import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
  /** Scheduling state is not completion or authorization. Commit selection before
   * taking domain locks; crashed/failed batches remain eligible on the next lap.
   * A fixed upper bound ensures continuous arrivals cannot postpone that lap.
   */
  private nextBatch(lane: "withdrawal" | "deleted-video") {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO "AssignmentCancellationScan" (lane)
        VALUES (${lane}) ON CONFLICT (lane) DO NOTHING`;
        const [cursor] = await tx.$queryRaw<
          { afterId: string | null; throughId: string | null }[]
        >`
        SELECT "afterId", "throughId" FROM "AssignmentCancellationScan"
        WHERE lane=${lane} FOR UPDATE`;
        const source =
          lane === "withdrawal"
            ? Prisma.sql`SELECT t.id::text COLLATE "C" AS id FROM "ConsentWithdrawalTask" t
            WHERE t.purpose IN ('VIDEO_STORAGE','EXPERT_VIDEO_REVIEW') AND NOT EXISTS
              (SELECT 1 FROM "AssignmentWithdrawalReceipt" r WHERE r."withdrawalTaskId"=t.id)`
            : Prisma.sql`SELECT v.id COLLATE "C" AS id FROM "Video" v
            WHERE v.status='DELETED' AND EXISTS (SELECT 1 FROM "ExpertAssignment" a
              WHERE a."videoId"=v.id AND a.status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED'))`;
        const page = (after: string | null, through: string | null) =>
          tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM (${source}) pending
        WHERE (${after}::text IS NULL OR id > ${after}::text COLLATE "C")
          AND (${through}::text IS NULL OR id <= ${through}::text COLLATE "C")
        ORDER BY id LIMIT 20`);
        let through = cursor.throughId;
        let rows = through ? await page(cursor.afterId, through) : [];
        if (!rows.length) {
          const [bound] = await tx.$queryRaw<
            { id: string | null }[]
          >(Prisma.sql`
          SELECT max(id) AS id FROM (${source}) pending`);
          through = bound.id;
          rows = through ? await page(null, through) : [];
        }
        await tx.assignmentCancellationScan.update({
          where: { lane },
          data: {
            afterId: rows.length ? rows[rows.length - 1].id : null,
            throughId: rows.length ? through : null,
          },
        });
        return rows;
      },
      { timeout: 10000 },
    );
  }
  private async process() {
    const tasks = await this.nextBatch("withdrawal");
    let retry = false,
      mappingMissing = false;
    for (const task of tasks)
      try {
        const result = await this.cancellation.processWithdrawal(task.id);
        if (result.mappingMissing) mappingMissing = true;
      } catch {
        retry = true;
      }
    const videos = await this.nextBatch("deleted-video");
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
