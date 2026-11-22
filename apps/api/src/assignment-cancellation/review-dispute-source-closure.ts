import { Prisma } from "@prisma/client";

// Only permanent source loss qualifies. An expired staff grant, a block, or
// withdrawal of a matching-only purpose is not a case disposition.
export function sourceUnavailableDisputes(scope?: { id: string; ownerId: string }) {
  return Prisma.sql`
    SELECT d.id COLLATE "C" AS id, d."inReviewAt",
      LEAST(withdrawal."withdrawnAt",
        CASE WHEN v.status = 'DELETED' OR v."deletedAt" IS NOT NULL
          THEN COALESCE(v."deletedAt", v."createdAt") END) AS "queuedAt",
      (withdrawal."withdrawnAt" IS NOT NULL
        AND (v."deletedAt" IS NULL OR withdrawal."withdrawnAt" <= v."deletedAt")) AS "withdrawalFirst"
    FROM "ReviewDispute" d
    JOIN "ExpertReview" r ON r.id = d."reviewId"
    JOIN "ExpertAssignment" a ON a.id = r."assignmentId"
    JOIN "Video" v ON v.id = a."videoId" AND v."ownerId" = d."ownerId"
    LEFT JOIN "ConsentLedger" l ON l."userId" = v."ownerId"
    CROSS JOIN LATERAL (
      SELECT min(t."createdAt") AS "withdrawnAt" FROM "ConsentWithdrawalTask" t
      WHERE (t.purpose = 'VIDEO_STORAGE' AND t."subjectId" = l."subjectId"
          AND t.version > v."storageConsentVersion")
        OR (t.purpose = 'EXPERT_VIDEO_REVIEW' AND t."subjectId" = a."reviewConsentSubjectId"
          AND t.version > a."reviewConsentVersion")
    ) withdrawal
    WHERE d."reviewVersion" IS NOT NULL AND d.status IN ('OPEN', 'IN_REVIEW')
      ${scope ? Prisma.sql`AND d.id = ${scope.id} AND d."ownerId" = ${scope.ownerId}` : Prisma.empty}
      AND (v.status = 'DELETED' OR v."deletedAt" IS NOT NULL OR withdrawal."withdrawnAt" IS NOT NULL)`;
}

/** Caller holds the dispute owner's User lock, shared with source mutation and
 * the owner/moderator request paths. Selection outside this lock is scheduling only.
 */
export async function closeSourceUnavailableDispute(tx: Prisma.TransactionClient, id: string, ownerId: string) {
  const [source] = await tx.$queryRaw<{ withdrawalFirst: boolean; inReviewAt: Date | null }[]>(
    sourceUnavailableDisputes({ id, ownerId }),
  );
  if (!source) return;
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`
    SELECT GREATEST((clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3), ${source.inReviewAt}::timestamp) AS now`;
  const changed = await tx.reviewDispute.updateMany({
    where: { id, ownerId, status: { in: ["OPEN", "IN_REVIEW"] }, reviewVersion: { not: null } },
    data: {
      status: "CLOSED_SOURCE_UNAVAILABLE",
      revision: { increment: 1 },
      resolvedAt: clock.now,
    },
  });
  if (changed.count !== 1) return;
  await tx.auditLog.create({
    data: {
      action: source.withdrawalFirst ? "REVIEW_DISPUTE_CLOSED_CONSENT_WITHDRAWN" : "REVIEW_DISPUTE_CLOSED_VIDEO_DELETED",
      subjectType: "ReviewDispute",
      subjectId: id,
    },
  });
}
