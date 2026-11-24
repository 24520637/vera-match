import { Prisma } from "@prisma/client";

/** Both moderator queue and QA queries alias the grant as g and its actor link as i. */
export function assignmentGrantRuntimeFilter(testRuntime: boolean) {
  if (testRuntime) return Prisma.empty;
  return Prisma.sql`
    AND g."actorEvidence"->'testOnly' = 'false'::jsonb
    AND EXISTS (
      SELECT 1 FROM "StaffIdentity" staff
      WHERE staff."userId"=i."userId" AND staff.role='MODERATOR' AND staff.state='ACTIVE'
        AND staff."expiresAt">clock_timestamp()
        AND staff."subjectId"::text=g."actorEvidence"->>'moderatorStaffSubject'
        AND staff."mfaEpoch"::text=g."actorEvidence"->>'moderatorMfaEpoch'
    )
  `;
}
