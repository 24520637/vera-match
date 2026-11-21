import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { ConsentAccessService } from "../consent/consent-access.service";
import { SafetyAccessService } from "../safety/safety-access.service";
import { approvedReviewSelect, approvedReviewSource, approvedReviewWhere } from "./review-approved-source";
import { activeClaimShare, claimSharingPurposes } from "./review-claim-consent";
import { claimSelect, ownerClaim } from "./review-claim-projection";
import { claimFeedback, claimUpdate, reviewInputError } from "./review-claim.validation";
import { disputeConflict, disputeInput, disputeSelect } from "./review-dispute";
import { reviewId } from "./review-draft.validation";

const pageSize = 10;
const feedbackSelect = { target: true, note: true, revision: true, updatedAt: true } satisfies Prisma.ReviewClaimFeedbackSelect;
const reportSelect = {
  ...approvedReviewSelect,
  claims: { where: { qaApproved: true, reviewVersion: { not: null } }, orderBy: { id: "asc" },
    select: { ...claimSelect, feedback: { select: feedbackSelect } } },
} satisfies Prisma.ExpertReviewSelect;

async function requireCurrentSession(tx: Prisma.TransactionClient, auth: AuthContext) {
  const session = await tx.session.findUnique({ where: { id: auth.sessionId }, select: { expiresAt: true } });
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
  if (!session || session.expiresAt <= clock.now)
    throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
  return clock.now;
}

function claimUnavailable(): never {
  throw new NotFoundException({ code: "REVIEW_CLAIM_NOT_FOUND", message: "Review claim unavailable." });
}

function claimConflict(): never {
  throw new ConflictException({ code: "REVIEW_CLAIM_CONFLICT", message: "This claim changed. Reload the report." });
}

@Injectable()
export class ReviewOwnerService {
  constructor(private readonly access: SafetyAccessService, private readonly consent: ConsentAccessService) {}

  list(auth: AuthContext, after?: string) {
    return this.access.run(auth, "MEMBER", [], async tx => {
      const ownerId = auth.user.id;
      const reports = [];
      let cursor = after;
      const consent = await this.consent.requireInTransaction(tx, ownerId, ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"])
        .catch((error: unknown) => {
          if (error instanceof ForbiddenException) return null;
          throw error;
        });
      if (consent) {
        while (reports.length <= pageSize) {
          const candidates = await tx.expertReview.findMany({
            where: { ...approvedReviewWhere, ...(cursor ? { id: { gt: cursor } } : {}),
              assignment: { ...approvedReviewWhere.assignment, reviewConsentSubjectId: consent.subjectId,
                video: { ...approvedReviewWhere.assignment.video, ownerId } } },
            orderBy: { id: "asc" }, take: pageSize + 1, select: {
              ...reportSelect,
              disputes: { where: { ownerId, reviewVersion: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: pageSize, select: { ...disputeSelect, reviewVersion: true } },
            },
          });
          for (const row of candidates) {
            const source = await approvedReviewSource(tx, this.consent, ownerId, row);
            if (!source) continue;
            const { decision, video } = source;
            const claims = [];
            for (const rowClaim of row.claims) {
              const claim = ownerClaim(rowClaim, ownerId, row.version);
              if (claim) {
                claim.shareApproved = await activeClaimShare(tx, this.consent, ownerId, rowClaim);
                claims.push({ ...claim, feedback: rowClaim.feedback });
              }
            }
            reports.push({
              id: row.id, summary: row.summary, limitations: row.limitations, approvedAt: decision.decidedAt,
              reviewer: row.assignment.expert.displayName, source: { videoId: video.id, uploadedAt: video.createdAt }, claims,
              disputes: row.disputes.filter(dispute => dispute.reviewVersion === row.version)
                .map(({ reviewVersion: _version, ...dispute }) => dispute),
            });
            if (reports.length > pageSize) break;
          }
          if (candidates.length <= pageSize) break;
          cursor = candidates[candidates.length - 1].id;
        }
      }
      await tx.auditLog.create({ data: { actorId: ownerId, subjectType: "ExpertReview", action: "EXPERT_REVIEW_OWNER_REPORTS_READ" } });
      await requireCurrentSession(tx, auth);
      return { reports: reports.slice(0, pageSize), nextCursor: reports.length > pageSize ? reports[pageSize - 1].id : null };
    });
  }

  private async requireClaim(tx: Prisma.TransactionClient, ownerId: string, id: string) {
    const row = await tx.reviewClaim.findFirst({
      where: { id, ownerId, qaApproved: true, reviewVersion: { not: null },
        review: { ...approvedReviewWhere, assignment: { ...approvedReviewWhere.assignment,
          video: { ...approvedReviewWhere.assignment.video, ownerId } } } },
      select: { ...claimSelect, review: { select: approvedReviewSelect } },
    });
    const claim = row && ownerClaim(row, ownerId, row.review.version);
    if (!row || !claim || !await approvedReviewSource(tx, this.consent, ownerId, row.review)) claimUnavailable();
    return { row, claim };
  }

  saveFeedback(auth: AuthContext, value: string, input: unknown) {
    const claimId = reviewId(value);
    const { target, note, expectedRevision } = claimFeedback(input);
    const ownerId = auth.user.id;
    return this.access.run(auth, "MEMBER", [], async tx => {
      const { claim } = await this.requireClaim(tx, ownerId, claimId);
      if (target === "TRANSCRIPT" && claim.evidence.transcript === null)
        reviewInputError("target", "This claim has no transcript to annotate.");

      const key = { claimId, target };
      const where = { claimId_target: key };
      const existing = await tx.reviewClaimFeedback.findUnique({ where, select: feedbackSelect });
      if (existing?.note === note) {
        await requireCurrentSession(tx, auth);
        return { feedback: existing };
      }
      if ((existing?.revision ?? 0) !== expectedRevision)
        throw new ConflictException({ code: "REVIEW_FEEDBACK_CONFLICT", message: "Feedback changed. Reload the report." });

      const feedback = await tx.reviewClaimFeedback.upsert({
        where, create: { ...key, note }, update: { note, revision: { increment: 1 } }, select: feedbackSelect,
      });
      await tx.auditLog.create({ data: { actorId: ownerId, subjectType: "ReviewClaim", subjectId: claimId, action: "REVIEW_CLAIM_FEEDBACK_SAVED" } });
      await requireCurrentSession(tx, auth);
      return { feedback };
    });
  }

  updateClaim(auth: AuthContext, value: string, input: unknown) {
    const id = reviewId(value);
    const { action, expectedRevision } = claimUpdate(input);
    const ownerId = auth.user.id;
    return this.access.run(auth, "MEMBER", [], async (tx, now) => {
      const { row, claim } = await this.requireClaim(tx, ownerId, id);
      if (claim.revision !== expectedRevision || claim.revokedAt) claimConflict();
      const revision = expectedRevision + 1;
      let data: Prisma.ReviewClaimUpdateManyMutationInput;
      switch (action) {
        case "CONFIRM":
          if (claim.ownerConfirmed) claimConflict();
          data = { ownerConfirmed: true, revision };
          break;
        case "SHARE": {
          if (!claim.ownerConfirmed || await activeClaimShare(tx, this.consent, ownerId, row)) claimConflict();
          const generation = await this.consent.requireInTransaction(tx, ownerId, claimSharingPurposes);
          data = { shareApproved: true, shareConsentSubjectId: generation.subjectId, shareConsentVersion: generation.version, revision };
          break;
        }
        case "REVOKE":
          data = { shareApproved: false, revokedAt: now,
            shareConsentSubjectId: null, shareConsentVersion: null, revision };
          break;
      }
      const changed = await tx.reviewClaim.updateMany({
        where: { id, ownerId, revision: expectedRevision },
        data,
      });
      if (changed.count !== 1) claimConflict();
      const auditAction = { CONFIRM: "REVIEW_CLAIM_CONFIRMED", SHARE: "REVIEW_CLAIM_SHARED", REVOKE: "REVIEW_CLAIM_REVOKED" }[action];
      await tx.auditLog.create({ data: { actorId: ownerId, subjectType: "ReviewClaim", subjectId: id, action: auditAction } });
      await requireCurrentSession(tx, auth);
      return { claim: { ...claim, ownerConfirmed: claim.ownerConfirmed || action === "CONFIRM",
        shareApproved: action === "SHARE", revokedAt: action === "REVOKE" ? now : null, revision } };
    });
  }

  openDispute(auth: AuthContext, value: string, input: unknown) {
    const reviewIdValue = reviewId(value);
    const { claimId, reason } = disputeInput(input);
    const ownerId = auth.user.id;
    return this.access.run(auth, "MEMBER", [], async tx => {
      const review = await tx.expertReview.findFirst({
        where: { id: reviewIdValue, ...approvedReviewWhere, assignment: { ...approvedReviewWhere.assignment,
          video: { ...approvedReviewWhere.assignment.video, ownerId } } },
        select: approvedReviewSelect,
      });
      if (!review || !await approvedReviewSource(tx, this.consent, ownerId, review))
        throw new NotFoundException({ code: "REVIEW_NOT_FOUND", message: "Review unavailable." });
      if (claimId) {
        const claim = await tx.reviewClaim.findFirst({ where: { id: claimId, reviewId: review.id, ownerId }, select: claimSelect });
        if (!claim || !ownerClaim(claim, ownerId, review.version)) claimUnavailable();
      }
      const scope = { ownerId, reviewId: review.id, reviewVersion: review.version };
      if (await tx.reviewDispute.count({ where: { ...scope, status: { in: ["OPEN", "IN_REVIEW"] } } })) disputeConflict();
      const dispute = await tx.reviewDispute.create({ data: { ...scope, claimId, reason }, select: disputeSelect });
      await tx.auditLog.create({ data: { actorId: ownerId, subjectType: "ReviewDispute", subjectId: dispute.id, action: "REVIEW_DISPUTE_OPENED" } });
      await requireCurrentSession(tx, auth);
      return { dispute };
    });
  }
}
