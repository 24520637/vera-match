import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { ConsentAccessService } from "../consent/consent-access.service";
import { parseIdempotencyKey } from "../consent/consent.validation";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";
import { assignmentFingerprint, parseAssignment } from "./assignment.validation";
import { approvalInvalid } from "./expert-approval.validation";
import { assignmentEvidence, assignmentUnavailable, requireCurrentAssignmentEvidence } from "./assignment-evidence";

const operation = "CREATE_ASSIGNMENT";
function conflict(code = "ASSIGNMENT_CONFLICT"): never {
  throw new ConflictException({ code, message: "Assignment state changed or this operation conflicts. Review before submitting again." });
}
function forbidden(): never { throw new ForbiddenException({ code: "ASSIGNMENT_INELIGIBLE", message: "This assignment is not eligible." }); }

@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService, private readonly consent: ConsentAccessService,
    private readonly environment: EnvironmentService, private readonly registry: ExpertApprovalRegistry,
    private readonly evidence: ExpertEvidenceSource) {}
  async create(auth: AuthContext, body: unknown, header: unknown) {
    const input = parseAssignment(body), keyHash = parseIdempotencyKey(header), fingerprint = assignmentFingerprint(input);
    try {
      // No trusted staff-MFA source is implemented. Do not expose real member
      // data by enabling this route through a role/client/environment bypass.
      if (this.environment.values.nodeEnv !== "test")
        throw new ServiceUnavailableException({ code: "ASSIGNMENT_ASSURANCE_UNAVAILABLE", message: "Real-data assignment requires approved staff assurance and evidence integrations." });
      return await this.prisma.$transaction(async tx => {
        const locator = await tx.video.findUnique({ where: { id: input.videoId }, select: { ownerId: true } });
        const ownerId = locator?.ownerId ?? "";
        await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${auth.user.id}, ${input.expertId}, ${ownerId}) ORDER BY id FOR UPDATE`;
        const moderator = await tx.user.findUnique({ where: { id: auth.user.id }, select: { role: true, status: true, emailVerifiedAt: true } });
        if (!moderator || moderator.role !== "MODERATOR" || moderator.status !== "ACTIVE" || !moderator.emailVerifiedAt) forbidden();
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR SHARE`;
        const session = await tx.session.findUnique({ where: { id: auth.sessionId }, select: { userId: true, revokedAt: true, expiresAt: true } });
        if (!session || session.userId !== auth.user.id || session.revokedAt)
          throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
        const actor = await tx.expertActorIdentity.findUnique({ where: { userId: auth.user.id } });
        if (actor) {
          const previous = await tx.assignmentIdempotency.findUnique({ where: { actorSubjectId_operation_keyHash: {
            actorSubjectId: actor.subjectId, operation, keyHash,
          } } });
          if (previous) {
            if (previous.fingerprint !== fingerprint) conflict("IDEMPOTENCY_KEY_REUSED");
            const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
            if (session.expiresAt <= clock.now)
              throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
            // Historical receipt only, never a new authorization or mutation.
            return { response: previous.response, replayed: true };
          }
        }
        await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${input.videoId} FOR UPDATE`;
        const video = await tx.video.findUnique({ where: { id: input.videoId } });
        if (!video) throw new NotFoundException({ code: "VIDEO_NOT_FOUND", message: "Video not found." });
        if (video.ownerId !== ownerId) conflict();
        if (video.status !== "READY" || video.deletedAt) forbidden();
        if (ownerId === input.expertId) forbidden();
        const generation = await this.consent.requireInTransaction(tx, ownerId, ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"]);
        await this.consent.requireGenerationInTransaction(tx, ownerId, generation.subjectId, generation.version, "EXPERT_VIDEO_REVIEW");
        const policies = await tx.consent.findMany({ where: { userId: ownerId, purpose: { in: ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"] } },
          select: { policyEvidence: { select: { testOnly: true } } } });
        // NODE_ENV=test alone cannot authorize ordinary real-policy records.
        if (policies.length !== 2 || policies.some(row => row.policyEvidence?.testOnly !== true)) assignmentUnavailable();
        if (video.storageConsentVersion === null || video.storageConsentVersion > generation.version ||
          await tx.consentWithdrawalTask.count({ where: { subjectId: generation.subjectId, purpose: "VIDEO_STORAGE", version: { gt: video.storageConsentVersion } } }))
          conflict("VIDEO_WITHDRAWN");
        await tx.$queryRaw`SELECT "userId" FROM "ExpertCredential" WHERE "userId"=${input.expertId} FOR UPDATE`;
        const expert = await tx.user.findUnique({ where: { id: input.expertId }, select: { role: true, status: true, emailVerifiedAt: true } });
        if (!expert || expert.role !== "EXPERT" || expert.status !== "ACTIVE" || !expert.emailVerifiedAt) forbidden();
        const credential = await tx.expertCredential.findUnique({ where: { userId: input.expertId }, include: { approval: true } });
        if (!credential || credential.status !== "APPROVED" || !credential.approval || credential.approval.subjectId !== credential.subjectId) forbidden();
        if (credential.revision !== BigInt(input.expectedCredentialRevision)) conflict("RESOURCE_REVISION_CONFLICT");
        const limits = await assignmentEvidence(credential.approval, input.expertId, this.registry, this.evidence);
        if (await tx.block.count({ where: { OR: [
          { blockerId: ownerId, blockedId: input.expertId }, { blockerId: input.expertId, blockedId: ownerId },
        ] } })) forbidden();
        await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE "videoId"=${video.id} ORDER BY id FOR UPDATE`;
        if (await tx.expertAssignment.count({ where: { videoId: video.id, status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] } } })) conflict();
        const retainedActor = actor ?? await tx.expertActorIdentity.create({ data: { userId: auth.user.id } });
        const actorEvidence = { subject: retainedActor.subjectId };
        // All relevant rows are locked and all external evidence I/O is complete.
        // Natural expiry still advances while locks are held: use actual database
        // clock time at the mutation decision, never transaction_timestamp/now().
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
        const now = clock.now;
        if (session.expiresAt <= now)
          throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
        requireCurrentAssignmentEvidence(credential.approval, limits, now);
        for (const [field, value] of [["dueAt", input.dueAt], ["expiresAt", input.expiresAt]] as const)
          if (value && value <= now) approvalInvalid(field, "Use a future UTC timestamp or null.");
        if (input.expiresAt && limits.some(limit => input.expiresAt! > limit)) approvalInvalid("expiresAt", "Access expiry must not exceed qualification evidence validity.");
        const assignment = await tx.expertAssignment.create({ data: { videoId: video.id, expertId: input.expertId,
          assignedById: auth.user.id, assignedByEvidence: actorEvidence, credentialApprovalId: credential.approval.id,
          reviewConsentSubjectId: generation.subjectId, reviewConsentVersion: generation.version,
          dueAt: input.dueAt, expiresAt: input.expiresAt } });
        await tx.$executeRaw`INSERT INTO "AssignmentEvent" ("assignmentId",revision,"fromStatus","toStatus","credentialApprovalId","actorEvidence",snapshot)
          SELECT id,revision,NULL,status,"credentialApprovalId",${JSON.stringify(actorEvidence)}::jsonb,
            to_jsonb(a)-ARRAY['assignedById','expertId','eventFromStatus','eventTransactionId']::text[]
          FROM "ExpertAssignment" a WHERE id=${assignment.id}`;
        await tx.auditLog.create({ data: { actorId: auth.user.id, action: "EXPERT_ASSIGNMENT_CREATED", subjectType: "ExpertAssignment", subjectId: assignment.id } });
        const response = { assignment: { id: assignment.id, videoId: video.id, expertId: input.expertId, status: "ASSIGNED", revision: 0,
          credentialApprovalId: credential.approval.id, dueAt: input.dueAt?.toISOString() ?? null, expiresAt: input.expiresAt?.toISOString() ?? null } };
        await tx.assignmentIdempotency.create({ data: { actorSubjectId: retainedActor.subjectId, operation, keyHash, fingerprint,
          assignmentId: assignment.id, response } });
        return { response, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) conflict();
      assignmentUnavailable();
    }
  }
}
