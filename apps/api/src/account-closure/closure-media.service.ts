import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

// A withdrawal receipt confirms worker processing. Verify storage completion
// separately, including the final object and any still-live staging capability.
const readyMedia = Prisma.sql`
  c.state = 'RESTRICTED' AND c.revision = 1 AND u.status = 'CLOSED'
  AND (
    SELECT count(*) FROM "ConsentWithdrawalTask" t
    JOIN "ConsentEvent" e ON e.id = t."eventId" AND e."subjectId" = t."subjectId"
      AND e."nextVersion" = t.version AND e.purpose = t.purpose AND NOT e."newGranted"
    JOIN "AssignmentWithdrawalReceipt" a ON a."withdrawalTaskId" = t.id
    WHERE t."subjectId" = l."subjectId" AND t.version = l.version
      AND (t.purpose = 'EXPERT_VIDEO_REVIEW' OR (
        t.purpose = 'VIDEO_STORAGE' AND EXISTS (
          SELECT 1 FROM "VideoWithdrawalReceipt" r WHERE r."withdrawalTaskId" = t.id
        )
      ))
  ) = 2
  AND NOT EXISTS (
    SELECT 1 FROM "Video" v
    WHERE v."ownerId" = c."userId" AND (
      v.status <> 'DELETED' OR v."deletedAt" IS NULL OR v."cleanupCompletedAt" IS NULL
      OR v."uploadKey" IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM "VideoCleanupTask" t WHERE t."videoId" = v.id
          AND t.bucket = v.bucket AND t."objectKey" = v."objectKey"
          AND t."removeFinal" AND t.status = 'COMPLETE' AND t."completedAt" IS NOT NULL
          AND (t."uploadExpiresAt" IS NULL OR t."uploadExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC'))
      )
      OR EXISTS (
        SELECT 1 FROM "ExpertAssignment" a WHERE a."videoId" = v.id
          AND a.status IN ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED')
      )
    )
  )
`;

type PendingMedia = { id: string; userId: string };

@Injectable()
export class ClosureMediaService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcileReady() {
    const candidates = await this.prisma.$queryRaw<PendingMedia[]>(Prisma.sql`
      SELECT c.id, c."userId" FROM "AccountClosureConsumer" m
      JOIN "AccountClosure" c ON c.id = m."closureId"
      JOIN "User" u ON u.id = c."userId"
      JOIN "ConsentLedger" l ON l."userId" = c."userId"
      WHERE m.name = 'MEDIA' AND m.status = 'PENDING' AND ${readyMedia}
      ORDER BY c."createdAt", c.id LIMIT 20
    `);
    for (const { id, userId } of candidates) {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        // The same User lock serializes C051 and consent updates. Recheck all
        // conditions before writing this one monotonic, closure-bound receipt.
        await tx.$executeRaw(Prisma.sql`
          UPDATE "AccountClosureConsumer" m SET status = 'ACKNOWLEDGED'
          FROM "AccountClosure" c
          JOIN "User" u ON u.id = c."userId"
          JOIN "ConsentLedger" l ON l."userId" = c."userId"
          WHERE m."closureId" = c.id AND c.id = ${id}::uuid AND c."userId" = ${userId}
            AND m.name = 'MEDIA' AND m.status = 'PENDING' AND ${readyMedia}
        `);
      });
    }
  }
}
