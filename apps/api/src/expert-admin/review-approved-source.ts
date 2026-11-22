import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ConsentAccessService } from "../consent/consent-access.service";
import { requireReviewSource } from "./review-source-access";

export const approvedReviewWhere = {
  status: "APPROVED", submittedAt: { not: null }, qaAt: { not: null }, qaById: { not: null },
  decisions: { some: { status: "APPROVED" } },
  assignment: { status: "COMPLETED", cancelledAt: null, video: { status: "READY", deletedAt: null } },
} satisfies Prisma.ExpertReviewWhereInput;

export const approvedReviewSelect = {
  id: true, version: true, summary: true, limitations: true, qaAt: true, qaById: true,
  decisions: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1,
    select: { version: true, moderatorId: true, decidedAt: true } },
  assignment: { select: {
    expertId: true, cancelledAt: true, reviewConsentSubjectId: true, reviewConsentVersion: true,
    expert: { select: { displayName: true } },
    video: { select: { id: true, ownerId: true, status: true, deletedAt: true, storageConsentVersion: true, createdAt: true } },
  } },
} satisfies Prisma.ExpertReviewSelect;

type ApprovedReview = Prisma.ExpertReviewGetPayload<{ select: typeof approvedReviewSelect }>;

export async function approvedReviewSource(tx: Prisma.TransactionClient, consent: ConsentAccessService,
  ownerId: string, review: ApprovedReview) {
  const { assignment, summary, limitations, decisions: [decision] } = review;
  const { video } = assignment;
  if (video.ownerId !== ownerId || !summary?.trim() || !limitations?.trim() ||
    !decision || decision.version !== review.version || decision.moderatorId !== review.qaById ||
    decision.moderatorId === assignment.expertId || decision.moderatorId === ownerId ||
    decision.decidedAt.getTime() !== review.qaAt?.getTime()) return null;
  try {
    await requireReviewSource(tx, consent, assignment, video);
    return { decision, video, summary, limitations };
  } catch (error) {
    if (error instanceof ForbiddenException) return null;
    throw error;
  }
}
