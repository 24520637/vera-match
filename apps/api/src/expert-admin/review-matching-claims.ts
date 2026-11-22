import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ConsentAccessService } from "../consent/consent-access.service";
import { pairBlockWhere } from "../safety/block-access.service";
import { lockSafetyUsers } from "../safety/safety-access.service";
import { approvedReviewSelect, approvedReviewSource, approvedReviewWhere } from "./review-approved-source";
import { activeClaimShare } from "./review-claim-consent";
import { factualStatements, isFactualStatement, type FactualStatement } from "./review-claim.validation";

/**
 * Read immediately before scoring and projecting reasons in the same transaction.
 * Acquire these sorted User locks before any narrower locks in the matching flow.
 */
export async function readMatchingClaimsInTransaction(tx: Prisma.TransactionClient, consent: ConsentAccessService,
  viewerId: string, candidateId: string) {
  if (viewerId === candidateId) return [];
  await lockSafetyUsers(tx, [viewerId, candidateId]);
  if (await tx.block.count({ where: pairBlockWhere(viewerId, candidateId) })) return [];
  try {
    await consent.requireInTransaction(tx, viewerId, ["PROFILE_MATCHING"]);
  } catch (error) {
    if (error instanceof ForbiddenException) return [];
    throw error;
  }
  const rows = await tx.reviewClaim.findMany({
    where: {
      ownerId: candidateId, reviewVersion: { not: null }, qaApproved: true, ownerConfirmed: true, shareApproved: true, revokedAt: null,
      sourceCategory: "SPEECH", sourceObservationId: { not: null },
      claimType: { in: Object.keys(factualStatements) },
      review: { ...approvedReviewWhere, assignment: { ...approvedReviewWhere.assignment,
        video: { ...approvedReviewWhere.assignment.video, ownerId: candidateId } } },
    },
    orderBy: { id: "asc" },
    select: {
      id: true, reviewVersion: true, claimType: true, claimText: true, ownerConfirmed: true, shareApproved: true, revokedAt: true,
      shareConsentSubjectId: true, shareConsentVersion: true,
      review: { select: { ...approvedReviewSelect,
        disputes: { where: { ownerId: candidateId, status: { in: ["OPEN", "IN_REVIEW", "RESOLVED"] } },
          select: { claimId: true, reviewVersion: true } },
      } },
    },
  });
  const eligible = new Map<FactualStatement, string>();
  for (const row of rows) {
    const { review, claimType } = row;
    if (row.reviewVersion !== review.version || !isFactualStatement(claimType) ||
      row.claimText !== factualStatements[claimType] || eligible.has(claimType)) continue;
    if (review.disputes.some(dispute => dispute.reviewVersion === review.version &&
      (dispute.claimId === null || dispute.claimId === row.id))) continue;
    if (!await activeClaimShare(tx, consent, candidateId, row) ||
      !await approvedReviewSource(tx, consent, candidateId, review)) continue;
    eligible.set(claimType, factualStatements[claimType]);
    if (eligible.size === Object.keys(factualStatements).length) break;
  }
  return Array.from(eligible, ([type, statement]) => ({ type, statement }));
}
