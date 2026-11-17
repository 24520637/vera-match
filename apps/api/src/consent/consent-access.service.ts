import { ForbiddenException, Injectable } from "@nestjs/common";
import { ConsentPurpose, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { EnvironmentService } from "../config/environment.service";
import { policyDigest } from "./consent.policy";
import { consentStorage, requireConsentMember } from "./consent.service";

/** Consumers must use authoritative checks, not cached consent projections.
 * No media/matching consumer is integrated by C023. This is not a URL revoker.
 */
@Injectable()
export class ConsentAccessService {
  constructor(private readonly prisma: PrismaService, private readonly environment: EnvironmentService) {}
  private async allowed(tx: Prisma.TransactionClient, userId: string, purpose: ConsentPurpose) {
    const row = await tx.consent.findUnique({ where: { userId_purpose: { userId, purpose } }, include: { policyEvidence: true } });
    const policy = row?.policyEvidence;
    return !!row?.granted && !!policy && policy.purpose === purpose && row.policyVersion === policy.policyVersion &&
      (!policy.testOnly || this.environment.values.nodeEnv === "test") &&
      policy.algorithm === "SHA-256" && policy.encoding === "UTF-8" && policyDigest(policy.content) === policy.digest;
  }
  /** Caller must already hold this owner's User row lock in its transaction.
   * Never opens a nested transaction or substitutes a cached projection.
   */
  async requireInTransaction(tx: Prisma.TransactionClient, userId: string, purposes: readonly ConsentPurpose[]) {
    await requireConsentMember(tx, userId);
    for (const purpose of purposes) {
      if (!await this.allowed(tx, userId, purpose))
        throw new ForbiddenException({ code: "CONSENT_REQUIRED", message: "Current consent is required." });
    }
    const ledger = await tx.consentLedger.findUnique({ where: { userId } });
    if (!ledger) throw new ForbiddenException({ code: "CONSENT_REQUIRED", message: "Current consent is required." });
    return { subjectId: ledger.subjectId, version: ledger.version };
  }
  /** Permanent withdrawal barrier for a previously captured generation. Re-grant
   * does not erase tasks/history. Call under the same owner lock as authorization.
   */
  async requireGenerationInTransaction(tx: Prisma.TransactionClient, userId: string, subjectId: string | null,
    version: bigint | null, purpose: ConsentPurpose) {
    const ledger = await tx.consentLedger.findUnique({ where: { userId } });
    if (!ledger || !subjectId || version === null || version < 0n || subjectId !== ledger.subjectId || version > ledger.version ||
      await tx.consentWithdrawalTask.count({ where: { subjectId, purpose, version: { gt: version } } }))
      throw new ForbiddenException({ code: "CONSENT_GENERATION_WITHDRAWN", message: "This authorization generation is no longer valid." });
  }
  isAllowed(userId: string, purpose: ConsentPurpose) {
    return consentStorage(() => this.prisma.$transaction(async tx => {
      try { await requireConsentMember(tx, userId); }
      catch (error) { if (error instanceof ForbiddenException) return false; throw error; }
      return this.allowed(tx, userId, purpose);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }
  /** Serialize a consumer's authorization-sensitive action against consent mutations.
   * The consumer must complete issuance/access inside the callback, not afterwards.
   * Existing bearer URLs and bytes already delivered are outside this guarantee.
   */
  withAuthorizedConsent<T>(userId: string, purpose: ConsentPurpose, action: (tx: Prisma.TransactionClient, version: bigint) => Promise<T>) {
    return consentStorage(() => this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      await requireConsentMember(tx, userId);
      if (!await this.allowed(tx, userId, purpose)) throw new ForbiddenException({ code: "CONSENT_REQUIRED", message: "Current consent is required." });
      const ledger = await tx.consentLedger.findUnique({ where: { userId } });
      return action(tx, ledger?.version ?? 0n);
    }));
  }
}
