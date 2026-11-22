import { closureConsumers } from "./closure-consumer.contract";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AuthContext } from "../auth/auth-context";
import { PasswordService } from "../auth/password.service";
import { ConsentService } from "../consent/consent.service";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { closureInput } from "./closure.validation";

/** The production release gate cannot be bypassed by an environment feature flag. */
@Injectable()
export class AccountClosureService {
  constructor(private readonly db: PrismaService, private readonly passwords: PasswordService,
    private readonly consents: ConsentService, private readonly environment: EnvironmentService) {}
  availability() { return { available: this.environment.values.nodeEnv !== "production" }; }
  available() {
    if (this.environment.values.nodeEnv === "production") throw new ServiceUnavailableException({
      code: "CLOSURE_RELEASE_PENDING", message: "Account closure is awaiting release review. Contact support." });
  }
  async request(auth: AuthContext, input: unknown, key: unknown) {
    this.available();
    const dto = closureInput(input, key);
    if (auth.user.role !== "MEMBER") throw new ForbiddenException({ code: "FORBIDDEN", message: "Member self-service only." });
    try {
      const proof = await this.db.user.findUnique({ where: { id: auth.user.id } });
      if (!proof || proof.status !== "ACTIVE" || proof.role !== "MEMBER" || !proof.emailVerifiedAt ||
          !await this.passwords.verify(proof.passwordHash, dto.password)) throw new BadRequestException({
        code: "REAUTHENTICATION_FAILED", message: "Your current password could not be verified." });
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${auth.user.id} FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({ where: { id: auth.user.id } });
        // A waiting request may only replay with its own still-unexpired, closure-revoked session.
        // Public SessionAuthGuard never accepts that session after the barrier.
        const previous = await tx.accountClosure.findUnique({ where: { userId: user.id } });
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR UPDATE`;
        const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
        const now = new Date();
        if (!session || session.userId !== user.id || session.expiresAt <= now || user.passwordHash !== proof.passwordHash ||
            user.role !== "MEMBER" || !user.emailVerifiedAt) throw new ForbiddenException({ code: "FORBIDDEN", message: "A current verified member session is required." });
        if (previous) {
          if (previous.keyHash !== dto.keyHash || previous.fingerprint !== dto.fingerprint) throw new ConflictException({ code: "CLOSURE_ALREADY_ACCEPTED", message: "Closure is already pending. Check your status email." });
          return { receiptId: previous.id, state: previous.state, revision: previous.revision, cleanupPending: true };
        }
        if (user.status !== "ACTIVE" || session.revokedAt) throw new ForbiddenException({ code: "FORBIDDEN", message: "A current verified member session is required." });
        // Historical staff responsibilities need a separate deprovisioning workflow.
        const actor = await tx.expertActorIdentity.findUnique({ where: { userId: user.id } });
        const historicalStaff = actor && (await tx.assignmentModeratorScope.count({ where: { moderatorSubjectId: actor.subjectId } }) ||
          await tx.reviewDecisionEvidence.count({ where: { moderatorSubjectId: actor.subjectId } }) ||
          await tx.expertCredentialEvent.count({ where: { actorEvidence: { path: ["subject"], equals: actor.subjectId } } }) ||
          await tx.assignmentEvent.count({ where: { actorEvidence: { path: ["subject"], equals: actor.subjectId } } }));
        if (historicalStaff || await tx.auditLog.count({ where: { actorId: user.id, OR: [
          { action: { startsWith: "EXPERT_CREDENTIAL_" } }, { action: { startsWith: "ASSIGNMENT_MODERATOR_" } },
        ] } }) || await tx.expertCredential.count({ where: { userId: user.id } }) ||
            await tx.expertAssignment.count({ where: { OR: [{ expertId: user.id }, { assignedById: user.id }] } }) ||
            await tx.report.count({ where: { moderatorId: user.id } })) throw new ConflictException({
          code: "STAFF_DEPROVISIONING_REQUIRED", message: "This account needs a staff deprovisioning review." });
        const closure = await tx.accountClosure.create({ data: { userId: user.id, keyHash: dto.keyHash,
          fingerprint: dto.fingerprint, events: { create: { revision: 1, kind: "RESTRICTED" } },
          consumers: { create: closureConsumers.map(name => ({ name })) } } });
        await this.consents.withdrawForClosure(tx, user.id, closure.id);
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
        await tx.passwordResetToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
        await tx.emailVerificationToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
        await tx.user.update({ where: { id: user.id }, data: { status: "CLOSED" } });
        if (session.expiresAt <= new Date()) throw new ForbiddenException({ code: "LIVE_SESSION_REQUIRED", message: "A live session is required to confirm closure." });
        // Opaque receipt identity only. No email, password, session or private content.
        await tx.auditLog.create({ data: { action: "ACCOUNT_CLOSURE_RESTRICTED", actorId: closure.id,
          subjectId: closure.id, subjectType: "AccountClosure" } });
        return { receiptId: closure.id, state: closure.state, revision: closure.revision, cleanupPending: true };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: "CLOSURE_STORE_UNAVAILABLE", message: "Closure could not be confirmed. Check your status email before trying again." });
    }
  }
}
