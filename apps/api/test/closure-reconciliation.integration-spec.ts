import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { integratedWorkflowHarness } from "./integrated-workflow-fixtures";
import { RecoveryJournalService } from "../src/recovery/recovery-journal.service";
import { ConsentService } from "../src/consent/consent.service";
import { ClosurePolicyRegistry, closurePolicyMessage, ClosureMinimizationPolicy, minimizationActions, verifyClosurePolicy } from "../src/account-closure/closure-policy";
import { ClosureReconciliationService } from "../src/account-closure/closure-reconciliation.service";
import { AssignmentCancellationWorker } from "../src/assignment-cancellation/assignment-cancellation.worker";
import { VideoCleanupService } from "../src/video/video-cleanup.service";
const { initialize, JournalStore, createServer } = require("../../../ops/recovery-journal/server.cjs");
const { JournalClient, verifyCheckpoint } = require("../../../ops/recovery-journal/protocol.cjs");

it("minimizes only approved closed accounts, verifies each receipt, preserves a hold, and rolls back on receipt failure", async () => {
  const h = await integratedWorkflowHarness();
  const directory = mkdtempSync(join(tmpdir(), "vera-closure-reconciliation-test-"));
  const keys = generateKeyPairSync("ed25519"), journalId = randomUUID(), token = randomBytes(32).toString("base64url");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }), publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const file = join(directory, "journal.jsonl"); initialize(file, journalId);
  const store = new JournalStore({ file, journalId, privateKey }), server = createServer(store, token);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const client = new JournalClient({ origin: "http://127.0.0.1:" + server.address().port, token, journalId, publicKey, allowLocalHttp: true });
  const journal = h.app.get(RecoveryJournalService);
  Object.assign(journal, { enabled: true, client, ready: false });
  await journal.initializeDatabaseBinding();
  await journal.recoverBeforeListening(h.app.get(ConsentService));
  const registry = h.app.get(ClosurePolicyRegistry);
  const approval = jest.spyOn(registry, "current").mockReturnValue(undefined);
  const worker = h.app.get(ClosureReconciliationService);
  try {
    const user = await h.account();
    await h.db.client.profile.create({ data: { userId: user.id, bio: "Synthetic private profile", visibilityEnabled: true } });
    await h.db.client.matchPreference.create({ data: { userId: user.id, minAge: 20, maxAge: 40 } });
    await h.db.client.questionnaireAnswer.create({ data: { userId: user.id, questionKey: "synthetic-question", responseText: "Synthetic private answer" } });
    const result = await h.request(user.cookie, "account-closure", { password: user.password, confirmation: "CLOSE MY ACCOUNT", expectedRevision: 0 }, "POST", { "Idempotency-Key": randomUUID() });
    expect(result.status).toBe(202);
    const { receiptId } = await result.json() as { receiptId: string };
    await h.app.get(AssignmentCancellationWorker).runOnce(); await h.app.get(VideoCleanupService).runOnce();
    await worker.runOnce();
    expect(await h.db.client.profile.findUnique({ where: { userId: user.id } })).not.toBeNull();
    await expect(h.db.client.accountClosureConsumer.update({ where: { closureId_name: { closureId: receiptId, name: "MATCHING" } }, data: { status: "ACKNOWLEDGED" } })).rejects.toThrow("CLOSURE_DOMAIN_RECEIPT_REQUIRED");
    const payload: ClosureMinimizationPolicy = { schemaVersion: 1, purpose: "CLOSURE_MINIMIZATION", version: "synthetic-v1",
      approvedByReference: "synthetic-owner", legalBasisReference: "synthetic-approval", approvedAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(), actions: minimizationActions,
      retainedEvidence: "RESTRICTED_PENDING_APPROVED_RETENTION", finalErasureClaim: false };
    const verified = verifyClosurePolicy(JSON.stringify({ payload, signature: sign(null, closurePolicyMessage(payload), keys.privateKey).toString("base64url") }), publicKey);
    approval.mockReturnValue(verified);
    const peer = await h.account();
    const hold = await h.db.client.report.create({ data: { reporterId: peer.id, targetUserId: user.id, reason: "Synthetic open investigation" } });
    await worker.runOnce();
    expect(await h.db.client.closureDomainReceipt.count()).toBe(0);
    expect(await h.db.client.profile.findUnique({ where: { userId: user.id } })).not.toBeNull();
    // The native investigation is resolved using its normal moderator flow in
    // feature tests; this fixture removes its own synthetic hold to test cleanup.
    await h.db.client.report.delete({ where: { id: hold.id } });
    await h.db.client.$executeRawUnsafe(`CREATE FUNCTION synthetic_closure_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic receipt failure'; END $$`);
    await h.db.client.$executeRawUnsafe(`CREATE TRIGGER synthetic_closure_receipt_failure BEFORE INSERT ON "ClosureDomainReceipt" FOR EACH ROW EXECUTE FUNCTION synthetic_closure_receipt_failure()`);
    try {
      await expect(worker.runOnce()).rejects.toThrow();
      expect(await h.db.client.profile.findUnique({ where: { userId: user.id } })).not.toBeNull();
      expect(await h.db.client.closureDomainReceipt.count()).toBe(0);
    } finally {
      await h.db.client.$executeRawUnsafe('DROP TRIGGER synthetic_closure_receipt_failure ON "ClosureDomainReceipt"');
      await h.db.client.$executeRawUnsafe('DROP FUNCTION synthetic_closure_receipt_failure()');
    }
    await Promise.all([worker.runOnce(), worker.runOnce()]);
    expect(await h.db.client.profile.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await h.db.client.matchPreference.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await h.db.client.questionnaireAnswer.count({ where: { userId: user.id } })).toBe(0);
    expect(await h.db.client.accountClosure.findUnique({ where: { id: receiptId } })).toMatchObject({ state: "RETENTION_PENDING", revision: 2 });
    expect(await h.db.client.closureDomainReceipt.count({ where: { closureId: receiptId } })).toBe(4);
    const recoveryReceipt = await h.db.client.closureDomainReceipt.findUniqueOrThrow({ where: { closureId_name: { closureId: receiptId, name: "RECOVERY" } } });
    const checkpoint = (recoveryReceipt.evidence as { checkpoint: { payload: { nonce: string; issuedAt: number } } }).checkpoint;
    expect(verifyCheckpoint(checkpoint, publicKey, journalId, checkpoint.payload.nonce, checkpoint.payload.issuedAt).sequence).toBeGreaterThan(1);
    expect(await h.db.client.memberResourceRevision.findMany({ where: { userId: user.id } })).toHaveLength(3);
    await worker.runOnce();
    expect(await h.db.client.closureDomainReceipt.count()).toBe(4);
    await expect(h.db.client.closureDomainReceipt.deleteMany()).rejects.toThrow();
    expect((await h.db.client.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("CLOSED");
  } finally {
    approval.mockRestore(); await h.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(r)); store.close();
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !directory.includes("vera-closure-reconciliation-test-")) throw Error("Unsafe test cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
}, 120000);
