import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AuthContext } from "../auth/auth-context";
import { EnvironmentService } from "../config/environment.service";
import { PrismaService } from "../database/prisma.service";
import { StaffAssuranceSource } from "../safety/staff-assurance.source";
import { invalid } from "../safety/safety.validation";
import { AssignmentGrantProvisioningSource } from "./assignment-grant-provisioning.source";
import { grantInput, revokeInput } from "./assignment-grants.validation";

function conflict(): never {
  throw new ConflictException({ code: "RESOURCE_REVISION_CONFLICT", message: "The grant state changed. Refresh and review before submitting again." });
}
function denied(code = "ASSIGNMENT_GRANT_ADMIN_REQUIRED"): never {
  throw new ForbiddenException({ code, message: "Trusted administrator authorization is required." });
}
function unavailable(code = "ASSIGNMENT_GRANT_UNAVAILABLE"): never {
  throw new ServiceUnavailableException({ code, message: "Grant state could not be confirmed. Refresh before repeating the operation." });
}
function missing(): never { throw new NotFoundException({ code: "ASSIGNMENT_GRANT_NOT_FOUND", message: "Assignment grant resource not found." }); }
function authenticated(): never { throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." }); }
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/** Internal PA2 mutation boundary only: no controller, implicit read permission or
 * idempotent HTTP contract. Default provisioning/MFA providers deny all access.
 */
@Injectable()
export class AssignmentGrantsService {
  constructor(private readonly prisma: PrismaService, private readonly environment: EnvironmentService,
    private readonly provisioning: AssignmentGrantProvisioningSource, private readonly assurance: StaffAssuranceSource) {}

  private role(auth: AuthContext) {
    if (!auth?.user || typeof auth.user.id !== "string" || !auth.user.id || typeof auth.sessionId !== "string" || !auth.sessionId) authenticated();
    if (auth.user.role !== "ADMIN") denied();
  }
  private async trusted<T>(load: () => Promise<T>, code: string): Promise<T> {
    try { return await load(); } catch { unavailable(code); }
  }
  private async run<T>(auth: AuthContext, peers: string[],
    work: (tx: Prisma.TransactionClient, now: () => Promise<Date>, evidence: Prisma.InputJsonObject) => Promise<T>): Promise<T> {
    this.role(auth);
    try {
      return await this.prisma.$transaction(async tx => {
        const users = [...new Set([auth.user.id, ...peers])].sort();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(users)}) ORDER BY id FOR UPDATE`);
        const actor = await tx.user.findUnique({ where: { id: auth.user.id } });
        if (!actor || actor.status !== "ACTIVE" || !actor.emailVerifiedAt) authenticated();
        if (actor.role !== "ADMIN") denied();
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR SHARE`;
        const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
        if (!session || session.userId !== actor.id || session.revokedAt) authenticated();
        const clock = async () => {
          const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
          if (session.expiresAt <= row.now) authenticated();
          return row.now;
        };
        await clock();
        const provision = await this.trusted(() => this.provisioning.resolve(tx, auth), "ASSIGNMENT_ADMIN_PROVISIONING_UNAVAILABLE");
        if (!provision) unavailable("ASSIGNMENT_ADMIN_PROVISIONING_UNAVAILABLE");
        if (provision.userId !== actor.id || provision.role !== "ADMIN" || provision.active !== true ||
          typeof provision.reference !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(provision.reference) ||
          typeof provision.testOnly !== "boolean" || (provision.testOnly && this.environment.values.nodeEnv !== "test"))
          denied("ASSIGNMENT_ADMIN_PROVISIONING_REQUIRED");
        const proof = await this.trusted(() => this.assurance.resolve(tx, auth), "ASSIGNMENT_ADMIN_MFA_UNAVAILABLE");
        if (!proof) unavailable("ASSIGNMENT_ADMIN_MFA_UNAVAILABLE");
        if (proof.userId !== actor.id || proof.sessionId !== session.id || proof.level !== "MFA" ||
          !date(proof.verifiedAt) || !date(proof.expiresAt) || typeof proof.testOnly !== "boolean" ||
          (proof.testOnly && this.environment.values.nodeEnv !== "test")) denied("ASSIGNMENT_ADMIN_MFA_REQUIRED");
        const now = async () => {
          const at = await clock();
          if (proof.verifiedAt > at || proof.expiresAt <= at) denied("ASSIGNMENT_ADMIN_MFA_REQUIRED");
          return at;
        };
        await now();
        const identity = await tx.expertActorIdentity.findUnique({ where: { userId: actor.id } }) ??
          await tx.expertActorIdentity.create({ data: { userId: actor.id } });
        const evidence: Prisma.InputJsonObject = { subject: identity.subjectId, provisioningReference: provision.reference,
          assurance: { verifiedAt: proof.verifiedAt.toISOString(), expiresAt: proof.expiresAt.toISOString() } };
        const result = await work(tx, now, evidence);
        await now();
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) conflict();
      unavailable();
    }
  }

  async grant(auth: AuthContext, body: unknown) {
    this.role(auth);
    const input = grantInput(body);
    return this.run(auth, [input.moderatorId], async (tx, now, evidence) => {
      const moderator = await tx.user.findUnique({ where: { id: input.moderatorId } });
      if (!moderator || moderator.role !== "MODERATOR" || moderator.status !== "ACTIVE" || !moderator.emailVerifiedAt) missing();
      await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${input.assignmentId} FOR UPDATE`;
      if (!await tx.expertAssignment.findUnique({ where: { id: input.assignmentId }, select: { id: true } })) missing();
      const identity = await tx.expertActorIdentity.findUnique({ where: { userId: moderator.id } }) ??
        await tx.expertActorIdentity.create({ data: { userId: moderator.id } });
      let scope = await tx.assignmentModeratorScope.findUnique({ where: { assignmentId_moderatorSubjectId: {
        assignmentId: input.assignmentId, moderatorSubjectId: identity.subjectId } }, include: { currentGrant: true } });
      if (!scope) {
        if (input.expectedRevision !== 0) conflict();
        scope = await tx.assignmentModeratorScope.create({ data: { assignmentId: input.assignmentId,
          moderatorSubjectId: identity.subjectId }, include: { currentGrant: true } });
      }
      await tx.$queryRaw`SELECT id FROM "AssignmentModeratorScope" WHERE id=${scope.id}::uuid FOR UPDATE`;
      scope = await tx.assignmentModeratorScope.findUniqueOrThrow({ where: { id: scope.id }, include: { currentGrant: true } });
      if (scope.revision !== BigInt(input.expectedRevision)) conflict();
      const at = await now();
      if (input.expiresAt <= at) invalid("expiresAt", "Use an expiry after current database time.");
      if (scope.currentGrant && scope.currentGrant.expiresAt > at) conflict();
      const id = randomUUID();
      const changed = await tx.assignmentModeratorScope.updateMany({ where: { id: scope.id, revision: scope.revision },
        data: { currentGrantId: id, revision: { increment: 1 } } });
      if (changed.count !== 1) conflict();
      await tx.assignmentModeratorGrantEvent.create({ data: { id, grantId: id, scopeId: scope.id, revision: scope.revision + 1n,
        kind: "GRANTED", fromGrantId: scope.currentGrantId, expiresAt: input.expiresAt, actorEvidence: evidence } });
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: "ASSIGNMENT_MODERATOR_GRANTED", subjectType: "AssignmentModeratorGrant", subjectId: id } });
      if (input.expiresAt <= await now()) invalid("expiresAt", "The requested grant expired before completion.");
      return { scopeId: scope.id, grantId: id, revision: Number(scope.revision + 1n), kind: "GRANTED" as const, expiresAt: input.expiresAt.toISOString() };
    });
  }

  async revoke(auth: AuthContext, body: unknown) {
    this.role(auth);
    const input = revokeInput(body);
    // Locator queries convey no authority and are re-read under ordered locks.
    try {
      const locator = await this.prisma.assignmentModeratorScope.findUnique({ where: { id: input.scopeId }, select: { assignmentId: true, moderatorSubjectId: true } });
      const identity = locator ? await this.prisma.expertActorIdentity.findUnique({ where: { subjectId: locator.moderatorSubjectId }, select: { userId: true } }) : null;
      const moderatorId = identity?.userId;
      return await this.run(auth, moderatorId ? [moderatorId] : [], async (tx, now, evidence) => {
        if (!locator) missing();
        const mapping = await tx.expertActorIdentity.findUnique({ where: { subjectId: locator.moderatorSubjectId }, select: { userId: true } });
        if (mapping?.userId !== moderatorId) conflict();
        await tx.$queryRaw`SELECT id FROM "ExpertAssignment" WHERE id=${locator.assignmentId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "AssignmentModeratorScope" WHERE id=${input.scopeId}::uuid FOR UPDATE`;
        const scope = await tx.assignmentModeratorScope.findUnique({ where: { id: input.scopeId }, include: { currentGrant: true } });
        if (!scope || scope.assignmentId !== locator.assignmentId || scope.moderatorSubjectId !== locator.moderatorSubjectId) missing();
        if (scope.revision !== BigInt(input.expectedRevision) || scope.currentGrantId !== input.grantId || !scope.currentGrant) conflict();
        // Revocation may remove expired grants or grants for deleted/ineligible
        // targets; it does not require a live assignment or eligible moderator.
        await now();
        const changed = await tx.assignmentModeratorScope.updateMany({ where: { id: scope.id, revision: scope.revision, currentGrantId: input.grantId },
          data: { currentGrantId: null, revision: { increment: 1 } } });
        if (changed.count !== 1) conflict();
        await tx.assignmentModeratorGrantEvent.create({ data: { grantId: input.grantId, scopeId: scope.id, revision: scope.revision + 1n,
          kind: "REVOKED", fromGrantId: input.grantId, expiresAt: scope.currentGrant.expiresAt, actorEvidence: evidence } });
        await tx.auditLog.create({ data: { actorId: auth.user.id, action: "ASSIGNMENT_MODERATOR_REVOKED", subjectType: "AssignmentModeratorGrant", subjectId: input.grantId } });
        return { scopeId: scope.id, grantId: input.grantId, revision: Number(scope.revision + 1n), kind: "REVOKED" as const,
          expiresAt: scope.currentGrant.expiresAt.toISOString() };
      });
    } catch (error) { if (error instanceof HttpException) throw error; unavailable(); }
  }
}
