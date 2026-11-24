import { policyDependencies } from "./consent-policy.catalog";
import { ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { AccountStatus, Consent, ConsentEventKind, ConsentPurpose, Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { invalidRequest } from "../profile/profile.validation";
import { ConsentPolicyRegistry, consentPurposes, policyDigest, PolicySnapshot } from "./consent.policy";
import { consentFingerprint, ConsentReadDto, parseConsentPatch, parseIdempotencyKey } from "./consent.validation";

const conflict = (code: string, message: string): never => {
  throw new ConflictException({ code, message, details: [{ field: "_form", messages: [message] }] });
};
export async function requireConsentMember(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, role: true, emailVerifiedAt: true } });
  if (!user || user.status !== AccountStatus.ACTIVE || user.role !== UserRole.MEMBER || !user.emailVerifiedAt) {
    throw new ForbiddenException({ code: "FORBIDDEN", message: "An active verified member is required." });
  }
}
export async function consentStorage<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException({ code: "CONSENT_STORE_UNAVAILABLE", message: "Consent storage is temporarily unavailable." });
  }
}
function project(rows: Consent[], version: number): ConsentReadDto {
  return { version, consents: consentPurposes.map(purpose => {
    const row = rows.find(item => item.purpose === purpose);
    return { purpose, granted: row?.granted ?? false, grantedAt: row?.grantedAt?.toISOString() ?? null,
      revokedAt: row?.revokedAt?.toISOString() ?? null, policyVersion: row?.policyVersion ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null };
  }) };
}

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService, private readonly registry: ConsentPolicyRegistry,
    private readonly environment: EnvironmentService, private readonly journal?: RecoveryJournalService) {}
  published(locale: unknown) {
    if (locale !== "en" && locale !== "vi") return invalidRequest([{ field: "locale", messages: ["Choose en or vi."] }]);
    return { locale, policies: (this.registry.list?.(locale) ?? []).filter(policy => !policy.testOnly).map(policy => ({ purpose: policy.purpose, policyVersion: policy.policyVersion, locale: policy.locale, content: policy.content, digest: policyDigest(policy.content), optional: true, dependencies: policyDependencies[policy.purpose] })) };
  }
  get(userId: string) {
    return consentStorage(() => this.prisma.$transaction(async tx => {
      await requireConsentMember(tx, userId);
      const ledger = await tx.consentLedger.findUnique({ where: { userId } });
      return project(await tx.consent.findMany({ where: { userId } }), Number(ledger?.version ?? 0n));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  private async evidence(tx: Prisma.TransactionClient, policy: PolicySnapshot) {
    const digest = policyDigest(policy.content);
    await tx.consentPolicyEvidence.createMany({ data: [{ purpose: policy.purpose, policyVersion: policy.policyVersion,
      locale: policy.locale, content: policy.content, digest, testOnly: policy.testOnly }], skipDuplicates: true });
    const saved = await tx.consentPolicyEvidence.findUniqueOrThrow({ where: {
      purpose_policyVersion_locale: { purpose: policy.purpose, policyVersion: policy.policyVersion, locale: policy.locale },
    } });
    if (saved.digest !== digest || saved.content !== policy.content || saved.testOnly !== policy.testOnly || policyDigest(saved.content) !== saved.digest) {
      throw new ServiceUnavailableException({ code: "POLICY_EVIDENCE_UNAVAILABLE", message: "Policy evidence requires review." });
    }
    return saved;
  }
  patch(userId: string, input: unknown, header: unknown) {
    const dto = parseConsentPatch(input), keyHash = parseIdempotencyKey(header), fingerprint = consentFingerprint(dto);
    return consentStorage(() => this.prisma.$transaction(tx => this.patchInTransaction(tx, userId, dto, keyHash, fingerprint)));
  }
  /** Internal coordinator API. Caller owns the same User lock; no nested transaction or provider I/O. */
  async withdrawForClosure(tx: Prisma.TransactionClient, userId: string, closureId: string) {
    const ledger = await tx.consentLedger.findUnique({ where: { userId } });
    const dto = parseConsentPatch({ expectedVersion: Number(ledger?.version ?? 0n),
      consents: consentPurposes.map(purpose => ({ purpose, granted: false })) });
    return this.patchInTransaction(tx, userId, dto, parseIdempotencyKey(closureId), consentFingerprint(dto));
  }
  /** Trusted recovery-only entry point; caller holds User lock and verified an
   * independent journal record. No HTTP route and no grant/policy bypass. */
  async withdrawForRecovery(tx: Prisma.TransactionClient, userId: string, entryId: string) {
    const ledger = await tx.consentLedger.findUnique({ where: { userId } });
    const dto = parseConsentPatch({ expectedVersion: Number(ledger?.version ?? 0n),
      consents: consentPurposes.map(purpose => ({ purpose, granted: false })) });
    return this.patchInTransaction(tx, userId, dto, parseIdempotencyKey(entryId), consentFingerprint(dto), true);
  }
  private async patchInTransaction(tx: Prisma.TransactionClient, userId: string, dto: ReturnType<typeof parseConsentPatch>, keyHash: string, fingerprint: string, recovery = false) {
      // Same per-account lock order as the existing feature APIs. No automatic retry.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (!recovery) await requireConsentMember(tx, userId);
      else if (dto.consents.some(item => item.granted)) throw new Error("RECOVERY_GRANT_FORBIDDEN");
      let ledger = await tx.consentLedger.findUnique({ where: { userId } });
      const now = new Date();
      if (ledger) {
        const previous = await tx.consentIdempotency.findUnique({ where: { subjectId_keyHash: { subjectId: ledger.subjectId, keyHash } } });
        if (previous && previous.expiresAt > now) {
          if (previous.fingerprint !== fingerprint) return conflict("IDEMPOTENCY_KEY_REUSED", "Use a new key for a different consent operation.");
          return { response: previous.response as unknown as ConsentReadDto, replayed: true };
        }
      }
      const current = Number(ledger?.version ?? 0n);
      if (current !== dto.expectedVersion) return conflict("VERSION_CONFLICT", "Consent changed. Reload before submitting again.");
      if (current === Number.MAX_SAFE_INTEGER) throw new ServiceUnavailableException({ code: "CONSENT_VERSION_EXHAUSTED", message: "Consent changes require support review." });
      const policies = new Map<ConsentPurpose, PolicySnapshot>();
      dto.consents.forEach((item, index) => {
        if (!item.granted) return; // Withdrawal never consults the current registry.
        const policy = this.registry.current(item.purpose, item.locale);
        if (!policy || policy.purpose !== item.purpose || !policy.content || !policy.locale ||
            policy.policyVersion !== item.policyVersion || (policy.testOnly && this.environment.values.nodeEnv !== "test")) {
          return invalidRequest([{ field: `consents.${index}.policyVersion`, messages: ["A current approved policy is required to grant this purpose."] }]);
        }
        if ((!policy.testOnly || item.locale !== undefined || item.policyDigest !== undefined) &&
            (item.locale !== policy.locale || item.policyDigest !== policyDigest(policy.content))) {
          return invalidRequest([{ field: `consents.${index}.policyVersion`, messages: ["Read the current policy in your chosen language before granting."] }]);
        }
        policies.set(item.purpose, policy);
      });
      if (!ledger) {
        ledger = await tx.consentLedger.create({ data: { user: { connect: { id: userId } }, subject: { create: {} } } });
      }
      if (!recovery && dto.consents.some(item => !item.granted)) await this.journal?.record(tx, [userId], "CONSENT_WITHDRAWAL");
      const updated = await tx.consentLedger.updateMany({ where: { userId, version: BigInt(dto.expectedVersion) }, data: { version: { increment: 1n } } });
      if (updated.count !== 1) return conflict("VERSION_CONFLICT", "Consent changed. Reload before submitting again.");
      for (const item of dto.consents) {
        const old = await tx.consent.findUnique({ where: { userId_purpose: { userId, purpose: item.purpose } } });
        const policy = item.granted ? await this.evidence(tx, policies.get(item.purpose)!) : null;
        const policyVersion = item.granted ? policy!.policyVersion : old?.policyVersion ?? null;
        const policyEvidenceId = item.granted ? policy!.id : old?.policyEvidenceId ?? null;
        const oldGranted = old?.granted ?? false;
        const kind: ConsentEventKind = oldGranted !== item.granted ? "STATE_CHANGED" : !item.granted ? "OFF_REAFFIRMED"
          : old?.policyEvidenceId !== policyEvidenceId ? "POLICY_RECONSENT" : "GRANT_REAFFIRMED";
        const state = { granted: item.granted, policyVersion, policyEvidenceId,
          grantedAt: item.granted ? now : old?.grantedAt ?? null, revokedAt: item.granted ? null : now };
        await tx.consent.upsert({ where: { userId_purpose: { userId, purpose: item.purpose } },
          create: { userId, purpose: item.purpose, ...state }, update: state });
        const event = await tx.consentEvent.create({ data: { subjectId: ledger.subjectId, purpose: item.purpose,
          oldGranted, newGranted: item.granted, kind, previousVersion: BigInt(current), nextVersion: BigInt(current + 1),
          policyVersion, policyEvidenceId, evidenceGap: !policyEvidenceId && (oldGranted || old?.grantedAt != null || policyVersion !== null),
        } });
        if (!item.granted) {
          // For source-loss audit ordering, use a clock reading under the owner
          // lock. PostgreSQL's default now() is the transaction start time.
          const sourceWithdrawal = item.purpose === "VIDEO_STORAGE" || item.purpose === "EXPERT_VIDEO_REVIEW";
          const [clock] = sourceWithdrawal ? await tx.$queryRaw<{ now: Date }[]>`
            SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now` : [];
          await tx.consentWithdrawalTask.create({ data: { subjectId: ledger.subjectId, eventId: event.id,
            purpose: item.purpose, version: BigInt(current + 1), createdAt: clock?.now } });
        }
      }
      const response = project(await tx.consent.findMany({ where: { userId } }), current + 1);
      await tx.consentIdempotency.upsert({ where: { subjectId_keyHash: { subjectId: ledger.subjectId, keyHash } },
        create: { subjectId: ledger.subjectId, keyHash, fingerprint, response: response as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + 86400000) },
        update: { fingerprint, response: response as unknown as Prisma.InputJsonValue, createdAt: now, expiresAt: new Date(now.getTime() + 86400000) },
      });
      return { response, replayed: false };
  }
}
