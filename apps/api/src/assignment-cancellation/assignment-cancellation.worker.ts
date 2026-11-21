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
import { sourceUnavailableDisputes } from "./review-dispute-source-closure";

type Lane = "withdrawal" | "deleted-video" | "review-dispute-source";

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
  private nextBatch(lane: Lane) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO "AssignmentCancellationScan" (lane)
        VALUES (${lane}) ON CONFLICT (lane) DO NOTHING`;
        const [cursor] = await tx.$queryRaw<
          { afterId: string | null; throughId: string | null }[]
        >`
        SELECT "afterId", "throughId" FROM "AssignmentCancellationScan"
        WHERE lane=${lane} FOR UPDATE`;
        const source = this.pending(lane);
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
  private pending(lane: Lane) {
    if (lane === "review-dispute-source") return sourceUnavailableDisputes();
    return lane === "withdrawal"
      ? Prisma.sql`SELECT t.id::text COLLATE "C" AS id, t."createdAt" AS "queuedAt"
          FROM "ConsentWithdrawalTask" t
          WHERE t.purpose IN ('VIDEO_STORAGE','EXPERT_VIDEO_REVIEW') AND NOT EXISTS
            (SELECT 1 FROM "AssignmentWithdrawalReceipt" r WHERE r."withdrawalTaskId"=t.id)`
      : Prisma.sql`SELECT v.id COLLATE "C" AS id, COALESCE(v."deletedAt",v."createdAt") AS "queuedAt"
          FROM "Video" v WHERE v.status='DELETED' AND EXISTS
            (SELECT 1 FROM "ExpertAssignment" a WHERE a."videoId"=v.id
              AND a.status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED'))`;
  }
  /** Aggregates only: no source IDs, SQL exceptions or media/account payloads. */
  private async observeBacklog() {
    const summary = (lane: Lane) => Prisma.sql`
      SELECT ${lane}::text AS lane, count(*)::double precision AS pending,
        GREATEST(0,COALESCE(FLOOR(EXTRACT(EPOCH FROM
          ((clock_timestamp() AT TIME ZONE 'UTC') - min("queuedAt")))),0))::double precision AS "oldestSeconds"
      FROM (${this.pending(lane)}) pending`;
    const rows = await this.prisma.$queryRaw<
      {
        lane: Lane;
        pending: number;
        oldestSeconds: number;
      }[]
    >(
      Prisma.sql`${summary("withdrawal")} UNION ALL ${summary("deleted-video")}
        UNION ALL ${summary("review-dispute-source")}`,
    );
    const withdrawal = rows.find((r) => r.lane === "withdrawal")!,
      deleted = rows.find((r) => r.lane === "deleted-video")!;
    this.logger.log({
      code: "ASSIGNMENT_CANCELLATION_HEARTBEAT",
      withdrawalPending: withdrawal.pending,
      withdrawalOldestSeconds: withdrawal.oldestSeconds,
      deletedVideoPending: deleted.pending,
      deletedVideoOldestSeconds: deleted.oldestSeconds,
    });
    for (const row of rows)
      if (row.pending > 0 && row.oldestSeconds >= 900)
        this.logger.warn({
          code: "ASSIGNMENT_CANCELLATION_BACKLOG_OVERDUE",
          lane: row.lane,
          pending: row.pending,
          oldestSeconds: row.oldestSeconds,
          thresholdSeconds: 900,
        });
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
    const disputes = await this.nextBatch("review-dispute-source");
    for (const dispute of disputes)
      try {
        await this.cancellation.processSourceUnavailableDispute(dispute.id);
      } catch {
        retry = true;
      }
    if (mappingMissing)
      this.logger.warn("ASSIGNMENT_CANCELLATION_MAPPING_UNAVAILABLE");
    if (retry) this.logger.warn("ASSIGNMENT_CANCELLATION_RETRY_SCHEDULED");
    await this.observeBacklog();
  }
}
