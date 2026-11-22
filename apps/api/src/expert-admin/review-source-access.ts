import { ForbiddenException } from "@nestjs/common";
import type { ExpertAssignment, Prisma, Video } from "@prisma/client";
import type { ConsentAccessService } from "../consent/consent-access.service";

export async function requireReviewSource(tx: Prisma.TransactionClient, consent: ConsentAccessService,
  assignment: Pick<ExpertAssignment, "expertId" | "cancelledAt" | "reviewConsentSubjectId" | "reviewConsentVersion">,
  video: Pick<Video, "ownerId" | "status" | "deletedAt" | "storageConsentVersion">) {
  if (video.status !== "READY" || video.deletedAt || assignment.cancelledAt || video.ownerId === assignment.expertId)
    throw new ForbiddenException({ code: "REVIEW_SOURCE_UNAVAILABLE", message: "The review source is unavailable." });
  const ownerId = video.ownerId;
  const generation = await consent.requireInTransaction(tx, ownerId, ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"]);
  await consent.requireGenerationInTransaction(tx, ownerId, generation.subjectId, video.storageConsentVersion, "VIDEO_STORAGE");
  await consent.requireGenerationInTransaction(tx, ownerId, assignment.reviewConsentSubjectId,
    assignment.reviewConsentVersion, "EXPERT_VIDEO_REVIEW");
  if (await tx.block.count({ where: { OR: [
    { blockerId: ownerId, blockedId: assignment.expertId },
    { blockerId: assignment.expertId, blockedId: ownerId },
  ] } })) throw new ForbiddenException({ code: "REVIEW_SOURCE_UNAVAILABLE", message: "The review source is unavailable." });
}
