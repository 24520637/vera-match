import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AssignmentCancellationReason,
  ExpertAssignment,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { closeSourceUnavailableDispute } from "./review-dispute-source-closure";

const active = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] as const;
export const CANCELLATION_SYSTEM_ACTOR = "system:assignment-cancellation:v1";
function unavailable(): never {
  throw new ServiceUnavailableException({
    code: "ASSIGNMENT_CANCELLATION_UNAVAILABLE",
    message: "Assignment cancellation could not be confirmed.",
  });
}
/** Internal privacy-restriction consumer, not a staff permission or public API.
 * Lock only needed resources: owner User -> Video(s) -> Assignment(s), all sorted.
 * Never acquire additional participant User locks after taking a Video lock.
 */
@Injectable()
export class AssignmentCancellationService {
  constructor(private readonly prisma: PrismaService) {}
  private async cancelLocked(
    tx: Prisma.TransactionClient,
    rows: ExpertAssignment[],
    reason: AssignmentCancellationReason,
    actorSubject: string,
    initiatorEvidence: Prisma.InputJsonObject,
    sourceTaskId: string | null,
  ) {
    if (!rows.length) return 0;
    const [clock] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
    for (const row of rows) {
      if (row.revision >= BigInt(Number.MAX_SAFE_INTEGER)) unavailable();
      const changed = await tx.expertAssignment.updateMany({
        where: { id: row.id, revision: row.revision, status: row.status },
        data: {
          status: "CANCELLED",
          cancelledAt: clock.now,
          revision: { increment: 1n },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({
          code: "RESOURCE_REVISION_CONFLICT",
          message: "Assignment changed. Reconcile before retrying.",
        });
      const [event] = await tx.$queryRaw<
        { id: string }[]
      >`INSERT INTO "AssignmentEvent"
        ("assignmentId",revision,"fromStatus","toStatus","credentialApprovalId","actorEvidence",snapshot)
        SELECT id,revision,${row.status}::"AssignmentStatus",status,"credentialApprovalId",${JSON.stringify({ subject: actorSubject })}::jsonb,
          to_jsonb(a)-ARRAY['assignedById','expertId','eventFromStatus','eventTransactionId']::text[]
        FROM "ExpertAssignment" a WHERE id=${row.id} RETURNING id`;
      if (!event) unavailable();
      await tx.assignmentCancellationContext.create({
        data: { eventId: event.id, reason, sourceTaskId, initiatorEvidence },
      });
      await tx.auditLog.create({
        data: {
          action: "ASSIGNMENT_PRIVACY_CANCELLED",
          subjectType: "AssignmentEvent",
          subjectId: event.id,
        },
      });
    }
    return rows.length;
  }
  /** Caller holds owner User and Video locks and has verified ownership. Rechecks
   * authoritative deletion before acting; terminal rows are untouched on replay.
   */
  async cancelDeletedVideoInTransaction(
    tx: Prisma.TransactionClient,
    ownerId: string,
    videoId: string,
    ownerInitiated: boolean,
  ) {
    const video = await tx.video.findFirst({
      where: {
        id: videoId,
        ownerId,
        status: "DELETED",
      },
    });
    if (!video) unavailable();
    await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE "videoId"=${videoId} ORDER BY id FOR UPDATE`;
    const rows = await tx.expertAssignment.findMany({
      where: { videoId, status: { in: [...active] } },
      orderBy: { id: "asc" },
    });
    if (!rows.length) return 0;
    if (ownerInitiated) {
      const actor = await tx.expertActorIdentity.upsert({
        where: { userId: ownerId },
        create: { userId: ownerId },
        update: {},
      });
      return this.cancelLocked(
        tx,
        rows,
        "VIDEO_DELETED",
        actor.subjectId,
        { kind: "ACCOUNT", subject: actor.subjectId },
        null,
      );
    }
    return this.cancelLocked(
      tx,
      rows,
      "VIDEO_DELETED",
      CANCELLATION_SYSTEM_ACTOR,
      { kind: "UNKNOWN" },
      null,
    );
  }
  async processDeletedVideo(videoId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const locator = await tx.video.findUnique({
          where: { id: videoId },
          select: { ownerId: true },
        });
        if (!locator) return 0;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${locator.ownerId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${videoId} FOR UPDATE`;
        const video = await tx.video.findUnique({ where: { id: videoId } });
        if (
          !video ||
          video.ownerId !== locator.ownerId ||
          video.status !== "DELETED"
        )
          return 0;
        return this.cancelDeletedVideoInTransaction(
          tx,
          video.ownerId,
          videoId,
          false,
        );
      },
      { timeout: 10000 },
    );
  }
  async processSourceUnavailableDispute(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const dispute = await tx.reviewDispute.findUnique({ where: { id }, select: { ownerId: true } });
      if (!dispute) return;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${dispute.ownerId} FOR UPDATE`;
      await closeSourceUnavailableDispute(tx, id, dispute.ownerId);
    }, { timeout: 10000 });
  }
  async processWithdrawal(taskId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const task = await tx.consentWithdrawalTask.findUnique({
          where: { id: taskId },
          include: { event: true },
        });
        if (
          !task ||
          !["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"].includes(task.purpose) ||
          task.event.newGranted ||
          task.event.subjectId !== task.subjectId ||
          task.event.purpose !== task.purpose ||
          task.event.nextVersion !== task.version ||
          task.version <= 0n
        )
          unavailable();
        // Immutable consumer receipt is a historical completion, not an access grant.
        // It remains replayable after live identity mapping removal.
        if (
          await tx.assignmentWithdrawalReceipt.findUnique({
            where: { withdrawalTaskId: task.id },
          })
        )
          return { completed: true, cancelled: 0, mappingMissing: false };
        const locator = await tx.consentLedger.findUnique({
          where: { subjectId: task.subjectId },
        });
        if (!locator)
          return { completed: false, cancelled: 0, mappingMissing: true };
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${locator.userId} FOR UPDATE`;
        const ledger = await tx.consentLedger.findUnique({
          where: { userId: locator.userId },
        });
        if (
          !ledger ||
          ledger.subjectId !== task.subjectId ||
          task.version > ledger.version
        )
          return { completed: false, cancelled: 0, mappingMissing: true };
        if (
          await tx.assignmentWithdrawalReceipt.findUnique({
            where: { withdrawalTaskId: task.id },
          })
        )
          return { completed: true, cancelled: 0, mappingMissing: false };
        const legacy = {
          reviewConsentSubjectId: null,
          reviewConsentVersion: null,
        };
        const where: Prisma.ExpertAssignmentWhereInput = {
          status: { in: [...active] },
          video: { ownerId: ledger.userId },
          ...(task.purpose === "EXPERT_VIDEO_REVIEW"
            ? {
                OR: [
                  {
                    reviewConsentSubjectId: task.subjectId,
                    reviewConsentVersion: { lt: task.version },
                  },
                  legacy,
                ],
              }
            : {
                video: {
                  ownerId: ledger.userId,
                  OR: [
                    { storageConsentVersion: { lt: task.version } },
                    { storageConsentVersion: null },
                  ],
                },
              }),
        };
        const candidates = await tx.expertAssignment.findMany({
          where,
          orderBy: { id: "asc" },
          take: 20,
          select: { id: true, videoId: true },
        });
        if (candidates.length) {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "Video" WHERE id IN (${Prisma.join([...new Set(candidates.map((r) => r.videoId))].sort())}) ORDER BY id FOR UPDATE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "ExpertAssignment" WHERE id IN (${Prisma.join(candidates.map((r) => r.id))}) ORDER BY id FOR UPDATE`,
          );
        }
        const rows = candidates.length
          ? await tx.expertAssignment.findMany({
              where: {
                AND: [where, { id: { in: candidates.map((r) => r.id) } }],
              },
              orderBy: { id: "asc" },
            })
          : [];
        const reason =
          task.purpose === "VIDEO_STORAGE"
            ? "VIDEO_STORAGE_WITHDRAWN"
            : "EXPERT_VIDEO_REVIEW_WITHDRAWN";
        const cancelled = await this.cancelLocked(
          tx,
          rows,
          reason,
          CANCELLATION_SYSTEM_ACTOR,
          { kind: "CONSENT_SUBJECT", subject: task.subjectId },
          task.id,
        );
        const remaining = await tx.expertAssignment.count({ where });
        if (!remaining)
          await tx.assignmentWithdrawalReceipt.create({
            data: { withdrawalTaskId: task.id },
          });
        return { completed: !remaining, cancelled, mappingMissing: false };
      },
      { timeout: 10000 },
    );
  }
}
