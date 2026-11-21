import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { ConsentAccessService } from "../consent/consent-access.service";
import { SafetyAccessService } from "../safety/safety-access.service";
import { requireReviewSource } from "./review-source-access";

const pageSize = 10;
const reportSelect = {
  id: true, version: true, summary: true, limitations: true, qaAt: true, qaById: true,
  decisions: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1,
    select: { version: true, moderatorId: true, decidedAt: true } },
  assignment: { select: {
    expertId: true, cancelledAt: true, reviewConsentSubjectId: true, reviewConsentVersion: true,
    expert: { select: { displayName: true } },
    video: { select: { id: true, ownerId: true, status: true, deletedAt: true, storageConsentVersion: true, createdAt: true } },
  } },
} satisfies Prisma.ExpertReviewSelect;

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
            where: { status: "APPROVED", submittedAt: { not: null }, qaAt: { not: null }, qaById: { not: null },
              decisions: { some: { status: "APPROVED" } }, ...(cursor ? { id: { gt: cursor } } : {}),
              assignment: { status: "COMPLETED", cancelledAt: null, reviewConsentSubjectId: consent.subjectId,
                video: { ownerId, status: "READY", deletedAt: null } } },
            orderBy: { id: "asc" }, take: pageSize + 1, select: reportSelect,
          });
          for (const row of candidates) {
            const { assignment } = row;
            const { video } = assignment;
            const decision = row.decisions[0];
            if (video.ownerId !== ownerId || !row.summary?.trim() || !row.limitations?.trim() ||
              !decision || decision.version !== row.version || decision.moderatorId !== row.qaById ||
              decision.moderatorId === assignment.expertId || decision.moderatorId === ownerId ||
              decision.decidedAt.getTime() !== row.qaAt?.getTime()) continue;
            try {
              await requireReviewSource(tx, this.consent, assignment, video);
            } catch (error) {
              if (error instanceof ForbiddenException) continue;
              throw error;
            }
            reports.push({
              id: row.id, summary: row.summary, limitations: row.limitations, approvedAt: decision.decidedAt,
              reviewer: assignment.expert.displayName, source: { videoId: video.id, uploadedAt: video.createdAt },
            });
            if (reports.length > pageSize) break;
          }
          if (candidates.length <= pageSize) break;
          cursor = candidates[candidates.length - 1].id;
        }
      }
      await tx.auditLog.create({ data: { actorId: ownerId, subjectType: "ExpertReview", action: "EXPERT_REVIEW_OWNER_REPORTS_READ" } });
      const session = await tx.session.findUnique({ where: { id: auth.sessionId }, select: { expiresAt: true } });
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
      if (!session || session.expiresAt <= clock.now)
        throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
      return { reports: reports.slice(0, pageSize), nextCursor: reports.length > pageSize ? reports[pageSize - 1].id : null };
    });
  }
}
