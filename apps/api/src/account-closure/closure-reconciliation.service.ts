import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EnvironmentService } from "../config/environment.service";
import { PrismaService } from "../database/prisma.service";
import { RecoveryJournalService } from "../recovery/recovery-journal.service";
import { ClosurePolicyRegistry } from "./closure-policy";

/** Minimizes mutable copies only after a signed approval. No final purge claim. */
@Injectable()
export class ClosureReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private afterId?: string;
  private readonly logger = new Logger(ClosureReconciliationService.name);
  constructor(private readonly db: PrismaService, private readonly policies: ClosurePolicyRegistry,
    private readonly journal: RecoveryJournalService, private readonly environment: EnvironmentService) {}
  onModuleInit() {
    if (this.environment.values.nodeEnv === "test") return;
    this.timer = setInterval(() => { void this.runOnce().catch(() => this.logger.error("CLOSURE_RECONCILIATION_PENDING")); }, 15000);
    this.timer.unref();
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.running?.catch(() => undefined); }
  runOnce() {
    if (this.running) return this.running;
    this.running = this.process().finally(() => { this.running = undefined; }); return this.running;
  }
  private async process() {
    const policy = this.policies.current();
    if (!policy) return;
    this.journal.assertReady();
    const select = () => this.db.accountClosure.findMany({ where: { state: "RESTRICTED", revision: 1,
      ...(this.afterId ? { id: { gt: this.afterId } } : {}),
      consumers: { some: { name: "MEDIA", status: "ACKNOWLEDGED" } } }, orderBy: { id: "asc" }, take: 20 });
    let rows = await select();
    if (!rows.length && this.afterId) { this.afterId = undefined; rows = await select(); }
    for (const candidate of rows) {
      // A held/failed case cannot permanently starve subsequent accounts.
      // Cursor progress is scheduling only; completion always requires receipts.
      this.afterId = candidate.id;
      const recovery = await this.journal.closureEvidence(candidate.userId);
      if (!recovery) continue;
      await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.userId} FOR UPDATE`;
        const closure = await tx.accountClosure.findUnique({ where: { id: candidate.id }, include: { consumers: true, user: true } });
        if (!closure || closure.user.status !== "CLOSED" || closure.state !== "RESTRICTED" || closure.revision !== 1 ||
            closure.consumers.find(c => c.name === "MEDIA")?.status !== "ACKNOWLEDGED") return;
        if (this.policies.current()?.digest !== policy.digest) throw new Error("CLOSURE_POLICY_CHANGED");
        const userId = closure.userId;
        // Open investigations are an operational hold. A generic minimization
        // approval must not destroy material needed by an unresolved case.
        if (await tx.report.count({ where: { OR: [{ reporterId: userId }, { targetUserId: userId }], status: { in: ["OPEN", "IN_REVIEW"] } } }) ||
            await tx.reviewDispute.count({ where: { ownerId: userId, status: { in: ["OPEN", "IN_REVIEW"] } } })) return;
        const acknowledge = async (name: string, evidence: Prisma.InputJsonObject) => {
          if (closure.consumers.find(c => c.name === name)?.status !== "PENDING") return;
          await tx.closureDomainReceipt.create({ data: { closureId: closure.id, name, policyDigest: policy.digest,
            policyEnvelope: policy.envelope as unknown as Prisma.InputJsonObject, evidence } });
          await tx.accountClosureConsumer.update({ where: { closureId_name: { closureId: closure.id, name } }, data: { status: "ACKNOWLEDGED" } });
        };
        if (closure.consumers.find(c => c.name === "MATCHING")?.status === "PENDING") {
          for (const resource of ["PROFILE", "PREFERENCES", "QUESTIONNAIRE"] as const) {
            const row = await tx.memberResourceRevision.upsert({ where: { userId_resource: { userId, resource } }, create: { userId, resource }, update: {} });
            if (row.revision >= BigInt(Number.MAX_SAFE_INTEGER)) throw Error("CLOSURE_REVISION_EXHAUSTED");
            await tx.memberResourceRevision.update({ where: { userId_resource: { userId, resource } }, data: { revision: { increment: 1n } } });
          }
          const profile = await tx.profile.deleteMany({ where: { userId } });
          const preferences = await tx.matchPreference.deleteMany({ where: { userId } });
          const answers = await tx.questionnaireAnswer.deleteMany({ where: { userId } });
          await tx.user.update({ where: { id: userId }, data: { displayName: null } });
          const pairs = { OR: [{ userLowId: userId }, { userHighId: userId }] };
          await tx.matchPair.updateMany({ where: { ...pairs, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
          await tx.matchPair.updateMany({ where: pairs, data: { score: null, reasons: Prisma.DbNull } });
          await acknowledge("MATCHING", { contractVersion: 1, profileRemoved: profile.count, preferencesRemoved: preferences.count,
            answersRemoved: answers.count, decisions: "RESTRICTED_RETAINED", handles: "DENIED_CLOSED_AND_OLD_GENERATION" });
        }
        if (closure.consumers.find(c => c.name === "REVIEW_CLAIMS")?.status === "PENDING") {
          if (await tx.expertAssignment.count({ where: { video: { ownerId: userId }, status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] } } }))
            throw Error("CLOSURE_ASSIGNMENTS_PENDING");
          const drafts = await tx.expertReview.findMany({ where: { assignment: { video: { ownerId: userId } },
            status: "DRAFT", submittedAt: null, disputes: { none: {} } }, select: { id: true, version: true } });
          let observations = 0, claims = 0;
          for (const draft of drafts) {
            if (draft.version >= 2147483647) throw Error("CLOSURE_REVIEW_VERSION_EXHAUSTED");
            observations += (await tx.expertObservation.deleteMany({ where: { reviewId: draft.id } })).count;
            claims += (await tx.reviewClaim.deleteMany({ where: { reviewId: draft.id, reviewVersion: null } })).count;
            await tx.expertReview.update({ where: { id: draft.id }, data: { summary: null, limitations: null, qaFeedback: null, version: { increment: 1 } } });
          }
          await acknowledge("REVIEW_CLAIMS", { contractVersion: 1, draftsMinimized: drafts.length, observationsRemoved: observations,
            unpublishedClaimsRemoved: claims, decisionsDisputesAndPublishedClaims: "RESTRICTED_RETAINED_PENDING_RETENTION",
            historicalGrants: "DENIED_CLOSED_SOURCE_NO_FORGED_STAFF_REVOCATION" });
        }
        await acknowledge("SAFETY", { contractVersion: 1, reportsAndModerationEvidence: "RESTRICTED_RETAINED_PENDING_RETENTION",
          blocks: "RESTRICTED_RETAINED_NO_AUTOMATIC_UNBLOCK", accountAccess: "CLOSED" });
        await acknowledge("RECOVERY", { contractVersion: 1, ...recovery });
        if (await tx.accountClosureConsumer.count({ where: { closureId: closure.id, status: "PENDING" } }) !== 0)
          throw Error("CLOSURE_CONSUMERS_PENDING");
        if (this.policies.current()?.digest !== policy.digest) throw Error("CLOSURE_POLICY_CHANGED");
        await tx.accountClosure.update({ where: { id: closure.id }, data: { state: "RETENTION_PENDING", revision: 2 } });
        await tx.accountClosureEvent.create({ data: { closureId: closure.id, revision: 2, kind: "RETENTION_PENDING" } });
        await tx.auditLog.create({ data: { action: "ACCOUNT_CLOSURE_MINIMIZED_RETENTION_PENDING", subjectType: "AccountClosure", subjectId: closure.id } });
      }, { timeout: 15000 });
    }
  }
}
