import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { EnvironmentService } from "../config/environment.service";
import { PrismaService } from "../database/prisma.service";

type Reason = "ACCOUNT_CLOSURE" | "CONSENT_WITHDRAWAL" | "BLOCK" | "SESSION_REVOCATION" | "PASSWORD_RESET" | "STAFF_RESTRICTION" | "VIDEO_REMOVAL" | "CLAIM_RESTRICTION";
export interface JournalEntry {
  journalId: string; sequence: number; hash: string;
  intent: { id: string; userIds: string[]; reason: Reason | "DATABASE_BASELINE" };
}
interface Client {
  head(): Promise<unknown>;
  prepare(intent: JournalEntry["intent"]): Promise<JournalEntry>;
  snapshot(): Promise<{ entries: JournalEntry[]; checkpoint: { journalId: string; sequence: number; headHash: string }; envelope: Prisma.InputJsonValue }>;
}
interface RecoveryWithdrawal {
  withdrawForRecovery(tx: Prisma.TransactionClient, userId: string, entryId: string): Promise<unknown>;
}

/** Separate service/credentials/storage, never a same-database export queue. */
@Injectable()
export class RecoveryJournalService {
  private client?: Client;
  private ready = false;
  private failed = false;
  private lastVerifiedAt = 0;
  private connectionCheck?: Promise<void>;
  private readonly enabled: boolean;
  constructor(private readonly db: PrismaService, environment: EnvironmentService) {
    this.enabled = environment.values.nodeEnv === "production" || !!process.env.RECOVERY_JOURNAL_CLIENT_CONFIG;
    if (!this.enabled) { this.ready = true; return; }
    try {
      const file = process.env.RECOVERY_JOURNAL_CLIENT_CONFIG;
      if (!file || !isAbsolute(file) || statSync(file).size > 16384) throw Error();
      const config = JSON.parse(readFileSync(file, "utf8"));
      if (Object.keys(config).sort().join(",") !== "journalId,origin,publicKeyPath,tokenPath" ||
          !isAbsolute(config.publicKeyPath) || !isAbsolute(config.tokenPath) || statSync(config.publicKeyPath).size > 16384 || statSync(config.tokenPath).size > 256) throw Error();
      const { JournalClient } = require(resolve(__dirname, "../../../../ops/recovery-journal/protocol.cjs"));
      this.client = new JournalClient({ origin: config.origin, journalId: config.journalId,
        publicKey: readFileSync(config.publicKeyPath, "utf8"), token: readFileSync(config.tokenPath, "utf8").trim() });
    } catch { throw new Error("RECOVERY_JOURNAL_CONFIGURATION_REQUIRED"); }
  }
  assertReady() {
    if (!this.ready || this.failed) throw new ServiceUnavailableException({ code: "RECOVERY_FENCE_CLOSED", message: "Service recovery verification is pending." });
  }
  async verifyAvailability() {
    this.assertReady();
    if (!this.enabled || Date.now() - this.lastVerifiedAt < 5000) return;
    if (!this.connectionCheck) this.connectionCheck = this.client!.head().then(() => { this.lastVerifiedAt = Date.now(); })
      .catch(() => { this.failed = true; this.ready = false; this.assertReady(); })
      .finally(() => { this.connectionCheck = undefined; });
    await this.connectionCheck;
  }
  /** Explicit operator-only initialization, never called by API bootstrap. */
  async initializeDatabaseBinding() {
    if (!this.enabled || !this.client || this.failed) throw new Error("RECOVERY_INITIALIZATION_REFUSED");
    this.ready = false;
    const snapshot = await this.client.snapshot();
    if (snapshot.entries.length || await this.db.recoveryDatabaseBinding.count() || await this.db.recoveryJournalReceipt.count())
      throw new Error("RECOVERY_INITIALIZATION_REQUIRES_NEW_UNBOUND_JOURNAL");
    const journalId = snapshot.checkpoint.journalId;
    const entry = await this.client.prepare({ id: randomUUID(), reason: "DATABASE_BASELINE", userIds: ["database-" + journalId] });
    if (entry.sequence !== 1 || entry.journalId !== journalId) throw new Error("RECOVERY_INITIALIZATION_REFUSED");
    await this.db.$transaction(async tx => {
      await tx.recoveryDatabaseBinding.create({ data: { journalId, baselineEntryId: entry.intent.id, baselineEntryHash: entry.hash } });
      await tx.recoveryJournalReceipt.create({ data: { journalId, sequence: 1n, entryId: entry.intent.id, entryHash: entry.hash, disposition: "APPLIED" } });
    });
    return { journalId, baselineEntryId: entry.intent.id };
  }
  async closureEvidence(userId: string): Promise<Prisma.InputJsonObject | undefined> {
    if (!this.enabled) return undefined;
    this.assertReady();
    const snapshot = await this.client!.snapshot();
    for (const entry of snapshot.entries.filter(e => e.intent.reason === "ACCOUNT_CLOSURE" && e.intent.userIds.includes(userId)).reverse()) {
      const applied = await this.db.recoveryJournalReceipt.findUnique({ where: { journalId_sequence: { journalId: entry.journalId, sequence: BigInt(entry.sequence) } } });
      if (applied?.disposition === "APPLIED" && applied.entryId === entry.intent.id && applied.entryHash === entry.hash)
        return { journalId: entry.journalId, entryId: entry.intent.id, sequence: entry.sequence, entryHash: entry.hash, checkpoint: snapshot.envelope };
    }
    return undefined;
  }
  /** Caller must already authenticate/authorize and hold the domain's User locks.
   * The APPLIED receipt is atomic with the actual domain mutation. No post-commit ACK.
   */
  async record(tx: Prisma.TransactionClient, userIds: string[], reason: Reason) {
    if (!this.enabled) return;
    this.assertReady();
    try {
      const entry = await this.client!.prepare({ id: randomUUID(), reason, userIds: [...new Set(userIds)].sort() });
      this.lastVerifiedAt = Date.now();
      await tx.recoveryJournalReceipt.create({ data: { journalId: entry.journalId, sequence: BigInt(entry.sequence),
        entryId: entry.intent.id, entryHash: entry.hash, disposition: "APPLIED" } });
    } catch {
      // Includes ambiguous network/disk acknowledgement. No ordinary requests
      // are admitted until restart/replay has independently reconciled it.
      this.failed = true; this.ready = false; this.assertReady();
    }
  }
  /** Before listeners open. Missing post-backup receipts cause conservative
   * quarantine, never manufactured closure/staff/erasure completion evidence.
   */
  async recoverBeforeListening(consents: RecoveryWithdrawal) {
    if (!this.enabled) return;
    this.ready = false;
    try {
      const snapshot = await this.client!.snapshot();
      const binding = await this.db.recoveryDatabaseBinding.findUnique({ where: { journalId: snapshot.checkpoint.journalId } });
      const baseline = snapshot.entries[0];
      if (!binding || await this.db.recoveryDatabaseBinding.count() !== 1 || !baseline || baseline.sequence !== 1 ||
          baseline.intent.reason !== "DATABASE_BASELINE" || baseline.intent.userIds.join(",") !== "database-" + binding.journalId ||
          baseline.intent.id !== binding.baselineEntryId || baseline.hash !== binding.baselineEntryHash)
        throw Error("RECOVERY_DATABASE_BINDING_REQUIRED");
      const latest = await this.db.recoveryJournalReceipt.findFirst({ orderBy: { sequence: "desc" } });
      if (latest && (latest.journalId !== snapshot.entries[0]?.journalId || latest.sequence > BigInt(snapshot.checkpoint.sequence))) throw Error();
      for (const entry of snapshot.entries) {
        await this.db.$transaction(async tx => {
          const existing = await tx.recoveryJournalReceipt.findUnique({ where: { journalId_sequence: {
            journalId: entry.journalId, sequence: BigInt(entry.sequence) } } });
          if (existing) {
            if (existing.entryId !== entry.intent.id || existing.entryHash !== entry.hash) throw Error();
            return;
          }
          if (entry.intent.reason === "DATABASE_BASELINE") throw Error("RECOVERY_BASELINE_RECEIPT_REQUIRED");
          const ids = entry.intent.userIds;
          await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
          for (const id of ids) {
            const user = await tx.user.findUnique({ where: { id } });
            // The subject may not exist in a backup taken before registration.
            // Generated user identities must never be manually reused.
            if (!user) continue;
            const now = new Date();
            if (user.role === "MEMBER" && user.status !== "CLOSED") await consents.withdrawForRecovery(tx, id, entry.intent.id);
            await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
            await tx.passwordResetToken.updateMany({ where: { userId: id, consumedAt: null }, data: { consumedAt: now } });
            await tx.emailVerificationToken.updateMany({ where: { userId: id, consumedAt: null }, data: { consumedAt: now } });
            if (user.status !== "CLOSED" && user.status !== "DELETED") await tx.user.update({ where: { id }, data: { status: "SUSPENDED" } });
          }
          await tx.recoveryJournalReceipt.create({ data: { journalId: entry.journalId, sequence: BigInt(entry.sequence),
            entryId: entry.intent.id, entryHash: entry.hash, disposition: "QUARANTINED" } });
          await tx.auditLog.create({ data: { action: "RECOVERY_RESTRICTION_QUARANTINED", subjectType: "RecoveryJournalReceipt", subjectId: entry.intent.id } });
        });
      }
      // Detect appends during replay. A new/simultaneous writer requires another
      // isolated reconciliation; this contract supports one API process only.
      const current = await this.client!.snapshot();
      if (current.checkpoint.sequence !== snapshot.checkpoint.sequence || current.checkpoint.headHash !== snapshot.checkpoint.headHash) throw Error();
      this.ready = true;
      this.lastVerifiedAt = Date.now();
    } catch { this.failed = true; throw new Error("RECOVERY_RECONCILIATION_REQUIRED"); }
  }
}

@Injectable()
export class RecoveryFenceGuard implements CanActivate {
  constructor(private readonly journal: RecoveryJournalService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ method: string; path: string }>();
    if (request.method === "GET" && request.path === "/api/health") return true;
    await this.journal.verifyAvailability(); return true;
  }
}
