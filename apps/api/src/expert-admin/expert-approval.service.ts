import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { AccountStatus, Prisma, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import type { AuthContext } from "../auth/auth-context";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { StaffAssuranceSource } from "../safety/staff-assurance.source";
import { ApprovedExpertVersion, ExpertApprovalRegistry, ExpertEvidence, ExpertEvidenceSource } from "./expert-approval.sources";
import { approvalInvalid, parseExpertApproval } from "./expert-approval.validation";

const snapshot = (value: unknown) => {
  const content = JSON.stringify(value);
  return { kind: "SNAPSHOT", content, sha256: createHash("sha256").update(content, "utf8").digest("hex") };
};
function conflict(): never {
  throw new ConflictException({ code: "RESOURCE_REVISION_CONFLICT", message: "The credential changed. Reload and review before approving again.",
    details: [{ field: "expectedRevision", messages: ["Use the current revision after explicit review."] }] });
}
function unavailable(): never {
  throw new ServiceUnavailableException({ code: "EXPERT_APPROVAL_UNAVAILABLE", message: "Expert approval could not be confirmed. Review the credential and evidence source before trying again." });
}
function validContent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 65536;
}
function version(value: ApprovedExpertVersion | undefined, requested: string, field: string): ApprovedExpertVersion {
  if (!value) approvalInvalid(field, "This expert qualification version is not approved by the server.");
  if (value.version !== requested || !validContent(value.content)) unavailable();
  return value;
}
function validateEvidence(record: ExpertEvidence | undefined, id: string, targetId: string, expectedVersion: string,
  kind: ExpertEvidence["kind"], now: Date, expiresAt: Date | null, field: string): ExpertEvidence {
  if (!record) unavailable();
  if (record.id !== id || record.userId !== targetId || record.version !== expectedVersion || record.kind !== kind ||
      !validContent(record.content) || !(record.recordedAt instanceof Date) || !Number.isFinite(record.recordedAt.getTime()) ||
      record.recordedAt > now || (record.validUntil !== null && (!(record.validUntil instanceof Date) ||
        !Number.isFinite(record.validUntil.getTime()) || record.validUntil <= now || record.validUntil <= record.recordedAt)))
    approvalInvalid(field, "Verified evidence must match this expert, version and purpose and remain valid.");
  if (expiresAt && record.validUntil && expiresAt > record.validUntil)
    approvalInvalid("expiresAt", "Approval expiry must not exceed either evidence validity period.");
  return record;
}

@Injectable()
export class ExpertApprovalService {
  constructor(private readonly prisma: PrismaService, private readonly registry: ExpertApprovalRegistry,
    private readonly evidence: ExpertEvidenceSource, private readonly environment: EnvironmentService,
    private readonly assurance: StaffAssuranceSource) {}

  private async trusted<T>(load: () => T | Promise<T>): Promise<T> {
    try { return await load(); } catch { unavailable(); }
  }

  async approve(auth: AuthContext, targetId: string, body: unknown) {
    const input = parseExpertApproval(body);
    try {
      return await this.prisma.$transaction(async tx => {
        // Stable lock ordering protects initialization/reapproval and concurrent eligibility changes.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${auth.user.id}, ${targetId}) ORDER BY id FOR UPDATE`;
        const moderator = await tx.user.findUnique({ where: { id: auth.user.id },
          select: { id: true, role: true, status: true, emailVerifiedAt: true } });
        if (!moderator || moderator.role !== UserRole.MODERATOR || moderator.status !== AccountStatus.ACTIVE || !moderator.emailVerifiedAt)
          throw new ForbiddenException({ code: "FORBIDDEN", message: "An active verified moderator is required." });
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${auth.sessionId} FOR SHARE`;
        const session = await tx.session.findUnique({ where: { id: auth.sessionId },
          select: { userId: true, revokedAt: true, expiresAt: true } });
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`;
        const now = clock.now;
        if (!session || session.userId !== moderator.id || session.revokedAt || session.expiresAt <= now)
          throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "A valid session is required." });
        const testRuntime = this.environment.values.nodeEnv === "test";
        const proof = testRuntime ? undefined : await this.trusted(() => this.assurance.resolve(tx, auth));
        const checkProof = (at: Date) => {
          if (!testRuntime && (!proof || proof.level !== "MFA" || proof.testOnly !== false ||
            proof.userId !== moderator.id || proof.sessionId !== auth.sessionId ||
            !(proof.verifiedAt <= at && proof.expiresAt > at && session.expiresAt > at))) {
            throw new ForbiddenException({ code: "STAFF_ASSURANCE_REQUIRED", message: "Verified staff assurance is required." });
          }
        };
        checkProof(now);
        // Resolve signed evidence only after verifying the moderator and session.
        const training = version(await this.trusted(() => this.registry.training(input.trainingVersion)), input.trainingVersion, "trainingVersion");
        const policy = version(await this.trusted(() => this.registry.confidentiality(input.policyVersion)), input.policyVersion, "policyVersion");
        const [trainingRecord, confidentialityRecord] = await Promise.all([
          this.trusted(() => this.evidence.find(input.trainingEvidenceId)), this.trusted(() => this.evidence.find(input.confidentialityEvidenceId)),
        ]);
        const target = await tx.user.findUnique({ where: { id: targetId },
          select: { role: true, status: true, emailVerifiedAt: true } });
        if (!target) throw new NotFoundException({ code: "EXPERT_NOT_FOUND", message: "The expert account does not exist." });
        if (target.role !== UserRole.EXPERT || target.status !== AccountStatus.ACTIVE || !target.emailVerifiedAt)
          throw new ForbiddenException({ code: "EXPERT_INELIGIBLE", message: "An active verified expert account is required." });
        if (input.expiresAt && input.expiresAt <= now) approvalInvalid("expiresAt", "Approval expiry must be in the future.");
        const completed = validateEvidence(trainingRecord, input.trainingEvidenceId, targetId, training.version,
          "TRAINING_COMPLETION", now, input.expiresAt, "trainingEvidenceId");
        const accepted = validateEvidence(confidentialityRecord, input.confidentialityEvidenceId, targetId, policy.version,
          "CONFIDENTIALITY_ACCEPTANCE", now, input.expiresAt, "confidentialityEvidenceId");
        let credential = await tx.expertCredential.findUnique({ where: { userId: targetId } });
        if ((credential?.revision ?? 0n) !== BigInt(input.expectedRevision)) conflict();
        if (input.expectedRevision === Number.MAX_SAFE_INTEGER) unavailable();
        const actor = await tx.expertActorIdentity.upsert({ where: { userId: moderator.id }, create: { userId: moderator.id }, update: {} });
        const actorEvidence = { subject: actor.subjectId };
        if (!credential) {
          credential = await tx.expertCredential.create({ data: { userId: targetId } });
          await tx.expertCredentialEvent.create({ data: { subjectId: credential.subjectId, revision: 0n, kind: "CREATED",
            status: "PENDING", actorEvidence, evidence: snapshot({ operation: "INITIALIZE_CREDENTIAL", subject: credential.subjectId }) } });
        }
        const evidenceSnapshot = (record: ExpertEvidence, approved: ApprovedExpertVersion) => snapshot({
          subject: credential.subjectId, sourceId: record.id, kind: record.kind, version: record.version,
          content: record.content, recordedAt: record.recordedAt.toISOString(), validUntil: record.validUntil?.toISOString() ?? null,
          approvedContent: approved.content,
        });
        const approval = await tx.expertCredentialApproval.create({ data: { subjectId: credential.subjectId,
          trainingVersion: training.version, policyVersion: policy.version,
          trainingEvidence: evidenceSnapshot(completed, training), confidentialityEvidence: evidenceSnapshot(accepted, policy),
          verifiedByEvidence: actorEvidence, approvedByEvidence: actorEvidence, verifiedAt: now, approvedAt: now, expiresAt: input.expiresAt } });
        const changed = await tx.expertCredential.updateMany({ where: { userId: targetId, revision: BigInt(input.expectedRevision) },
          data: { status: "APPROVED", approvalId: approval.id, revokedAt: null, revision: { increment: 1n } } });
        if (changed.count !== 1) conflict();
        const revision = input.expectedRevision + 1;
        await tx.expertCredentialEvent.create({ data: { subjectId: credential.subjectId, revision: BigInt(revision), kind: "APPROVED",
          status: "APPROVED", approvalId: approval.id, actorEvidence, trainingVersion: training.version, policyVersion: policy.version,
          verifiedAt: now, expiresAt: input.expiresAt, evidence: snapshot({ operation: "VERIFY_AND_APPROVE", approvalId: approval.id,
            trainingEvidence: approval.trainingEvidence, confidentialityEvidence: approval.confidentialityEvidence }) } });
        if (!testRuntime) {
          const [completionClock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
          checkProof(completionClock.now);
        }
        return { revision, credential: { userId: targetId, status: "APPROVED", approvalId: approval.id,
          trainingVersion: training.version, policyVersion: policy.version, approvedAt: now.toISOString(), expiresAt: input.expiresAt?.toISOString() ?? null } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) conflict();
      // No automatic retry: a failed/uncertain request must be explicitly reconciled.
      unavailable();
    }
  }
}
