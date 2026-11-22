import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ConsentAccessService } from "../consent/consent-access.service";

export const claimSharingPurposes = ["PROFILE_MATCHING", "REPORT_SHARING", "VIDEO_CLAIM_MATCHING"] as const;

export async function activeClaimShare(tx: Prisma.TransactionClient, consent: ConsentAccessService, ownerId: string,
  claim: { ownerConfirmed: boolean; shareApproved: boolean; revokedAt: Date | null;
    shareConsentSubjectId: string | null; shareConsentVersion: bigint | null }) {
  if (!claim.ownerConfirmed || !claim.shareApproved || claim.revokedAt ||
    !claim.shareConsentSubjectId || claim.shareConsentVersion === null) return false;
  try {
    await consent.requireInTransaction(tx, ownerId, claimSharingPurposes);
    for (const purpose of claimSharingPurposes) {
      await consent.requireGenerationInTransaction(tx, ownerId, claim.shareConsentSubjectId, claim.shareConsentVersion, purpose);
    }
    return true;
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}
