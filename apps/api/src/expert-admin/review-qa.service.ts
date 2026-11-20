import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { EnvironmentService } from "../config/environment.service";
import { ConsentAccessService } from "../consent/consent-access.service";
import { PrismaService } from "../database/prisma.service";
import { SafetyAccessService } from "../safety/safety-access.service";
import { StaffAssuranceSource } from "../safety/staff-assurance.source";
import { transitionReviewAssignment } from "./review-assignment-transition";
import { reviewStateConflict } from "./review-draft.service";
import { requireSubmittableReview, reviewId, reviewReturn, reviewSubmit } from "./review-draft.validation";
import { requireReviewSource } from "./review-source-access";

const queueSize = 10;
const receipt = { id: true, version: true, submittedAt: true } satisfies Prisma.ExpertReviewSelect;
const source = { expertId: true, videoId: true, video: { select: { ownerId: true } } } satisfies Prisma.ExpertAssignmentSelect;
const detail = { ...receipt, summary: true, limitations: true,
  observations: { orderBy: [{ startMs: "asc" }, { id: "asc" }], select: {
    category: true, startMs: true, endMs: true, observation: true, context: true,
  } },
} satisfies Prisma.ExpertReviewSelect;

// Match the C035 current-grant predicate. The moderator User lock serializes
// decision checks with PA2 grant/revoke operations.
function activeModeratorGrants(moderatorId: string) {
  return Prisma.sql`
    SELECT s."assignmentId", g."expiresAt"
    FROM "AssignmentModeratorScope" s
    JOIN "ExpertActorIdentity" i ON i."subjectId"=s."moderatorSubjectId" AND i."userId"=${moderatorId}
    JOIN "AssignmentModeratorGrantEvent" g ON g.id=s."currentGrantId" AND g."scopeId"=s.id AND g.kind='GRANTED'
    WHERE g."expiresAt">clock_timestamp() AND NOT EXISTS (
      SELECT 1 FROM "AssignmentModeratorGrantEvent" r WHERE r."grantId"=g.id AND r.kind='REVOKED'
    )
  `;
}

function unavailable(): never {
  throw new NotFoundException({ code: "REVIEW_NOT_FOUND", message: "Review unavailable." });
}

@Injectable()
export class ReviewQaService {
  constructor(private readonly prisma: PrismaService, private readonly access: SafetyAccessService,
    private readonly assurance: StaffAssuranceSource, private readonly environment: EnvironmentService,
    private readonly consent: ConsentAccessService) {}

  private async staff(tx: Prisma.TransactionClient, auth: AuthContext) {
    const denied = () => new ForbiddenException({ code: "STAFF_ASSURANCE_REQUIRED", message: "Verified staff assurance is required." });
    let proof;
    try {
      proof = await this.assurance.resolve(tx, auth);
    } catch {
      throw new ServiceUnavailableException({ code: "REVIEW_QA_UNAVAILABLE", message: "Staff access could not be confirmed." });
    }
    if (!proof || proof.userId !== auth.user.id || proof.sessionId !== auth.sessionId || proof.level !== "MFA" ||
      !(proof.verifiedAt instanceof Date) || !Number.isFinite(proof.verifiedAt.getTime()) ||
      !(proof.expiresAt instanceof Date) || !Number.isFinite(proof.expiresAt.getTime()) ||
      typeof proof.testOnly !== "boolean" || (proof.testOnly && this.environment.values.nodeEnv !== "test")) throw denied();
    const session = await tx.session.findUnique({ where: { id: auth.sessionId }, select: { expiresAt: true } });
    const validateTime = async () => {
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
      if (!session || session.expiresAt <= clock.now)
        throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
      if (proof.verifiedAt > clock.now || proof.expiresAt <= clock.now) throw denied();
      return clock.now;
    };
    await validateTime();
    return validateTime;
  }

  private async withinReview<T>(auth: AuthContext, id: string,
    run: (tx: Prisma.TransactionClient, assignment: Prisma.ExpertAssignmentGetPayload<{ include: { video: true } }>, now: () => Promise<Date>) => Promise<T>) {
    const locator = await this.prisma.expertReview.findUnique({ where: { id },
      select: { assignmentId: true, assignment: { select: source } },
    }).catch(() => { throw new ServiceUnavailableException({ code: "REVIEW_QA_UNAVAILABLE", message: "The review could not be confirmed." }); });
    const peers = locator ? [locator.assignment.expertId, locator.assignment.video.ownerId] : [];
    return this.access.run(auth, "MODERATOR", peers, async tx => {
      const validateStaffTime = await this.staff(tx, auth);
      if (!locator) unavailable();
      await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${locator.assignment.videoId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${locator.assignmentId} FOR UPDATE`;
      const assignment = await tx.expertAssignment.findUnique({ where: { id: locator.assignmentId }, include: { video: true } });
      if (!assignment || assignment.expertId !== locator.assignment.expertId || assignment.videoId !== locator.assignment.videoId ||
        assignment.video.ownerId !== locator.assignment.video.ownerId) unavailable();
      if (assignment.expertId === auth.user.id || assignment.video.ownerId === auth.user.id)
        throw new ForbiddenException({ code: "REVIEW_QA_NOT_INDEPENDENT", message: "An independent moderator must make this decision." });
      const [grant] = await tx.$queryRaw<{ expiresAt: Date }[]>`
        SELECT "expiresAt" FROM (${activeModeratorGrants(auth.user.id)}) grants WHERE "assignmentId"=${assignment.id}
      `;
      if (!grant) unavailable();
      const validateTime = async () => {
        const now = await validateStaffTime();
        if (grant.expiresAt <= now) unavailable();
        return now;
      };
      try {
        await requireReviewSource(tx, this.consent, assignment, assignment.video);
      } catch (error) {
        if (error instanceof ForbiddenException) unavailable();
        throw error;
      }
      const result = await run(tx, assignment, validateTime);
      await validateTime();
      return result;
    });
  }

  async list(auth: AuthContext, after?: string) {
    await this.access.run(auth, "MODERATOR", [], async tx => {
      const validateTime = await this.staff(tx, auth);
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: "EXPERT_REVIEW_QA_QUEUE_READ", subjectType: "ExpertReview" } });
      await validateTime();
    });
    const reviews: Array<Prisma.ExpertReviewGetPayload<{ select: typeof receipt }>> = [];
    let cursor = after;
    while (reviews.length <= queueSize) {
      const candidates = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT r.id FROM "ExpertReview" r
        JOIN "ExpertAssignment" a ON a.id=r."assignmentId"
        JOIN (${activeModeratorGrants(auth.user.id)}) grants ON grants."assignmentId"=a.id
        JOIN "Video" v ON v.id=a."videoId"
        WHERE r.status='SUBMITTED' AND r."submittedAt" IS NOT NULL AND a.status='SUBMITTED'
          AND a."expertId"<>${auth.user.id} AND v."ownerId"<>${auth.user.id}
          AND v.status='READY' AND v."deletedAt" IS NULL
          ${cursor ? Prisma.sql`AND r.id>${cursor}` : Prisma.empty}
        ORDER BY r.id ASC LIMIT ${queueSize + 1}
      `.catch(() => { throw new ServiceUnavailableException({ code: "REVIEW_QA_UNAVAILABLE", message: "The review queue could not be confirmed." }); });
      for (const { id } of candidates) {
        try {
          const entry = await this.withinReview(auth, id, async (tx, assignment) => {
            if (assignment.status !== "SUBMITTED") unavailable();
            return tx.expertReview.findFirst({ where: { id, assignmentId: assignment.id, status: "SUBMITTED", submittedAt: { not: null } }, select: receipt });
          });
          if (entry) reviews.push(entry);
        } catch (error) {
          if (!(error instanceof NotFoundException) &&
            !(error instanceof ForbiddenException && (error.getResponse() as { code?: string }).code === "REVIEW_QA_NOT_INDEPENDENT")) throw error;
        }
        if (reviews.length > queueSize) break;
      }
      if (candidates.length <= queueSize) break;
      cursor = candidates[candidates.length - 1].id;
    }
    return { reviews: reviews.slice(0, queueSize), nextCursor: reviews.length > queueSize ? reviews[queueSize - 1].id : null };
  }

  read(auth: AuthContext, value: string) {
    const id = reviewId(value);
    return this.withinReview(auth, id, async (tx, assignment) => {
      if (assignment.status !== "SUBMITTED") unavailable();
      const review = await tx.expertReview.findFirst({ where: { id, assignmentId: assignment.id, status: "SUBMITTED", submittedAt: { not: null } }, select: detail });
      if (!review) unavailable();
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectId: id, subjectType: "ExpertReview", action: "EXPERT_REVIEW_QA_READ" } });
      return { review };
    });
  }

  returnReview(auth: AuthContext, value: string, input: unknown) {
    const { expectedVersion, reason } = reviewReturn(input);
    return this.decide(auth, value, expectedVersion, "RETURNED", reason);
  }

  approve(auth: AuthContext, value: string, input: unknown) {
    return this.decide(auth, value, reviewSubmit(input), "APPROVED", null);
  }

  private decide(auth: AuthContext, value: string, expectedVersion: number, status: "RETURNED" | "APPROVED", reason: string | null) {
    const id = reviewId(value);
    return this.withinReview(auth, id, async (tx, assignment, validateTime) => {
      const where = { id, assignmentId: assignment.id };
      const review = await tx.expertReview.findFirst({ where, select: { version: true, status: true, submittedAt: true } });
      if (!review) unavailable();
      if (review.version !== expectedVersion || expectedVersion === 2147483647)
        throw new ConflictException({ code: "REVIEW_VERSION_CONFLICT", message: "The review changed. Reload the submitted version." });
      if (review.status !== "SUBMITTED" || assignment.status !== "SUBMITTED" || !review.submittedAt) reviewStateConflict();
      if (status === "APPROVED") {
        const submitted = await tx.expertReview.findUniqueOrThrow({ where: { id }, select: detail });
        requireSubmittableReview(submitted, assignment.video.durationMs);
      }
      const decidedAt = await validateTime();
      const version = expectedVersion + 1;
      const changed = await tx.expertReview.updateMany({
        where: { ...where, version: expectedVersion, status: "SUBMITTED" },
        data: { status, version, qaById: auth.user.id, qaAt: decidedAt, qaFeedback: reason },
      });
      if (changed.count !== 1) reviewStateConflict();
      await transitionReviewAssignment(tx, assignment, status === "APPROVED" ? "COMPLETED" : "IN_PROGRESS", auth.user.id);
      await tx.reviewDecision.create({ data: { reviewId: id, moderatorId: auth.user.id, version, status, reason, decidedAt } });
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectId: id, subjectType: "ExpertReview",
        action: status === "APPROVED" ? "EXPERT_REVIEW_APPROVED" : "EXPERT_REVIEW_RETURNED" } });
      return { id, status, version, decidedAt };
    });
  }
}
