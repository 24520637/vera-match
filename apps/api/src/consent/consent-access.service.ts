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
