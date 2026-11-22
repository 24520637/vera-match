import { ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { StaffAssuranceSource } from "../src/safety/staff-assurance.source";
import { AssignmentCancellationWorker } from "../src/assignment-cancellation/assignment-cancellation.worker";
import { securityMediaHarness, SecurityMediaHarness } from "./security-media-fixtures";

describe("C053 merged API privacy and atomic audit", () => {
  let h: SecurityMediaHarness;
  beforeAll(async () => { h = await securityMediaHarness(); }, 60000);
  afterAll(async () => { await h?.close(); });
  const canary = "synthetic-provider-diagnostic-canary";
  function fail(kind: "training" | "confidentiality" | "evidence") {
    const failure = new ServiceUnavailableException({ code: "SYNTHETIC_UPSTREAM", message: canary });
    if (kind === "evidence") (h.evidenceSource.find as jest.Mock).mockRejectedValueOnce(failure);
    else (h.approvalRegistry[kind] as jest.Mock).mockImplementationOnce(() => { throw failure; });
  }
  for (const operation of ["approval", "assignment"] as const)
    test.each(["training", "confidentiality", "evidence"] as const)(operation + " sanitizes %s provider HttpException", async kind => {
      const f = await h.fixture();
      const before = { audit: await h.db.client.auditLog.count(), events: await h.db.client.assignmentEvent.count(),
        receipts: await h.db.client.assignmentIdempotency.count() };
      const credential = await h.db.client.expertCredential.findUniqueOrThrow({ where: { userId: f.expert.id }, include: { approval: true } });
      const records = [...h.records.values()].filter(r => r.userId === f.expert.id);
      fail(kind);
      const response = operation === "assignment"
        ? await h.request(f.moderator.cookie, "expert-admin/assignments", { videoId: f.videoId, expertId: f.expert.id,
          expectedCredentialRevision: 1, dueAt: null, expiresAt: null })
        : await h.request(f.moderator.cookie, "expert-admin/experts/" + f.expert.id + "/approvals", {
          expectedRevision: 1, trainingVersion: credential.approval!.trainingVersion,
          policyVersion: credential.approval!.policyVersion,
          trainingEvidenceId: records.find(r => r.kind === "TRAINING_COMPLETION")!.id,
          confidentialityEvidenceId: records.find(r => r.kind === "CONFIDENTIALITY_ACCEPTANCE")!.id, expiresAt: null,
        });
      expect(response.status).toBe(503);
      const body = await response.json() as { code: string };
      expect(JSON.stringify(body).includes(canary)).toBe(false);
      expect(body.code).toBe(operation === "assignment" ? "ASSIGNMENT_UNAVAILABLE" : "EXPERT_APPROVAL_UNAVAILABLE");
      expect({ audit: await h.db.client.auditLog.count(), events: await h.db.client.assignmentEvent.count(),
        receipts: await h.db.client.assignmentIdempotency.count() }).toEqual(before);
      expect((await h.db.client.expertCredential.findUniqueOrThrow({ where: { userId: f.expert.id } })).revision).toBe(credential.revision);
    });

  test("moderation provider failure is sanitized while ordinary missing MFA remains forbidden", async () => {
    const actor = await h.account("MODERATOR");
    const before = await h.db.client.auditLog.count({ where: { action: "SAFETY_REPORT_QUEUE_READ" } });
    const spy = jest.spyOn(h.app.get(StaffAssuranceSource), "resolve").mockRejectedValueOnce(
      new ServiceUnavailableException({ code: "SYNTHETIC_UPSTREAM", message: canary }));
    try {
      const response = await h.request(actor.cookie, "moderation/reports", undefined, "GET");
      expect(response.status).toBe(503);
      const body = await response.json() as { code: string };
      expect(JSON.stringify(body).includes(canary)).toBe(false);
      expect(body.code).toBe("STAFF_ASSURANCE_UNAVAILABLE");
      expect((await h.request(actor.cookie, "moderation/reports", undefined, "GET")).status).toBe(403);
      expect(await h.db.client.auditLog.count({ where: { action: "SAFETY_REPORT_QUEUE_READ" } })).toBe(before);
    } finally { spy.mockRestore(); }
  });

  async function upload(owner: Awaited<ReturnType<typeof h.account>>) {
    const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const response = await h.request(owner.cookie, "videos/upload-intent", { mimeType: "video/mp4", sizeBytes: bytes.length });
    expect(response.status).toBe(201);
    const intent = await response.json() as { id: string; uploadUrl: string };
    expect((await fetch(intent.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: bytes })).status).toBe(200);
    expect((await h.request(owner.cookie, "videos/" + intent.id + "/confirm")).status).toBe(201);
    return intent.id;
  }
  async function auditFailure(action: string) {
    if (!/^[A-Z_]+$/.test(action)) throw Error("Synthetic audit action required");
    await h.db.client.$executeRawUnsafe("CREATE FUNCTION c053_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='" + action + "' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$");
    await h.db.client.$executeRawUnsafe('CREATE TRIGGER c053_audit_fault BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION c053_audit_fault()');
    return async () => {
      await h.db.client.$executeRawUnsafe('DROP TRIGGER c053_audit_fault ON "AuditLog"');
      await h.db.client.$executeRawUnsafe('DROP FUNCTION c053_audit_fault()');
    };
  }

  test("C033 audit failure rolls back assignment, event and receipt; concurrent same-key retry creates one evidence chain", async () => {
    const f = await h.fixture(), videoId = await upload(f.owner), key = randomUUID();
    const input = { videoId, expertId: f.expert.id, expectedCredentialRevision: 1, dueAt: null, expiresAt: null };
    const receiptCount = await h.db.client.assignmentIdempotency.count();
    const eventCount = await h.db.client.assignmentEvent.count();
    const successCount = await h.db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED" } });
    const remove = await auditFailure("EXPERT_ASSIGNMENT_CREATED");
    try {
      expect((await h.request(f.moderator.cookie, "expert-admin/assignments", input, "POST", { "Idempotency-Key": key })).status).toBe(503);
      expect(await h.db.client.expertAssignment.count({ where: { videoId } })).toBe(0);
      expect(await h.db.client.assignmentIdempotency.count()).toBe(receiptCount);
      expect(await h.db.client.assignmentEvent.count()).toBe(eventCount);
      expect(await h.db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED" } })).toBe(successCount);
    } finally { await remove(); }
    const responses = await Promise.all(Array.from({ length: 3 }, () =>
      h.request(f.moderator.cookie, "expert-admin/assignments", input, "POST", { "Idempotency-Key": key })));
    expect(responses.map(r => r.status)).toEqual([201, 201, 201]);
    const ids = await Promise.all(responses.map(async r => ((await r.json()) as { assignment: { id: string } }).assignment.id));
    expect(new Set(ids).size).toBe(1);
    expect(await h.db.client.assignmentEvent.count({ where: { assignmentId: ids[0] } })).toBe(1);
    expect(await h.db.client.auditLog.count({ where: { action: "EXPERT_ASSIGNMENT_CREATED", subjectId: ids[0] } })).toBe(1);
    expect(await h.db.client.assignmentIdempotency.count()).toBe(receiptCount + 1);
  });

  test("report audit failure rolls back private report text and leaves no successful submission audit", async () => {
    const a = await h.account(), b = await h.account();
    const before = await h.db.client.report.count();
    const remove = await auditFailure("SAFETY_REPORT_SUBMITTED");
    try {
      expect((await h.request(a.cookie, "reports", { targetUserId: b.id, reason: "OTHER", details: "Synthetic private report narrative only." })).status).toBe(503);
      expect(await h.db.client.report.count()).toBe(before);
      expect(await h.db.client.auditLog.count({ where: { action: "SAFETY_REPORT_SUBMITTED", actorId: a.id } })).toBe(0);
    } finally { await remove(); }
  });

  test("successful media/block/report/session operations keep minimal audit; denied playback creates no success audit", async () => {
    const f = await h.fixture(), stranger = await h.account();
    const ownerPlay = await h.request(f.owner.cookie, "videos/" + f.videoId + "/playback");
    expect(ownerPlay.status).toBe(201);
    const ownerUrl = ((await ownerPlay.json()) as { url: string }).url;
    const expertPlay = await h.play(f.expert.cookie, f.id);
    expect(expertPlay.status).toBe(200);
    const expertUrl = ((await expertPlay.json()) as { url: string }).url;
    expect((await h.play(stranger.cookie, f.id)).status).toBe(403);
    await h.storageConsent(stranger);
    expect((await h.request(stranger.cookie, "videos/" + f.videoId + "/playback")).status).toBe(404);
    expect(await h.db.client.auditLog.count({ where: { action: "EXPERT_PLAYBACK_ISSUED", subjectId: f.id } })).toBe(1);
    expect((await h.request(f.owner.cookie, "blocks", { targetUserId: stranger.id })).status).toBe(204);
    expect((await h.request(f.owner.cookie, "blocks", { targetUserId: stranger.id })).status).toBe(204);
    const note = "Synthetic private report narrative only.";
    expect((await h.request(f.owner.cookie, "reports", { targetUserId: stranger.id, reason: "OTHER", details: note })).status).toBe(202);
    expect((await h.request(f.owner.cookie, "auth/logout-all")).status).toBe(204);
    const video = await h.db.client.video.findUniqueOrThrow({ where: { id: f.videoId } });
    const audit = await h.db.client.auditLog.findMany();
    const serialized = JSON.stringify(audit);
    const privateValues = [f.owner.token, f.expert.token, f.owner.password, f.owner.passwordHash, f.expert.passwordHash, ownerUrl, expertUrl, video.objectKey,
      h.bucket, note, "SYNTHETIC SECURITY POLICY", "SYNTHETIC TRAINING", "SYNTHETIC CONFIDENTIALITY"];
    expect(privateValues.every(value => value.length > 0 && !serialized.includes(value))).toBe(true);
    expect(await h.db.client.auditLog.count({ where: { action: "SAFETY_BLOCK_CREATED", actorId: f.owner.id } })).toBe(1);
    for (const action of ["VIDEO_UPLOAD_CONFIRMED", "VIDEO_PLAYBACK_ISSUED", "EXPERT_ASSIGNMENT_CREATED", "EXPERT_PLAYBACK_ISSUED", "SAFETY_REPORT_SUBMITTED"])
      expect(audit.some(row => row.action === action)).toBe(true);
  });

  test("real draft initialization rolls back on audit failure and retries with one minimal creation audit", async () => {
    const f = await h.fixture();
    const path = "expert/assignments/" + f.id + "/draft";
    const remove = await auditFailure("EXPERT_DRAFT_CREATED");
    try {
      expect((await h.request(f.expert.cookie, path, {})).status).toBe(503);
      expect(await h.db.client.expertReview.count({ where: { assignmentId: f.id } })).toBe(0);
      expect(await h.db.client.auditLog.count({ where: { action: "EXPERT_DRAFT_CREATED", subjectId: f.id } })).toBe(0);
    } finally { await remove(); }
    for (let attempt = 0; attempt < 2; attempt++)
      expect((await h.request(f.expert.cookie, path, {})).status).toBe(200);
    expect(await h.db.client.expertReview.count({ where: { assignmentId: f.id } })).toBe(1);
    expect(await h.db.client.auditLog.count({ where: { action: "EXPERT_DRAFT_CREATED", subjectId: f.id } })).toBe(1);
  });

  test("real draft saves keep text out of audit, roll back atomically, and remain denied after C051 and re-consent", async () => {
    const f = await h.fixture();
    const readPath = "expert/assignments/" + f.id + "/draft";
    expect((await h.request(f.expert.cookie, readPath, {})).status).toBe(200);
    const draft = await h.db.client.expertReview.findUniqueOrThrow({ where: { assignmentId: f.id } });
    const path = "expert/reviews/" + draft.id + "/draft";
    const summary = "Synthetic private review audit canary.";
    const input = { expectedVersion: 1, summary };
    const remove = await auditFailure("EXPERT_DRAFT_SAVED");
    try {
      expect((await h.request(f.expert.cookie, path, input, "PATCH")).status).toBe(503);
      expect(await h.db.client.expertReview.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ version: 1, summary: null });
      expect(await h.db.client.auditLog.count({ where: { action: "EXPERT_DRAFT_SAVED", subjectId: draft.id } })).toBe(0);
    } finally { await remove(); }
    const concurrent = await Promise.all([1, 2].map(() => h.request(f.expert.cookie, path, input, "PATCH")));
    expect(concurrent.map(response => response.status).sort()).toEqual([200, 409]);
    const success = await h.db.client.auditLog.findMany({ where: { action: "EXPERT_DRAFT_SAVED", subjectId: draft.id } });
    expect(success).toHaveLength(1);
    expect(JSON.stringify(success).includes(summary)).toBe(false);
    const foreign = await h.account("EXPERT");
    expect((await h.request(foreign.cookie, path, { expectedVersion: 2, summary: "Synthetic foreign edit" }, "PATCH")).status).toBe(404);
    await h.consent(f.owner, 2, "EXPERT_VIDEO_REVIEW", false);
    await h.app.get(AssignmentCancellationWorker).runOnce();
    await h.consent(f.owner, 3, "EXPERT_VIDEO_REVIEW", true);
    const before = await h.db.client.auditLog.count();
    expect((await h.request(f.expert.cookie, readPath, undefined, "GET")).status).toBe(403);
    expect((await h.request(f.expert.cookie, path, { expectedVersion: 2, summary: "Synthetic stale edit" }, "PATCH")).status).toBe(403);
    expect(await h.db.client.expertReview.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ version: 2, summary });
    expect(await h.db.client.auditLog.count()).toBe(before);
  });

  test("withdrawal and re-consent preserve cancellation evidence without reviving the old assignment", async () => {
    const f = await h.fixture();
    await h.consent(f.owner, 2, "EXPERT_VIDEO_REVIEW", false);
    await h.app.get(AssignmentCancellationWorker).runOnce();
    const before = await h.db.client.assignmentEvent.count({ where: { assignmentId: f.id } });
    await h.consent(f.owner, 3, "EXPERT_VIDEO_REVIEW", true);
    await Promise.all([h.app.get(AssignmentCancellationWorker).runOnce(), h.app.get(AssignmentCancellationWorker).runOnce()]);
    expect((await h.play(f.expert.cookie, f.id)).status).toBe(403);
    expect((await h.db.client.expertAssignment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("CANCELLED");
    expect(await h.db.client.assignmentEvent.count({ where: { assignmentId: f.id } })).toBe(before);
  });
  test.each(["review withdrawal", "storage withdrawal", "owner deletion"] as const)(
    "concurrent submit and %s keep one audit chain and never restore old access", async operation => {
      const f = await h.fixture();
      const draftPath = "expert/assignments/" + f.id + "/draft";
      expect((await h.request(f.expert.cookie, draftPath, {})).status).toBe(200);
      const draft = await h.db.client.expertReview.findUniqueOrThrow({ where: { assignmentId: f.id } });
      const summary = "Synthetic concurrent submission private summary.";
      // No observations: this test does not seed or pretend to verify media duration.
      expect((await h.request(f.expert.cookie, "expert/reviews/" + draft.id + "/draft", {
        expectedVersion: 1, summary, limitations: "Synthetic privacy race fixture only.",
      }, "PATCH")).status).toBe(200);
      const submit = () => h.request(f.expert.cookie, "expert/reviews/" + draft.id + "/submit", { expectedVersion: 2 });
      const closeAccess = async () => {
        if (operation === "owner deletion") {
          expect((await h.request(f.owner.cookie, "videos/" + f.videoId, undefined, "DELETE")).status).toBe(202);
        } else {
          await h.consent(f.owner, 2, operation === "review withdrawal" ? "EXPERT_VIDEO_REVIEW" : "VIDEO_STORAGE", false);
        }
      };
      const [first, retry] = await Promise.all([submit(), submit(), closeAccess()]);
      const statuses = [first.status, retry.status];
      for (const status of statuses) expect([200, 403, 404]).toContain(status);
      await h.app.get(AssignmentCancellationWorker).runOnce();
      const row = await h.db.client.expertAssignment.findUniqueOrThrow({ where: { id: f.id } });
      expect(row.status).toBe("CANCELLED");
      const cancellations = await h.db.client.assignmentEvent.findMany({ where: { assignmentId: f.id, toStatus: "CANCELLED" } });
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0].revision).toBe(row.revision);
      const submitted = await h.db.client.auditLog.findMany({ where: { action: "EXPERT_REVIEW_SUBMITTED", subjectId: draft.id } });
      expect(submitted).toHaveLength(statuses.includes(200) ? 1 : 0);
      if (operation !== "owner deletion")
        await h.consent(f.owner, 3, operation === "review withdrawal" ? "EXPERT_VIDEO_REVIEW" : "VIDEO_STORAGE", true);
      const before = await h.db.client.auditLog.count();
      expect([403, 404]).toContain((await submit()).status);
      expect([403, 404]).toContain((await h.play(f.expert.cookie, f.id)).status);
      await Promise.all([h.app.get(AssignmentCancellationWorker).runOnce(), h.app.get(AssignmentCancellationWorker).runOnce()]);
      expect(await h.db.client.auditLog.count()).toBe(before);
      expect(await h.db.client.assignmentEvent.count({ where: { assignmentId: f.id, toStatus: "CANCELLED" } })).toBe(1);
      const audit = JSON.stringify(await h.db.client.auditLog.findMany());
      expect(audit).not.toContain(summary);
      expect(audit).not.toContain(f.expert.token);
      expect(audit).not.toContain((await h.db.client.video.findUniqueOrThrow({ where: { id: f.videoId } })).objectKey);
    });

});
