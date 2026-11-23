import { AssignmentCancellationWorker } from "../src/assignment-cancellation/assignment-cancellation.worker";
import { VideoCleanupService } from "../src/video/video-cleanup.service";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { AssignmentCancellationService } from "../src/assignment-cancellation/assignment-cancellation.service";
import { EnvironmentService } from "../src/config/environment.service";
import { PrismaService } from "../src/database/prisma.service";
import { integratedWorkflowHarness, IntegratedWorkflowHarness, orderedTransactions, Restriction, WorkflowStage } from "./integrated-workflow-fixtures";

type Operation = "playback" | "draft-init" | "draft-read" | "draft-edit" | "submit" | "qa-read" |
  "qa-return" | "qa-approve" | "confirm" | "share" | "owner-report" | "matching-read";
const operations: { name: Operation; stage: WorkflowStage; audit?: string; assignmentSubject?: boolean; emptyRead?: boolean }[] = [
  { name: "playback", stage: "assigned", audit: "EXPERT_PLAYBACK_ISSUED", assignmentSubject: true },
  { name: "draft-init", stage: "assigned", audit: "EXPERT_DRAFT_CREATED", assignmentSubject: true },
  { name: "draft-read", stage: "draft", audit: "EXPERT_DRAFT_READ", assignmentSubject: true },
  { name: "draft-edit", stage: "draft", audit: "EXPERT_DRAFT_SAVED" },
  { name: "submit", stage: "draft", audit: "EXPERT_REVIEW_SUBMITTED" },
  { name: "qa-read", stage: "submitted", audit: "EXPERT_REVIEW_QA_READ" },
  { name: "qa-return", stage: "submitted", audit: "EXPERT_REVIEW_RETURNED" },
  { name: "qa-approve", stage: "submitted", audit: "EXPERT_REVIEW_APPROVED" },
  { name: "confirm", stage: "approved", audit: "REVIEW_CLAIM_CONFIRMED" },
  { name: "share", stage: "confirmed", audit: "REVIEW_CLAIM_SHARED" },
  { name: "owner-report", stage: "shared", emptyRead: true },
  { name: "matching-read", stage: "shared", emptyRead: true },
];

describe("C050/C053/C054 real integrated workflow restriction races", () => {
  let h: IntegratedWorkflowHarness;
  let recovery: Awaited<ReturnType<IntegratedWorkflowHarness["workflow"]>>;
  beforeAll(async () => { h = await integratedWorkflowHarness(); recovery = await h.workflow("draft"); }, 60000);
  afterAll(async () => { await h?.close(); });

  test("a real late PUT remains private and pending until its genuine capability expires", async () => {
    expect((await h.request(recovery.owner.cookie, "videos/" + recovery.videoId, {}, "DELETE")).status).toBe(202);
    await h.app.get(VideoCleanupService).runOnce();
    expect(await h.finalObjectAbsent(recovery.videoId)).toBe(true);
    expect((await fetch(recovery.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: h.media })).status).toBe(200);
    expect(await h.incomingObjectAbsent(recovery.videoId)).toBe(false);
    expect((await h.play(recovery.expert.cookie, recovery.id)).status).toBe(403);
    expect(await h.db.client.videoCleanupTask.findUniqueOrThrow({ where: { videoId: recovery.videoId } }))
      .toMatchObject({ status: "PENDING", completedAt: null });
    // Test scheduling control preserves an outstanding durable task for the cold
    // process test below. It does not alter signed expiry or fabricate completion.
    await h.db.client.videoCleanupTask.update({ where: { videoId: recovery.videoId },
      data: { nextAttemptAt: new Date(Date.now() + 3600000) } });
  });
  const cases = operations.flatMap(op => (["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW", "DELETE"] as Restriction[])
    .flatMap(restriction => (["operation-first", "restriction-first"] as const).map(order => ({ ...op, restriction, order }))))
    // The existing security-media suite already proves both DELETE/playback orderings with real HEAD checks.
    .filter(c => !(c.name === "playback" && c.restriction === "DELETE"));

  test.each(cases)("$name / $restriction / $order", async c => {
    const f = await h.workflow(c.stage);
    const match = c.name === "matching-read" ? await h.matching(f) : undefined;
    const run = () => {
      switch (c.name) {
        case "playback": return h.play(f.expert.cookie, f.id);
        case "draft-init": return h.request(f.expert.cookie, f.initPath, {});
        case "draft-read": return h.request(f.expert.cookie, f.initPath, undefined, "GET");
        case "draft-edit": return h.request(f.expert.cookie, "expert/reviews/" + f.reviewId + "/draft", {
          expectedVersion: 2, summary: "Synthetic concurrent private summary.",
        }, "PATCH");
        case "submit": return h.request(f.expert.cookie, "expert/reviews/" + f.reviewId + "/submit", { expectedVersion: 2 });
        case "qa-read": return h.request(f.moderator.cookie, "qa/reviews/" + f.reviewId, undefined, "GET");
        case "qa-return": return h.request(f.moderator.cookie, "qa/reviews/" + f.reviewId + "/return", {
          expectedVersion: 3, reason: "Synthetic private return feedback.",
        });
        case "qa-approve": return h.request(f.moderator.cookie, "qa/reviews/" + f.reviewId + "/approve", {
          expectedVersion: 3, claims: [{ type: "INTEREST_READING", observationId: f.observationId,
            context: "Synthetic hobbies prompt.", transcript: "Synthetic: I enjoy reading." }],
        });
        case "confirm": return h.request(f.owner.cookie, "reviews/claims/" + f.claimId, { action: "CONFIRM", expectedRevision: 0 }, "PATCH");
        case "share": return h.request(f.owner.cookie, "reviews/claims/" + f.claimId, { action: "SHARE", expectedRevision: 1 }, "PATCH");
        case "owner-report": return h.request(f.owner.cookie, "reviews/me", undefined, "GET");
        case "matching-read": return match!.read();
      }
    };
    const auditSubject = c.assignmentSubject ? f.id : c.name === "confirm" || c.name === "share" ? f.claimId : f.reviewId;
    const auditWhere = { action: c.audit, subjectId: auditSubject };
    const before = c.audit ? await h.db.client.auditLog.count({ where: auditWhere }) : 0;
    const restriction = () => h.restrict(f, c.restriction);
    const [a, b] = c.order === "operation-first"
      ? await orderedTransactions(h, run, restriction)
      : await orderedTransactions(h, restriction, run);
    const response = c.order === "operation-first" ? a : b;
    const allowed = c.order === "operation-first";
    expect(response.status).toBe(c.emptyRead || allowed ? 200 :
      c.name.startsWith("qa-") || c.name === "confirm" || c.name === "share" ? 404 : 403);
    if (c.audit) expect(await h.db.client.auditLog.count({ where: auditWhere })).toBe(before + Number(allowed));
    if (c.name === "qa-approve") expect(await h.db.client.reviewClaim.count({ where: { reviewId: f.reviewId } })).toBe(Number(allowed));
    if (c.emptyRead) {
      const body = await response.json() as { reports?: unknown[]; recommendations?: { reasons: string[] }[] };
      if (c.name === "owner-report") expect(body.reports?.length).toBe(allowed ? 1 : 0);
      else expect(body.recommendations!.flatMap(row => row.reasons).includes("The member said they enjoy reading.")).toBe(allowed);
    }
    // Restriction is now committed. A profile-only recommendation remains authorized,
    // but no media-derived claim can be newly projected after source loss.
    if (c.emptyRead) {
      const after = await (await run()).json() as { reports?: unknown[]; recommendations?: { reasons: string[] }[] };
      if (c.name === "owner-report") expect(after.reports).toEqual([]);
      else expect(after.recommendations!.flatMap(row => row.reasons)).not.toContain("The member said they enjoy reading.");
    } else expect([403, 404]).toContain((await run()).status);

    const worker = h.app.get(AssignmentCancellationWorker);
    await worker.runOnce(); await worker.runOnce();
    const assignment = await h.db.client.expertAssignment.findUniqueOrThrow({ where: { id: f.id } });
    const completed = ["approved", "confirmed", "shared"].includes(c.stage) || (c.name === "qa-approve" && allowed);
    expect(assignment.status).toBe(completed ? "COMPLETED" : "CANCELLED");
    const cancellations = await h.db.client.assignmentEvent.findMany({ where: { assignmentId: f.id, toStatus: "CANCELLED" } });
    expect(cancellations).toHaveLength(completed ? 0 : 1);
    if (!completed) expect(cancellations[0].revision).toBe(assignment.revision);
    if (c.restriction !== "DELETE") {
      await h.consent(f.owner, f.consentVersion + 1, c.restriction, true);
      if (c.emptyRead) {
        const stale = await (await run()).json() as { reports?: unknown[]; recommendations?: { reasons: string[] }[] };
        if (c.name === "owner-report") expect(stale.reports).toEqual([]);
        else expect(stale.recommendations!.flatMap(row => row.reasons)).not.toContain("The member said they enjoy reading.");
      } else expect([403, 404]).toContain((await run()).status);
    }
    const audit = JSON.stringify(await h.db.client.auditLog.findMany({ where: { subjectId: { in: [f.id, f.reviewId, f.claimId] } } }));
    for (const value of [f.expert.token, f.owner.passwordHash, "Synthetic concurrent private summary.",
      "Synthetic: I enjoy reading.", "Synthetic private return feedback."])
      expect(audit).not.toContain(value);
    if (c.restriction !== "EXPERT_VIDEO_REVIEW") {
      await h.app.get(VideoCleanupService).runOnce();
      expect(await h.finalObjectAbsent(f.videoId)).toBe(true);
      // A still-live incoming PUT is a separate capability. Do not assert full
      // erasure before its actual expiry, even when the final object is gone.
      expect((await h.db.client.video.findUniqueOrThrow({ where: { id: f.videoId } })).cleanupCompletedAt).toBeNull();
    }
  });

  test.each(["VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW", "DELETE"] as Restriction[])(
    "concurrent scanners cannot acknowledge uncommitted %s, then reconcile once", async kind => {
      const f = await h.workflow("draft");
      const freshWorker = () => new AssignmentCancellationWorker(h.db.client as unknown as PrismaService,
        h.app.get(AssignmentCancellationService), h.app.get(EnvironmentService));
      const ledger = await h.db.client.consentLedger.findUniqueOrThrow({ where: { userId: f.owner.id } });
      await orderedTransactions(h, () => h.restrict(f, kind), async () => {
        await Promise.all([freshWorker().runOnce(), freshWorker().runOnce()]);
        expect(await h.db.client.assignmentEvent.count({ where: { assignmentId: f.id, toStatus: "CANCELLED" } })).toBe(0);
        expect(await h.db.client.assignmentCancellationContext.count({ where: { event: { assignmentId: f.id } } })).toBe(0);
        expect(await h.db.client.consentWithdrawalTask.count({ where: { subjectId: ledger.subjectId } })).toBe(0);
      }, false);
      for (let attempt = 0; attempt < 3; attempt++) await Promise.all([freshWorker().runOnce(), freshWorker().runOnce()]);
      expect((await h.db.client.expertAssignment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("CANCELLED");
      expect(await h.db.client.assignmentEvent.count({ where: { assignmentId: f.id, toStatus: "CANCELLED" } })).toBe(1);
      if (kind !== "DELETE") {
        const task = await h.db.client.consentWithdrawalTask.findFirstOrThrow({ where: { subjectId: ledger.subjectId } });
        expect(task.status).toBe("PENDING"); // C051 does not impersonate every other consumer.
        expect(await h.db.client.assignmentWithdrawalReceipt.count({ where: { withdrawalTaskId: task.id } })).toBe(1);
      }
    });

  test("cold processes retry a real storage outage and verify late staging cleanup after actual expiry", async () => {
    const metadata = await h.db.client.video.findUniqueOrThrow({ where: { id: recovery.videoId } });
    expect(metadata.cleanupCompletedAt).toBeNull();
    const deadline = metadata.uploadExpiresAt!.getTime() + 1500;
    while (Date.now() < deadline) await new Promise(r => setTimeout(r, Math.min(5000, deadline - Date.now())));
    expect((await fetch(recovery.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: h.media })).status).toBe(403);
    const due = () => h.db.client.videoCleanupTask.update({ where: { videoId: recovery.videoId }, data: { nextAttemptAt: new Date(0) } });
    const coldWorker = (endpoint: string) => execFileSync(process.execPath, [join(__dirname, "workflow-restart-worker.cjs")], {
      cwd: join(__dirname, ".."), windowsHide: true, timeout: 60000, stdio: "pipe",
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: h.db.url, MINIO_BUCKET: h.bucket, MINIO_ENDPOINT: endpoint },
    });
    await due();
    const before = await h.db.client.videoCleanupTask.findUniqueOrThrow({ where: { videoId: recovery.videoId } });
    coldWorker("http://127.0.0.1:1"); // Real refused connection, not a mocked deletion/HEAD.
    const failed = await h.db.client.videoCleanupTask.findUniqueOrThrow({ where: { videoId: recovery.videoId } });
    expect(failed.status).toBe("PENDING");
    expect(failed.completedAt).toBeNull();
    expect(failed.attempts).toBeGreaterThan(before.attempts);
    expect((await h.db.client.video.findUniqueOrThrow({ where: { id: recovery.videoId } })).cleanupCompletedAt).toBeNull();
    expect(await h.incomingObjectAbsent(recovery.videoId)).toBe(false);
    expect((await h.request(recovery.owner.cookie, "videos/" + recovery.videoId, {}, "DELETE")).status).toBe(202);
    await due(); coldWorker(h.values.minio.endpoint);
    expect(await h.finalObjectAbsent(recovery.videoId)).toBe(true);
    expect(await h.incomingObjectAbsent(recovery.videoId)).toBe(true);
    expect(await h.db.client.videoCleanupTask.findUniqueOrThrow({ where: { videoId: recovery.videoId } }))
      .toMatchObject({ status: "COMPLETE", completedAt: expect.any(Date) });
    expect((await h.db.client.video.findUniqueOrThrow({ where: { id: recovery.videoId } })).cleanupCompletedAt).toBeInstanceOf(Date);
    expect(await h.db.client.assignmentEvent.count({ where: { assignmentId: recovery.id, toStatus: "CANCELLED" } })).toBe(1);
    coldWorker(h.values.minio.endpoint);
    expect(await h.db.client.assignmentEvent.count({ where: { assignmentId: recovery.id, toStatus: "CANCELLED" } })).toBe(1);
  }, 480000);
});
