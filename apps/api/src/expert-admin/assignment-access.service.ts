import { ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ExpertAssignment, Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { EnvironmentService } from "../config/environment.service";
import { ConsentAccessService } from "../consent/consent-access.service";
import { PrismaService } from "../database/prisma.service";
import { assignmentEvidence, requireCurrentAssignmentEvidence } from "./assignment-evidence";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";
import { ExpertMfaSource } from "./expert-mfa.source";
import { approvalInvalid } from "./expert-approval.validation";

function denied(): never {
  throw new ForbiddenException({ code: "ASSIGNMENT_ACCESS_DENIED", message: "This assignment is not accessible." });
}
function unavailable(): never {
  throw new ServiceUnavailableException({ code: "EXPERT_ACCESS_UNAVAILABLE", message: "Expert access could not be safely confirmed." });
}

/** Authorization is transaction-bound, never a reusable access token. */
@Injectable()
export class AssignmentAccessService {
  constructor(private readonly prisma: PrismaService, private readonly consent: ConsentAccessService,
    private readonly environment: EnvironmentService, private readonly registry: ExpertApprovalRegistry,
    private readonly evidence: ExpertEvidenceSource, private readonly mfa: ExpertMfaSource) {}

  /** Upstream HttpException payloads are not application-owned public errors. */
  private async trustedSource<T>(load: () => Promise<T>): Promise<T> {
    try { return await load(); } catch { unavailable(); }
  }

  requireRuntimeExpert(auth: AuthContext) {
    if (auth.user.role !== "EXPERT") denied();
  }

  async withAuthorizedAssignment<T>(auth: AuthContext, assignmentId: string,
    action: (tx: Prisma.TransactionClient, access: Readonly<{ assignmentId: string; assignment: ExpertAssignment; videoId: string;
      video: { bucket: string; objectKey: string; mimeType: string; durationMs: number | null }; validateTime: () => Promise<{ now: Date; expiresAt: Date }> }>) => Promise<T>,
    scope: "playback" | "review" = "playback"): Promise<T> {
    this.requireRuntimeExpert(auth);
    // Match C033 resource identifiers; validate before any assignment DB lookup.
    if (typeof assignmentId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(assignmentId))
      approvalInvalid("assignmentId", "Send a valid identifier.");
    try {
      return await this.prisma.$transaction(async tx => {
        const testRuntime = this.environment.values.nodeEnv === "test";
        const locator = await tx.expertAssignment.findUnique({ where: { id: assignmentId }, select: { videoId: true, expertId: true, video: { select: { ownerId: true } } } });
        if (!locator || locator.expertId !== auth.user.id) throw new NotFoundException({ code: "ASSIGNMENT_NOT_FOUND", message: "Assignment not found." });
        const ownerId = locator.video.ownerId;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${auth.user.id}, ${ownerId}) ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR SHARE`;
        const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
        const expert = await tx.user.findUnique({ where: { id: auth.user.id } });
        if (!session || session.userId !== auth.user.id || session.revokedAt) throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
        if (!expert || expert.role !== "EXPERT" || expert.status !== "ACTIVE" || !expert.emailVerifiedAt) denied();
        const assurance = await this.trustedSource(() => this.mfa.resolve(auth, tx));
        if (!assurance || assurance.userId !== expert.id || assurance.sessionId !== session.id ||
          assurance.testOnly !== testRuntime || !(assurance.expiresAt instanceof Date) || !Number.isFinite(assurance.expiresAt.getTime())) denied();
        await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${locator.videoId} FOR UPDATE`;
        const video = await tx.video.findUnique({ where: { id: locator.videoId } });
        if (!video || video.status !== "READY" || video.deletedAt || video.ownerId !== ownerId || ownerId === expert.id) denied();
        const generation = await this.consent.requireInTransaction(tx, ownerId, ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"]);
        const policies = await tx.consent.findMany({ where: { userId: ownerId, purpose: { in: ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"] } }, include: { policyEvidence: true } });
        if (policies.length !== 2 || policies.some(row => row.policyEvidence?.testOnly !== testRuntime)) unavailable();
        await this.consent.requireGenerationInTransaction(tx, ownerId, generation.subjectId, video.storageConsentVersion, "VIDEO_STORAGE");
        await tx.$queryRaw`SELECT "userId" FROM "ExpertCredential" WHERE "userId"=${expert.id} FOR UPDATE`;
        const credential = await tx.expertCredential.findUnique({ where: { userId: expert.id }, include: { approval: true } });
        if (!credential || credential.status !== "APPROVED" || !credential.approval || credential.approval.subjectId !== credential.subjectId) denied();
        await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${assignmentId} ORDER BY id FOR UPDATE`;
        const assignment = await tx.expertAssignment.findUnique({ where: { id: assignmentId } });
        const statuses = scope === "review" ? ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "COMPLETED"] : ["ASSIGNED", "IN_PROGRESS"];
        if (!assignment || assignment.expertId !== expert.id || assignment.videoId !== video.id ||
          assignment.credentialApprovalId !== credential.approval.id ||
          !statuses.includes(assignment.status) || assignment.cancelledAt) denied();
        await this.consent.requireGenerationInTransaction(tx, ownerId, assignment.reviewConsentSubjectId, assignment.reviewConsentVersion, "EXPERT_VIDEO_REVIEW");
        const boundApproval = credential.approval;
        if (!boundApproval || boundApproval.subjectId !== credential.subjectId) denied();
        const boundLimits = await this.trustedSource(() => assignmentEvidence(boundApproval, expert.id, this.registry, this.evidence));
        if (await tx.block.count({ where: { OR: [{ blockerId: ownerId, blockedId: expert.id }, { blockerId: expert.id, blockedId: ownerId }] } })) denied();
        const validateTime = async () => {
          const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
          if (session.expiresAt <= clock.now) throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
          if (assurance.expiresAt <= clock.now || (assignment.expiresAt && assignment.expiresAt <= clock.now)) denied();
          // dueAt is a work deadline, never an access expiry.
          requireCurrentAssignmentEvidence(boundApproval, boundLimits, clock.now);
          const expiresAt = new Date(Math.min(session.expiresAt.getTime(), assurance.expiresAt.getTime(),
            assignment.expiresAt?.getTime() ?? Infinity, ...boundLimits.map(date => date.getTime())));
          return { now: clock.now, expiresAt };
        };
        await validateTime();
        return action(tx, Object.freeze({ assignmentId, assignment, videoId: video.id,
          video: { bucket: video.bucket, objectKey: video.objectKey, mimeType: video.mimeType, durationMs: video.durationMs }, validateTime }));
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      unavailable();
    }
  }
}
