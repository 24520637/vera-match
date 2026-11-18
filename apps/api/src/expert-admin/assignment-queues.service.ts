import { ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { AssignmentStatus, Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth-context";
import { EnvironmentService } from "../config/environment.service";
import { PrismaService } from "../database/prisma.service";
import { ConsentAccessService } from "../consent/consent-access.service";
import { StaffAssuranceSource } from "../safety/staff-assurance.source";
import { nextCursor } from "../safety/safety.validation";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";
import { assignmentEvidence, requireCurrentAssignmentEvidence } from "./assignment-evidence";
import { candidateQuery, queueQuery } from "./assignment-queues.validation";

function denied(): never { throw new ForbiddenException({ code: "ASSIGNMENT_ASSURANCE_REQUIRED", message: "Current staff assurance is required for assignment metadata." }); }
function unavailable(): never { throw new NotFoundException({ code: "ASSIGNMENT_CANDIDATE_UNAVAILABLE", message: "This candidate pair is unavailable." }); }
function queueUnavailable(code = "ASSIGNMENT_QUEUE_UNAVAILABLE"): never {
  throw new ServiceUnavailableException({ code, message: "Assignment metadata could not be confirmed. Refresh before retrying." });
}

@Injectable()
export class AssignmentQueuesService {
  constructor(private readonly prisma: PrismaService, private readonly environment: EnvironmentService,
    private readonly assurance: StaffAssuranceSource, private readonly consent: ConsentAccessService,
    private readonly registry: ExpertApprovalRegistry, private readonly evidence: ExpertEvidenceSource) {}

  private async read<T>(auth: AuthContext, role: "EXPERT" | "MODERATOR", peers: string[],
    action: (tx: Prisma.TransactionClient, currentTime: () => Promise<Date>) => Promise<T>): Promise<T> {
    // No production metadata/assurance publication contract has been approved.
    // Neither role nor NODE_ENV alone grants access: test overrides must attest MFA.
    if (this.environment.values.nodeEnv !== "test" || auth.user.role !== role) denied();
    try {
      return await this.prisma.$transaction(async tx => {
        const ids = [...new Set([auth.user.id, ...peers])].sort();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
        const actor = await tx.user.findUnique({ where: { id: auth.user.id } });
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR SHARE`;
        const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
        if (!actor || actor.status !== "ACTIVE" || !actor.emailVerifiedAt || !session || session.userId !== auth.user.id || session.revokedAt)
          throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
        if (actor.role !== role) denied();
        const proof = await this.assurance.resolve(tx, auth);
        if (!proof || proof.userId !== actor.id || proof.sessionId !== session.id || proof.level !== "MFA" || proof.testOnly !== true ||
          !(proof.verifiedAt instanceof Date) || !Number.isFinite(proof.verifiedAt.getTime()) ||
          !(proof.expiresAt instanceof Date) || !Number.isFinite(proof.expiresAt.getTime())) denied();
        const currentTime = async () => {
          const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
          if (session.expiresAt <= clock.now) throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
          if (proof.verifiedAt > clock.now || proof.expiresAt <= clock.now) denied();
          return clock.now;
        };
        await currentTime();
        const result = await action(tx, currentTime);
        await currentTime();
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: "ASSIGNMENT_QUEUE_UNAVAILABLE", message: "Assignment metadata could not be confirmed. Refresh before retrying." });
    }
  }

  list(auth: AuthContext, role: "EXPERT" | "MODERATOR", input: unknown) {
    const query = queueQuery(input);
    if (role === "MODERATOR") return this.moderatorList(auth, query);
    return this.read(auth, role, [], async tx => {
      // Own metadata only. Moderator visibility is intentionally gated above.
      const rows = await tx.expertAssignment.findMany({ where: {
        expertId: auth.user.id,
        ...(query.status ? { status: query.status } : {}), ...(query.after ? { id: { lt: query.after } } : {}),
      }, orderBy: { id: "desc" }, take: 51, select: { id: true, status: true, dueAt: true } });
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: "ASSIGNMENT_QUEUE_READ", subjectType: "AssignmentQueue" } });
      return { assignments: rows.slice(0, 50).map(row => ({ ...row, dueAt: row.dueAt?.toISOString() ?? null })),
        nextCursor: rows.length > 50 ? nextCursor(rows[49].id) : null };
    });
  }

  private async moderatorList(auth: AuthContext, query: ReturnType<typeof queueQuery>) {
    if (!auth?.user || !auth.sessionId) throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
    if (auth.user.role !== "MODERATOR") denied();
    try {
      return await this.prisma.$transaction(async tx => {
        // Shared with Stage 2 grant/revoke: the recipient User is the serialization
        // point, before Session and any assignment/scope locks. Never lock a scope
        // then attempt to acquire its moderator User lock.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${auth.user.id} FOR UPDATE`;
        const actor = await tx.user.findUnique({ where: { id: auth.user.id } });
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR SHARE`;
        const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
        if (!actor || actor.status !== "ACTIVE" || !actor.emailVerifiedAt || !session || session.userId !== auth.user.id || session.revokedAt)
          throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
        if (actor.role !== "MODERATOR") denied();
        const clock = async () => {
          const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
          if (session.expiresAt <= row.now) throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
          return row.now;
        };
        await clock();
        let proof;
        try { proof = await this.assurance.resolve(tx, auth); }
        catch { queueUnavailable("ASSIGNMENT_ASSURANCE_UNAVAILABLE"); }
        if (!proof) queueUnavailable("ASSIGNMENT_ASSURANCE_UNAVAILABLE");
        if (proof.userId !== actor.id || proof.sessionId !== session.id || proof.level !== "MFA" || typeof proof.testOnly !== "boolean" ||
          (proof.testOnly && this.environment.values.nodeEnv !== "test") ||
          !(proof.verifiedAt instanceof Date) || !Number.isFinite(proof.verifiedAt.getTime()) ||
          !(proof.expiresAt instanceof Date) || !Number.isFinite(proof.expiresAt.getTime())) denied();
        const now = async () => {
          const at = await clock();
          if (proof.verifiedAt > at || proof.expiresAt <= at) denied();
          return at;
        };
        await now();
        // No real PA2 provisioning integration exists yet. A real-looking MFA
        // flag alone must not enable production reads of synthetic/legacy grants.
        // This explicit release gate requires reviewed integration, not an env flag.
        if (this.environment.values.nodeEnv !== "test") queueUnavailable("MODERATOR_QUEUE_PROVISIONING_UNAVAILABLE");
        const rows = await tx.$queryRaw<{ id: string; status: AssignmentStatus; dueAt: Date | null; grantExpiresAt: Date }[]>(Prisma.sql`
          WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS at), authorized AS MATERIALIZED (
            SELECT a.id, a.status, a."dueAt", g."expiresAt" AS "grantExpiresAt"
            FROM "ExpertAssignment" a
            JOIN "AssignmentModeratorScope" s ON s."assignmentId"=a.id
            JOIN "ExpertActorIdentity" i ON i."subjectId"=s."moderatorSubjectId" AND i."userId"=${actor.id}
            JOIN "AssignmentModeratorGrantEvent" g ON g.id=s."currentGrantId" AND g."scopeId"=s.id AND g.kind='GRANTED'
            CROSS JOIN clock
            WHERE g."expiresAt">clock.at AND NOT EXISTS (
              SELECT 1 FROM "AssignmentModeratorGrantEvent" r WHERE r."grantId"=g.id AND r.kind='REVOKED')
          )
          SELECT id,status,"dueAt","grantExpiresAt" FROM authorized WHERE TRUE
            ${query.status ? Prisma.sql`AND status=${query.status}::"AssignmentStatus"` : Prisma.empty}
            ${query.after ? Prisma.sql`AND id<${query.after}` : Prisma.empty}
          ORDER BY id DESC LIMIT 51`);
        await tx.auditLog.create({ data: { actorId: actor.id, action: "ASSIGNMENT_QUEUE_READ", subjectType: "AssignmentQueue" } });
        const at = await now();
        // Natural expiry is not frozen by row locks. Roll back the audit and return
        // no rows/cursor if a selected grant expires during the read/audit work.
        if (rows.some(row => row.grantExpiresAt <= at)) queueUnavailable();
        return { assignments: rows.slice(0, 50).map(row => ({ id: row.id, status: row.status, dueAt: row.dueAt?.toISOString() ?? null })),
          nextCursor: rows.length > 50 ? nextCursor(rows[49].id) : null };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 });
    } catch (error) { if (error instanceof HttpException) throw error; queueUnavailable(); }
  }

  async candidate(auth: AuthContext, input: unknown) {
    const query = candidateQuery(input);
    if (this.environment.values.nodeEnv !== "test" || auth.user.role !== "MODERATOR") denied();
    // Locator only. No private fields are projected or authorized before locks.
    const locator = await this.prisma.video.findUnique({ where: { id: query.videoId }, select: { ownerId: true } }).catch(() => {
      throw new ServiceUnavailableException({ code: "ASSIGNMENT_QUEUE_UNAVAILABLE", message: "Candidate access could not be confirmed." });
    });
    return this.read(auth, "MODERATOR", [query.expertId, ...(locator ? [locator.ownerId] : [])], async (tx, currentTime) => {
      await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${query.videoId} FOR UPDATE`;
      const video = await tx.video.findUnique({ where: { id: query.videoId } });
      if (!video || !locator || video.ownerId !== locator.ownerId || video.status !== "READY" || video.deletedAt || video.ownerId === query.expertId) unavailable();
      try {
        const generation = await this.consent.requireInTransaction(tx, video.ownerId, ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"]);
        await this.consent.requireGenerationInTransaction(tx, video.ownerId, generation.subjectId, video.storageConsentVersion, "VIDEO_STORAGE");
        const policies = await tx.consent.findMany({ where: { userId: video.ownerId, purpose: { in: ["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW"] } }, include: { policyEvidence: true } });
        if (policies.length !== 2 || policies.some(row => row.policyEvidence?.testOnly !== true)) unavailable();
      } catch (error) { if (error instanceof ForbiddenException) unavailable(); throw error; }
      await tx.$queryRaw`SELECT "userId" FROM "ExpertCredential" WHERE "userId"=${query.expertId} FOR UPDATE`;
      const expert = await tx.user.findUnique({ where: { id: query.expertId } });
      const credential = await tx.expertCredential.findUnique({ where: { userId: query.expertId }, include: { approval: true } });
      if (!expert || expert.role !== "EXPERT" || expert.status !== "ACTIVE" || !expert.emailVerifiedAt || !credential ||
        credential.status !== "APPROVED" || !credential.approval || credential.approval.subjectId !== credential.subjectId) unavailable();
      const limits = await assignmentEvidence(credential.approval, expert.id, this.registry, this.evidence);
      await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE "videoId"=${video.id} ORDER BY id FOR UPDATE`;
      if (await tx.expertAssignment.count({ where: { videoId: video.id, status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] } } }) ||
        await tx.block.count({ where: { OR: [{ blockerId: video.ownerId, blockedId: expert.id }, { blockerId: expert.id, blockedId: video.ownerId }] } })) unavailable();
      requireCurrentAssignmentEvidence(credential.approval, limits, await currentTime());
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: "ASSIGNMENT_CANDIDATE_READ", subjectType: "Video", subjectId: video.id } });
      requireCurrentAssignmentEvidence(credential.approval, limits, await currentTime());
      return { candidate: { videoId: video.id, expertId: expert.id, expectedCredentialRevision: Number(credential.revision) } };
    });
  }
}
