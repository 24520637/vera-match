import type { Prisma } from "@prisma/client";
import { factualStatements, isFactualStatement } from "./review-claim.validation";

export const claimSelect = {
  id: true, claimType: true, ownerId: true, reviewVersion: true, claimText: true, qaApproved: true,
  sourceObservationId: true, sourceCategory: true, sourceStartMs: true, sourceEndMs: true, transcript: true, context: true,
  revision: true, ownerConfirmed: true, shareApproved: true, revokedAt: true,
  shareConsentSubjectId: true, shareConsentVersion: true,
} satisfies Prisma.ReviewClaimSelect;

type Claim = Prisma.ReviewClaimGetPayload<{ select: typeof claimSelect }>;

export function ownerClaim(claim: Claim, ownerId: string, reviewVersion: number) {
  if (!claim.qaApproved || claim.ownerId !== ownerId || claim.reviewVersion !== reviewVersion ||
    !isFactualStatement(claim.claimType) || claim.claimText !== factualStatements[claim.claimType] ||
    !claim.sourceObservationId || claim.sourceCategory !== "SPEECH" || claim.sourceStartMs === null || claim.sourceEndMs === null ||
    claim.sourceStartMs < 0 || claim.sourceEndMs < claim.sourceStartMs || !claim.context?.trim()) return null;
  return {
    id: claim.id, type: claim.claimType, statement: factualStatements[claim.claimType],
    evidence: { startMs: claim.sourceStartMs, endMs: claim.sourceEndMs, transcript: claim.transcript, context: claim.context },
    ownerConfirmed: claim.ownerConfirmed, shareApproved: claim.shareApproved, revokedAt: claim.revokedAt, revision: claim.revision,
  };
}
