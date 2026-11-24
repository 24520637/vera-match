import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { EnvironmentService } from "../config/environment.service";
import { ConsentAccessService } from "../consent/consent-access.service";
import { PrismaService } from "../database/prisma.service";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { SafetyAccessService } from "../safety/safety-access.service";
import { StaffAssuranceSource } from "../safety/staff-assurance.source";
import { transitionReviewAssignment } from "./review-assignment-transition";
import { reviewStateConflict } from "./review-draft.service";
import { requireSubmittableReview, reviewId, reviewReturn } from "./review-draft.validation";
import { approvedClaimRows, factualStatements, reviewApproval } from "./review-claim.validation";
import { approvedReviewSelect, approvedReviewSource, approvedReviewWhere } from "./review-approved-source";
import { claimSelect, ownerClaim } from "./review-claim-projection";
import { disputeConflict, disputeDecision, disputeSelect } from "./review-dispute";
import { requireReviewSource } from "./review-source-access";
import { assignmentGrantRuntimeFilter } from "./assignment-grant-scope";

const queueSize = 10;
const receipt = { id: true, version: true, submittedAt: true } satisfies Prisma.ExpertReviewSelect;
const source = { expertId: true, videoId: true, video: { select: { ownerId: true } } } satisfies Prisma.ExpertAssignmentSelect;
const detail = { ...receipt, summary: true, limitations: true,
  observations: { orderBy: [{ startMs: "asc" }, { id: "asc" }], select: {
    id: true, category: true, startMs: true, endMs: true, observation: true, context: true,
  } },
} satisfies Prisma.ExpertReviewSelect;

type DisputeContext = {
  reviewId: string;
  report: { version: number; summary: string; limitations: string; approvedAt: Date } | null;
  claim: Pick<NonNullable<ReturnType<typeof ownerClaim>>, "statement" | "evidence"> | null;
};

// Match the C035 current-grant predicate. The moderator User lock serializes
// decision checks with PA2 grant/revoke operations.
function activeModeratorGrants(moderatorId: string, testRuntime: boolean) {
  const realGrant = assignmentGrantRuntimeFilter(testRuntime);
  return Prisma.sql`
    SELECT s."assignmentId", g."expiresAt"
    FROM "AssignmentModeratorScope" s
    JOIN "ExpertActorIdentity" i ON i."subjectId"=s."moderatorSubjectId" AND i."userId"=${moderatorId}
    JOIN "AssignmentModeratorGrantEvent" g ON g.id=s."currentGrantId" AND g."scopeId"=s.id AND g.kind='GRANTED'
    WHERE g."expiresAt">clock_timestamp() ${realGrant} AND NOT EXISTS (
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
    private readonly consent: ConsentAccessService, private readonly journal?: RecoveryJournalService) {}

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
        SELECT "expiresAt" FROM (${activeModeratorGrants(auth.user.id, this.environment.values.nodeEnv === "test")}) grants WHERE "assignmentId"=${assignment.id}
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
        JOIN (${activeModeratorGrants(auth.user.id, this.environment.values.nodeEnv === "test")}) grants ON grants."assignmentId"=a.id
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
      return { review, claimTypes: Object.entries(factualStatements).map(([type, statement]) => ({ type, statement })) };
    });
  }

  private async withinDispute<T>(auth: AuthContext, id: string, action: (tx: Prisma.TransactionClient,
    dispute: Prisma.ReviewDisputeGetPayload<{ select: typeof disputeSelect }>, now: () => Promise<Date>,
    context: DisputeContext) => Promise<T>) {
    const locator = await this.prisma.reviewDispute.findUnique({ where: { id }, select: { reviewId: true } })
      .catch(() => { throw new ServiceUnavailableException({ code: "REVIEW_QA_UNAVAILABLE", message: "The dispute could not be confirmed." }); });
    if (!locator) {
      return this.access.run(auth, "MODERATOR", [], async tx => {
        await this.staff(tx, auth);
        return unavailable();
      });
    }
    return this.withinReview(auth, locator.reviewId, async (tx, assignment, now) => {
      const row = await tx.reviewDispute.findFirst({
        where: { id, reviewId: locator.reviewId, ownerId: assignment.video.ownerId, reviewVersion: { not: null },
          review: { ...approvedReviewWhere, assignmentId: assignment.id } },
        select: { ...disputeSelect, reviewVersion: true, review: { select: approvedReviewSelect }, claim: { select: claimSelect } },
      });
      if (!row || row.reviewVersion !== row.review.version) unavailable();
      const { reviewVersion: _version, review, claim, ...dispute } = row;
      const source = await approvedReviewSource(tx, this.consent, assignment.video.ownerId, review);
      if (!source) unavailable();
      if (dispute.claimId === null) {
        return action(tx, dispute, now, { reviewId: review.id, claim: null, report: {
          version: review.version, summary: source.summary, limitations: source.limitations, approvedAt: source.decision.decidedAt,
        } });
      }
      const evidence = claim && ownerClaim(claim, assignment.video.ownerId, review.version);
      if (!evidence) unavailable();
      return action(tx, dispute, now, { reviewId: review.id, report: null,
        claim: { statement: evidence.statement, evidence: evidence.evidence } });
    });
  }

  async listDisputes(auth: AuthContext, after?: string) {
    await this.access.run(auth, "MODERATOR", [], async tx => {
      const validateTime = await this.staff(tx, auth);
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: "REVIEW_DISPUTE_QUEUE_READ", subjectType: "ReviewDispute" } });
      await validateTime();
    });
    const disputes: Array<{ id: string; reviewId: string; status: "OPEN" | "IN_REVIEW"; createdAt: Date }> = [];
    let cursor = after;
    while (disputes.length <= queueSize) {
      const candidates = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT d.id FROM "ReviewDispute" d
        JOIN "ExpertReview" r ON r.id=d."reviewId" AND r.version=d."reviewVersion"
        JOIN "ExpertAssignment" a ON a.id=r."assignmentId"
        JOIN (${activeModeratorGrants(auth.user.id, this.environment.values.nodeEnv === "test")}) grants ON grants."assignmentId"=a.id
        JOIN "Video" v ON v.id=a."videoId" AND v."ownerId"=d."ownerId"
        WHERE d.status IN ('OPEN', 'IN_REVIEW') AND r.status='APPROVED' AND a.status='COMPLETED'
          AND a."expertId"<>${auth.user.id} AND v."ownerId"<>${auth.user.id}
          ${cursor ? Prisma.sql`AND d.id>${cursor}` : Prisma.empty}
        ORDER BY d.id ASC LIMIT ${queueSize + 1}
      `.catch(() => { throw new ServiceUnavailableException({ code: "REVIEW_QA_UNAVAILABLE", message: "The dispute queue could not be confirmed." }); });
      for (const { id } of candidates) {
        try {
          const entry = await this.withinDispute(auth, id, async (_tx, { status, createdAt }, _now, { reviewId }) =>
            status === "OPEN" || status === "IN_REVIEW" ? { id, reviewId, status, createdAt } : null);
          if (entry) disputes.push(entry);
        } catch (error) {
          if (!(error instanceof NotFoundException) &&
            !(error instanceof ForbiddenException && (error.getResponse() as { code?: string }).code === "REVIEW_QA_NOT_INDEPENDENT")) throw error;
        }
        if (disputes.length > queueSize) break;
      }
      if (candidates.length <= queueSize) break;
      cursor = candidates[candidates.length - 1].id;
    }
    return { disputes: disputes.slice(0, queueSize), nextCursor: disputes.length > queueSize ? disputes[queueSize - 1].id : null };
  }

  readDispute(auth: AuthContext, value: string) {
    return this.withinDispute(auth, reviewId(value), async (tx, dispute, _now, context) => {
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectType: "ReviewDispute", subjectId: dispute.id, action: "REVIEW_DISPUTE_READ" } });
      return { dispute, ...context };
    });
  }

  decideDispute(auth: AuthContext, value: string, input: unknown) {
    const { expectedRevision, status, resolution } = disputeDecision(input);
    return this.withinDispute(auth, reviewId(value), async (tx, dispute, now) => {
      const from = status === "IN_REVIEW" ? "OPEN" : "IN_REVIEW";
      if (dispute.status !== from || dispute.revision !== expectedRevision) disputeConflict();
      const decidedAt = await now();
      const data = { status, revision: expectedRevision + 1, ...(status === "IN_REVIEW" ? { inReviewAt: decidedAt } :
        { resolution, resolvedAt: decidedAt }) };
      const changed = await tx.reviewDispute.updateMany({ where: { id: dispute.id, status: from, revision: expectedRevision }, data });
      if (changed.count !== 1) disputeConflict();
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectType: "ReviewDispute", subjectId: dispute.id,
        action: "REVIEW_DISPUTE_" + status } });
      return { dispute: { ...dispute, ...data } };
    });
  }

  returnReview(auth: AuthContext, value: string, input: unknown) {
    const { expectedVersion, reason } = reviewReturn(input);
    return this.decide(auth, value, expectedVersion, "RETURNED", reason);
  }

  approve(auth: AuthContext, value: string, input: unknown) {
    const { expectedVersion, claims } = reviewApproval(input);
    return this.decide(auth, value, expectedVersion, "APPROVED", null, claims);
  }

  private decide(auth: AuthContext, value: string, expectedVersion: number, status: "RETURNED" | "APPROVED", reason: string | null,
    claims: ReturnType<typeof reviewApproval>["claims"] = []) {
    const id = reviewId(value);
    return this.withinReview(auth, id, async (tx, assignment, validateTime) => {
      const where = { id, assignmentId: assignment.id };
      const review = await tx.expertReview.findFirst({ where, select: { version: true, status: true, submittedAt: true } });
      if (!review) unavailable();
      if (review.version !== expectedVersion || expectedVersion === 2147483647)
        throw new ConflictException({ code: "REVIEW_VERSION_CONFLICT", message: "The review changed. Reload the submitted version." });
      if (review.status !== "SUBMITTED" || assignment.status !== "SUBMITTED" || !review.submittedAt) reviewStateConflict();
      const version = expectedVersion + 1;
      let claimRows: ReturnType<typeof approvedClaimRows> = [];
      if (status === "APPROVED") {
        const submitted = await tx.expertReview.findUniqueOrThrow({ where: { id }, select: detail });
        requireSubmittableReview({ ...submitted, observations: submitted.observations.map(({ id: _id, ...row }) => row) }, assignment.video.durationMs);
        claimRows = approvedClaimRows(claims, submitted.observations, assignment.video.ownerId, id, version);
      }
      const decidedAt = await validateTime();
      if (status === "RETURNED") await this.journal?.record(tx, [assignment.video.ownerId], "CLAIM_RESTRICTION");
      const changed = await tx.expertReview.updateMany({
        where: { ...where, version: expectedVersion, status: "SUBMITTED" },
        data: { status, version, qaById: auth.user.id, qaAt: decidedAt, qaFeedback: reason },
      });
      if (changed.count !== 1) reviewStateConflict();
      await transitionReviewAssignment(tx, assignment, status === "APPROVED" ? "COMPLETED" : "IN_PROGRESS", auth.user.id);
      await tx.reviewDecision.create({ data: { reviewId: id, moderatorId: auth.user.id, version, status, reason, decidedAt } });
      if (claimRows.length) {
        await tx.reviewClaim.createMany({ data: claimRows });
        await tx.auditLog.create({ data: { actorId: auth.user.id, subjectId: id, subjectType: "ExpertReview", action: "REVIEW_CLAIMS_APPROVED" } });
      }
      await tx.auditLog.create({ data: { actorId: auth.user.id, subjectId: id, subjectType: "ExpertReview",
        action: status === "APPROVED" ? "EXPERT_REVIEW_APPROVED" : "EXPERT_REVIEW_RETURNED" } });
      return { id, status, version, decidedAt };
    });
  }
}
