import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, ReportStatus } from "@prisma/client";
import { AuthContext } from "../auth/auth-context";
import { EnvironmentService } from "../config/environment.service";
import { SafetyAccessService } from "./safety-access.service";
import { StaffAssuranceSource } from "./staff-assurance.source";
import {
  cursor,
  identifier,
  invalid,
  nextCursor,
  object,
} from "./safety.validation";
function conflict(): never {
  throw new ConflictException({
    code: "RESOURCE_REVISION_CONFLICT",
    message: "The report changed. Refresh and review before trying again.",
    details: [
      {
        field: "expectedRevision",
        messages: ["Use the current revision after explicit review."],
      },
    ],
  });
}
function unavailable(): never {
  throw new NotFoundException({
    code: "REPORT_UNAVAILABLE",
    message: "This report is unavailable.",
  });
}
@Injectable()
export class ModerationService {
  constructor(
    private readonly access: SafetyAccessService,
    private readonly assurance: StaffAssuranceSource,
    private readonly environment: EnvironmentService,
  ) {}
  private async staff(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    now: Date,
  ) {
    let p: Awaited<ReturnType<StaffAssuranceSource["resolve"]>>;
    try { p = await this.assurance.resolve(tx, auth); }
    catch { throw new ServiceUnavailableException({ code: "STAFF_ASSURANCE_UNAVAILABLE", message: "Staff assurance could not be safely confirmed." }); }
    if (
      !p ||
      p.userId !== auth.user.id ||
      p.sessionId !== auth.sessionId ||
      p.level !== "MFA" ||
      !(p.verifiedAt instanceof Date) ||
      !Number.isFinite(p.verifiedAt.getTime()) ||
      p.verifiedAt > now ||
      !(p.expiresAt instanceof Date) ||
      !Number.isFinite(p.expiresAt.getTime()) ||
      p.expiresAt <= now ||
      (p.testOnly && this.environment.values.nodeEnv !== "test")
    )
      throw new ForbiddenException({
        code: "STAFF_ASSURANCE_REQUIRED",
        message:
          "Verified staff assurance is required to access reports. It is not configured for ordinary access in this build.",
      });
  }
  private visible(
    r: {
      reporterId: string | null;
      targetUserId: string | null;
      moderatorId: string | null;
      status: ReportStatus;
    },
    id: string,
    detail = false,
  ) {
    if (r.reporterId === id || r.targetUserId === id) return false;
    return (
      r.moderatorId === id ||
      (!detail && r.status === "OPEN" && r.moderatorId === null)
    );
  }
  list(auth: AuthContext, value: unknown) {
    const q = object(value, ["cursor", "status"]),
      after = cursor(q.cursor);
    if (
      q.status !== undefined &&
      (typeof q.status !== "string" ||
        !Object.values(ReportStatus).includes(q.status as ReportStatus))
    )
      invalid("status", "Choose a report status.");
    return this.access.run(auth, "MODERATOR", [], async (tx, now) => {
      await this.staff(tx, auth, now);
      const rows = await tx.report.findMany({
        where: {
          AND: [
            {
              OR: [{ reporterId: null }, { reporterId: { not: auth.user.id } }],
            },
            {
              OR: [
                { targetUserId: null },
                { targetUserId: { not: auth.user.id } },
              ],
            },
            {
              OR: [
                { moderatorId: auth.user.id },
                { moderatorId: null, status: "OPEN" },
              ],
            },
          ],
          status: (q.status as ReportStatus | undefined) ?? {
            in: ["OPEN", "IN_REVIEW"],
          },
          ...(after ? { id: { lt: after } } : {}),
        },
        orderBy: { id: "desc" },
        take: 51,
        select: {
          id: true,
          reasonCode: true,
          status: true,
          createdAt: true,
          revision: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.user.id,
          action: "SAFETY_REPORT_QUEUE_READ",
          subjectType: "ReportQueue",
        },
      });
      return {
        reports: rows
          .slice(0, 50)
          .map((r) => ({ ...r, revision: Number(r.revision) })),
        nextCursor: rows.length > 50 ? nextCursor(rows[49].id) : null,
      };
    });
  }
  detail(auth: AuthContext, value: unknown) {
    const id = identifier(value, "reportId");
    return this.access.run(auth, "MODERATOR", [], async (tx, now) => {
      await this.staff(tx, auth, now);
      const row = await tx.report.findUnique({
        where: { id },
        select: {
          id: true,
          reasonCode: true,
          reason: true,
          status: true,
          revision: true,
          reporterId: true,
          targetUserId: true,
          moderatorId: true,
          createdAt: true,
          actions: {
            orderBy: { revision: "asc" },
            select: {
              revision: true,
              fromStatus: true,
              toStatus: true,
              createdAt: true,
            },
          },
        },
      });
      if (!row || !this.visible(row, auth.user.id, true)) unavailable();
      await tx.auditLog.create({
        data: {
          actorId: auth.user.id,
          action: "SAFETY_REPORT_VIEWED",
          subjectType: "Report",
          subjectId: id,
        },
      });
      return {
        report: {
          id: row.id,
          reason: row.reasonCode,
          details: row.reason,
          status: row.status,
          revision: Number(row.revision),
          createdAt: row.createdAt,
          reporterReference: row.reporterId,
          targetReference: row.targetUserId,
          actions: row.actions.map((a) => ({
            ...a,
            revision: Number(a.revision),
          })),
        },
      };
    });
  }
  transition(auth: AuthContext, value: unknown, input: unknown) {
    const id = identifier(value, "reportId"),
      b = object(input, ["expectedRevision", "status"]);
    if (
      !Number.isSafeInteger(b.expectedRevision) ||
      (b.expectedRevision as number) < 0
    )
      invalid("expectedRevision", "Use a nonnegative safe integer revision.");
    if (!["IN_REVIEW", "RESOLVED", "DISMISSED"].includes(b.status as string))
      invalid("status", "Choose an available next status.");
    const expected = b.expectedRevision as number,
      status = b.status as ReportStatus;
    return this.access.run(auth, "MODERATOR", [], async (tx, now) => {
      await this.staff(tx, auth, now);
      await tx.$queryRaw`SELECT id FROM "Report" WHERE id=${id} FOR UPDATE`;
      const row = await tx.report.findUnique({ where: { id } });
      if (!row || !this.visible(row, auth.user.id)) unavailable();
      if (
        row.revision !== BigInt(expected) ||
        expected === Number.MAX_SAFE_INTEGER
      )
        conflict();
      if (!(
        (row.status === "OPEN" && status === "IN_REVIEW" && !row.moderatorId) ||
        (row.status === "IN_REVIEW" &&
          row.moderatorId === auth.user.id &&
          ["RESOLVED", "DISMISSED"].includes(status))
      ))
        conflict();
      const actor = await tx.expertActorIdentity.upsert({
        where: { userId: auth.user.id },
        create: { userId: auth.user.id },
        update: {},
      });
      const result = await tx.report.updateMany({
        where: { id, revision: BigInt(expected) },
        data: {
          status,
          moderatorId: auth.user.id,
          revision: { increment: 1n },
        },
      });
      if (result.count !== 1) conflict();
      await tx.reportModerationAction.create({
        data: {
          reportId: id,
          revision: BigInt(expected + 1),
          fromStatus: row.status,
          toStatus: status,
          actorEvidence: { subject: actor.subjectId },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.user.id,
          action: "SAFETY_REPORT_STATUS_CHANGED",
          subjectType: "Report",
          subjectId: id,
        },
      });
      return { report: { id, status, revision: expected + 1 } };
    });
  }
}
