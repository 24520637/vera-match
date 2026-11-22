import { ConflictException } from "@nestjs/common";
import { AssignmentStatus, ExpertAssignment, Prisma } from "@prisma/client";

export async function transitionReviewAssignment(tx: Prisma.TransactionClient, assignment: ExpertAssignment,
  status: AssignmentStatus, actorId: string) {
  const actor = await tx.expertActorIdentity.upsert({ where: { userId: actorId }, create: { userId: actorId }, update: {} });
  const changed = await tx.expertAssignment.updateMany({
    where: { id: assignment.id, status: assignment.status, revision: assignment.revision },
    data: { status, revision: { increment: 1 } },
  });
  if (changed.count !== 1) throw new ConflictException({ code: "RESOURCE_REVISION_CONFLICT", message: "The assignment changed. Reload the review." });
  await tx.$executeRaw`INSERT INTO "AssignmentEvent"
    ("assignmentId",revision,"fromStatus","toStatus","credentialApprovalId","actorEvidence",snapshot)
    SELECT id,revision,${assignment.status}::"AssignmentStatus",status,"credentialApprovalId",
      jsonb_build_object('subject',${actor.subjectId}::text),
      to_jsonb(a)-ARRAY['assignedById','expertId','eventFromStatus','eventTransactionId']::text[]
    FROM "ExpertAssignment" a WHERE id=${assignment.id}`;
  return { ...assignment, status, revision: assignment.revision + 1n };
}
