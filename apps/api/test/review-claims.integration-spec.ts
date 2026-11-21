import { ConsentPurpose, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AuthContext } from "../src/auth/auth-context";
import { AssignmentCancellationService } from "../src/assignment-cancellation/assignment-cancellation.service";
import { AssignmentCancellationWorker } from "../src/assignment-cancellation/assignment-cancellation.worker";
import type { EnvironmentService } from "../src/config/environment.service";
import { ConsentAccessService } from "../src/consent/consent-access.service";
import { consentPurposes, type ConsentPolicyRegistry } from "../src/consent/consent.policy";
import { ConsentService } from "../src/consent/consent.service";
import type { PrismaService } from "../src/database/prisma.service";
import { AssignmentGrantsService } from "../src/expert-admin/assignment-grants.service";
import { readMatchingClaimsInTransaction } from "../src/expert-admin/review-matching-claims";
import { ReviewOwnerService } from "../src/expert-admin/review-owner.service";
import { ReviewQaService } from "../src/expert-admin/review-qa.service";
import { MatchingHandles } from "../src/matching/matching-handles";
import { MatchingService } from "../src/matching/matching.service";
import { BlockAccessService } from "../src/safety/block-access.service";
import { SafetyAccessService } from "../src/safety/safety-access.service";
import type { StaffAssuranceSource } from "../src/safety/staff-assurance.source";
import type { PrivateStorageService } from "../src/video/private-storage.service";
import { VideoCleanupService } from "../src/video/video-cleanup.service";
import { VideoService } from "../src/video/video.service";
import { createAuthDatabase } from "./disposable-auth-database";
import { actor, assignmentEvent, seedExpert, transition } from "./expert-db-fixtures";

describe("T12 review claims and disputes / disposable PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createAuthDatabase>>;
  beforeAll(async () => { db = await createAuthDatabase(); }, 60_000);
  afterAll(async () => { await db?.close(); });

  const policyVersion = "synthetic-t12-policy";
  const environment = { values: { nodeEnv: "test" } } as EnvironmentService;
  const registry: ConsentPolicyRegistry = { current: purpose => ({
    purpose, policyVersion, locale: "en", content: "Synthetic test consent policy.", testOnly: true,
  }) };
  const assurance: StaffAssuranceSource = { resolve: async (_tx, auth) => ({
    userId: auth.user.id, sessionId: auth.sessionId, level: "MFA", verifiedAt: new Date(0),
    expiresAt: new Date(Date.now() + 600_000), testOnly: true,
  }) };

  async function login(id: string): Promise<AuthContext> {
    const user = await db.client.user.update({ where: { id }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
    const session = await db.client.session.create({ data: { userId: id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600_000) } });
    return { sessionId: session.id, user };
  }

  async function user(role: UserRole) {
    const row = await db.client.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-only", role } });
    return login(row.id);
  }

  async function setupReview() {
    const client = db.client as unknown as PrismaService;
    const consent = new ConsentAccessService(client, environment);
    const consentService = new ConsentService(client, registry, environment);
    const access = new SafetyAccessService(client);
    const qa = new ReviewQaService(client, access, assurance, environment, consent);
    const ownerService = new ReviewOwnerService(access, consent);
    const grants = new AssignmentGrantsService(client, environment, { resolve: async (_tx, auth) => ({
      userId: auth.user.id, role: "ADMIN", active: true, reference: "synthetic-t12", testOnly: true,
    }) }, assurance);
    const seed = await seedExpert(db.client);
    const moderator = await login(seed.moderator.id);
    const owner = await user("MEMBER");
    const stranger = await user("MEMBER");
    const admin = await user("ADMIN");
    function patchConsent(auth: AuthContext, expectedVersion: number, purposes: ConsentPurpose[], granted: boolean) {
      return consentService.patch(auth.user.id, { expectedVersion, consents: purposes.map(purpose => ({
        purpose, granted, ...(granted ? { policyVersion } : {}),
      })) }, randomUUID());
    }
    await patchConsent(owner, 0, consentPurposes, true);
    await patchConsent(stranger, 0, ["PROFILE_MATCHING"], true);
    const generation = await db.client.consentLedger.findUniqueOrThrow({ where: { userId: owner.user.id } });
    const video = await db.client.video.create({ data: { ownerId: owner.user.id, bucket: "synthetic-private", objectKey: randomUUID(),
      mimeType: "video/mp4", status: "READY", durationMs: 5000, storageConsentVersion: generation.version } });
    const assignment = await db.client.$transaction(async tx => {
      const row = await tx.expertAssignment.create({ data: { videoId: video.id, expertId: seed.expert.id,
        assignedById: moderator.user.id, assignedByEvidence: actor, credentialApprovalId: seed.approval.id,
        reviewConsentSubjectId: generation.subjectId, reviewConsentVersion: generation.version } });
      await assignmentEvent(tx, row.id, null);
      return row;
    });
    const grant = await grants.grant(admin, { assignmentId: assignment.id, moderatorId: moderator.user.id, expectedRevision: 0,
      expiresAt: new Date(Date.now() + 600_000).toISOString() });
    await transition(db.client, assignment.id, 0n, "IN_PROGRESS");
    await transition(db.client, assignment.id, 1n, "SUBMITTED");
    const review = await db.client.expertReview.create({ data: { assignmentId: assignment.id, status: "SUBMITTED", version: 2,
      submittedAt: new Date(), summary: "The member discussed hobbies.", limitations: "One recording.", observations: { create: {
        category: "SPEECH", startMs: 100, endMs: 900, observation: "The member mentioned reading.", context: "Hobbies prompt.",
      } } }, include: { observations: true } });
    const approval = { expectedVersion: 2, claims: [{ type: "INTEREST_READING", observationId: review.observations[0].id,
      context: "Hobbies prompt.", transcript: "I enjoy reading." }] };
    const matching = () => db.client.$transaction(tx => readMatchingClaimsInTransaction(tx, consent, stranger.user.id, owner.user.id));
    return { client, consent, qa, ownerService, grants, moderator, owner, stranger, admin, patchConsent, generation,
      video, assignment, grant, review, approval, matching };
  }

  it("commits QA evidence, scopes disputes and removes claims at the matching read boundary", async () => {
    const { client, qa, ownerService, grants, moderator, owner, stranger, admin, patchConsent, generation,
      assignment, grant, review, approval, matching } = await setupReview();
    await expect(ownerService.list(owner)).resolves.toEqual({ reports: [], nextCursor: null });
    const decisions = await Promise.allSettled([qa.approve(moderator, review.id, approval), qa.approve(moderator, review.id, approval)]);
    expect(decisions.filter(decision => decision.status === "fulfilled")).toHaveLength(1);
    expect(decisions.find(decision => decision.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const claim = await db.client.reviewClaim.findFirstOrThrow({ where: { reviewId: review.id } });
    expect(await db.client.reviewClaim.count({ where: { reviewId: review.id } })).toBe(1);
    expect(claim).toMatchObject({ reviewVersion: 3, ownerConfirmed: false, shareApproved: false, sourceEndMs: 900 });
    await db.client.reviewClaim.create({ data: { reviewId: review.id, claimType: "INTEREST_READING", claimText: claim.claimText,
      qaApproved: true, ownerConfirmed: true, shareApproved: true } });
    await expect(ownerService.list(owner)).resolves.toMatchObject({ reports: [{ claims: [{ id: claim.id }] }] });
    await expect(ownerService.list(stranger)).resolves.toEqual({ reports: [], nextCursor: null });
    await expect(ownerService.updateClaim(stranger, claim.id, { action: "CONFIRM", expectedRevision: 0 })).rejects.toMatchObject({ status: 404 });
    const feedbackInput = { target: "CONTEXT", note: "It was a question about weekend hobbies.", expectedRevision: 0 };
    await expect(ownerService.saveFeedback(stranger, claim.id, feedbackInput)).rejects.toMatchObject({ status: 404 });
    await expect(ownerService.saveFeedback(owner, claim.id, feedbackInput)).resolves.toMatchObject({
      feedback: { target: "CONTEXT", note: feedbackInput.note, revision: 1 },
    });
    await expect(ownerService.list(owner)).resolves.toMatchObject({ reports: [{ claims: [{
      feedback: [{ target: "CONTEXT", note: feedbackInput.note, revision: 1 }], ownerConfirmed: false, shareApproved: false,
    }] }] });
    await expect(matching()).resolves.toEqual([]);
    await ownerService.updateClaim(owner, claim.id, { action: "CONFIRM", expectedRevision: 0 });
    await expect(matching()).resolves.toEqual([]);
    await ownerService.updateClaim(owner, claim.id, { action: "SHARE", expectedRevision: 1 });
    await expect(matching()).resolves.toEqual([{ type: "INTEREST_READING", statement: claim.claimText }]);
    await expect(ownerService.openDispute(stranger, review.id, { reason: "Foreign report." })).rejects.toMatchObject({ status: 404 });
    const opened = await Promise.allSettled([
      ownerService.openDispute(owner, review.id, { claimId: claim.id, reason: "Check the transcript." }),
      ownerService.openDispute(owner, review.id, { claimId: claim.id, reason: "Check the transcript." }),
    ]);
    const win = opened.find(outcome => outcome.status === "fulfilled");
    if (!win) throw new Error("Expected one dispute to open");
    expect(opened.find(outcome => outcome.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const dispute = win.value.dispute;
    await expect(matching()).resolves.toEqual([]);
    await expect(qa.readDispute(moderator, dispute.id)).resolves.toMatchObject({ report: null, claim: {
      statement: claim.claimText, evidence: { transcript: "I enjoy reading." },
    } });
    await expect(qa.listDisputes(moderator)).resolves.toMatchObject({ disputes: [{ id: dispute.id }] });
    const unassigned = await user("MODERATOR");
    await expect(qa.readDispute(unassigned, dispute.id)).rejects.toMatchObject({ status: 404 });
    await expect(qa.decideDispute(unassigned, dispute.id, { expectedRevision: 0, status: "IN_REVIEW" })).rejects.toMatchObject({ status: 404 });
    await qa.decideDispute(moderator, dispute.id, { expectedRevision: 0, status: "IN_REVIEW" });
    await qa.decideDispute(moderator, dispute.id, { expectedRevision: 1, status: "REJECTED", resolution: "The recording supports the claim." });
    await expect(matching()).resolves.toHaveLength(1);
    expect(await db.client.expertReview.findUnique({ where: { id: review.id } })).toMatchObject({ version: 3, status: "APPROVED" });
    await patchConsent(owner, Number(generation.version), ["VIDEO_CLAIM_MATCHING"], false);
    await expect(matching()).resolves.toEqual([]);
    await patchConsent(owner, Number(generation.version) + 1, ["VIDEO_CLAIM_MATCHING"], true);
    await expect(matching()).resolves.toEqual([]);
    await ownerService.updateClaim(owner, claim.id, { action: "SHARE", expectedRevision: 2 });
    await expect(matching()).resolves.toHaveLength(1);

    const { dispute: entireReport } = await ownerService.openDispute(owner, review.id, { reason: "Check the report summary." });
    await expect(qa.readDispute(moderator, entireReport.id)).resolves.toEqual({
      dispute: entireReport, reviewId: review.id, claim: null,
      report: { version: 3, summary: review.summary, limitations: review.limitations, approvedAt: expect.any(Date) },
    });
    await expect(qa.readDispute(moderator, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(qa.readDispute(stranger, entireReport.id)).rejects.toMatchObject({ status: 403 });
    await expect(qa.readDispute(unassigned, entireReport.id)).rejects.toMatchObject({ status: 404 });
    await qa.decideDispute(moderator, entireReport.id, { expectedRevision: 0, status: "IN_REVIEW" });
    const uphold = { expectedRevision: 1, status: "RESOLVED", resolution: "The report omits an important limitation." };
    await grants.revoke(admin, { scopeId: grant.scopeId, grantId: grant.grantId, expectedRevision: grant.revision });
    await expect(qa.readDispute(moderator, entireReport.id)).rejects.toMatchObject({ status: 404 });
    await expect(qa.decideDispute(moderator, entireReport.id, uphold)).rejects.toMatchObject({ status: 404 });
    await grants.grant(admin, { assignmentId: assignment.id, moderatorId: moderator.user.id, expectedRevision: grant.revision + 1,
      expiresAt: new Date(Date.now() + 600_000).toISOString() });
    await expect(qa.decideDispute(moderator, entireReport.id, uphold)).resolves.toMatchObject({ dispute: { status: "RESOLVED" } });
    await expect(matching()).resolves.toEqual([]);

    await ownerService.updateClaim(owner, claim.id, { action: "REVOKE", expectedRevision: 3 });
    await expect(matching()).resolves.toEqual([]);
    const terminalCases = { where: { reviewId: review.id }, orderBy: { id: "asc" } } as const;
    const beforeWithdrawal = await db.client.reviewDispute.findMany(terminalCases);
    await patchConsent(owner, Number(generation.version) + 2, ["EXPERT_VIDEO_REVIEW"], false);
    await new AssignmentCancellationWorker(client, new AssignmentCancellationService(client), environment).runOnce();
    await expect(db.client.reviewDispute.findMany(terminalCases)).resolves.toEqual(beforeWithdrawal);
  });

  it("projects only currently shared canonical statements through T14 recommendations", async () => {
    const { client, consent, qa, ownerService, moderator, owner, stranger, review, approval, patchConsent } = await setupReview();
    for (const auth of [owner, stranger]) {
      await client.user.update({ where: { id: auth.user.id }, data: {
        declaredAdult: true, profile: { create: { birthDate: new Date("1990-01-01"), visibilityEnabled: true } },
      } });
    }
    const matching = new MatchingService(client, new SafetyAccessService(client), consent, new BlockAccessService(),
      new MatchingHandles(environment));
    const reasons = async () => (await matching.recommendations(stranger, {})).recommendations.map(row => row.reasons);
    const generic = ["Meets both members’ matching settings."];
    expect(await reasons()).toEqual([generic]);
    await qa.approve(moderator, review.id, approval);
    const claim = await client.reviewClaim.findFirstOrThrow({ where: { reviewId: review.id } });
    await ownerService.updateClaim(owner, claim.id, { action: "CONFIRM", expectedRevision: 0 });
    expect(await reasons()).toEqual([generic]);
    await ownerService.updateClaim(owner, claim.id, { action: "SHARE", expectedRevision: 1 });
    const response = await matching.recommendations(stranger, {});
    expect(response.recommendations).toEqual([{ key: expect.any(String), pairId: expect.any(String),
      reasons: [...generic, "The member said they enjoy reading."],
    }]);
    expect(JSON.stringify(response)).not.toContain("I enjoy reading.");
    await client.reviewClaim.update({ where: { id: claim.id }, data: { sourceStartMs: 101 } });
    expect(await reasons()).toEqual([generic]);
    await client.reviewClaim.update({ where: { id: claim.id }, data: { sourceStartMs: 100 } });
    expect(await reasons()).toContainEqual([...generic, "The member said they enjoy reading."]);
    await patchConsent(owner, 1, ["VIDEO_CLAIM_MATCHING"], false);
    expect(await reasons()).toEqual([generic]);
    await patchConsent(owner, 2, ["VIDEO_CLAIM_MATCHING"], true);
    expect(await reasons()).toEqual([generic]);
    await ownerService.updateClaim(owner, claim.id, { action: "SHARE", expectedRevision: 2 });
    expect(await reasons()).toContainEqual([...generic, "The member said they enjoy reading."]);
    await ownerService.openDispute(owner, review.id, { claimId: claim.id, reason: "Private test dispute." });
    expect(await reasons()).toEqual([generic]);
  });

  const sourceLosses = ["EXPERT_VIDEO_REVIEW", "VIDEO_STORAGE", "VIDEO_DELETED"] as const;
  const pendingStates = ["OPEN", "IN_REVIEW"] as const;

  it("protects T12 audit actors and rolls back approval, owner changes, and moderator decisions on audit failure", async () => {
    const { qa, ownerService, moderator, owner, stranger, review, assignment, approval, matching } = await setupReview();
    const rejectAudit = async (action: "REVIEW_CLAIMS_APPROVED" | "REVIEW_CLAIM_FEEDBACK_SAVED" | "REVIEW_CLAIM_CONFIRMED" |
      "REVIEW_CLAIM_REVOKED" | "REVIEW_DISPUTE_OPENED" | "REVIEW_DISPUTE_RESOLVED", operation: () => Promise<unknown>) => {
      await db.client.$executeRawUnsafe(`
        CREATE FUNCTION reject_t12_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic T12 audit failure'; END $$`);
      try {
        await db.client.$executeRawUnsafe(`
          CREATE TRIGGER reject_t12_audit BEFORE INSERT ON "AuditLog"
          FOR EACH ROW WHEN (NEW.action = '${action}') EXECUTE FUNCTION reject_t12_audit()`);
        await expect(operation()).rejects.toMatchObject({ status: 503 });
      } finally {
        await db.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_t12_audit ON "AuditLog"');
        await db.client.$executeRawUnsafe("DROP FUNCTION reject_t12_audit()");
      }
    };

    await rejectAudit("REVIEW_CLAIMS_APPROVED", () => qa.approve(moderator, review.id, approval));
    await expect(db.client.expertReview.findUnique({ where: { id: review.id } })).resolves.toMatchObject({ status: "SUBMITTED", version: 2 });
    await expect(db.client.expertAssignment.findUnique({ where: { id: assignment.id } })).resolves.toMatchObject({ status: "SUBMITTED" });
    await expect(db.client.reviewDecision.count({ where: { reviewId: review.id } })).resolves.toBe(0);
    await expect(db.client.reviewClaim.count({ where: { reviewId: review.id } })).resolves.toBe(0);
    await qa.approve(moderator, review.id, approval);
    const claim = await db.client.reviewClaim.findFirstOrThrow({ where: { reviewId: review.id } });
    const feedback = { target: "CONTEXT", note: "Private annotation unique to the owner.", expectedRevision: 0 };
    await rejectAudit("REVIEW_CLAIM_FEEDBACK_SAVED", () => ownerService.saveFeedback(owner, claim.id, feedback));
    await expect(db.client.reviewClaimFeedback.count({ where: { claimId: claim.id } })).resolves.toBe(0);
    await ownerService.saveFeedback(owner, claim.id, feedback);
    await expect(ownerService.saveFeedback(stranger, claim.id, feedback)).rejects.toMatchObject({ status: 404 });

    const confirm = () => ownerService.updateClaim(owner, claim.id, { action: "CONFIRM", expectedRevision: 0 });
    await rejectAudit("REVIEW_CLAIM_CONFIRMED", confirm);
    await expect(db.client.reviewClaim.findUnique({ where: { id: claim.id } })).resolves.toMatchObject({ revision: 0, ownerConfirmed: false });
    await confirm();
    await ownerService.updateClaim(owner, claim.id, { action: "SHARE", expectedRevision: 1 });
    const eligible = [{ type: claim.claimType, statement: claim.claimText }];
    await expect(matching()).resolves.toEqual(eligible);
    await db.client.reviewClaim.update({ where: { id: claim.id }, data: { reviewVersion: 2 } });
    await expect(matching()).resolves.toEqual([]);
    await expect(ownerService.saveFeedback(owner, claim.id, feedback)).rejects.toMatchObject({ status: 404 });
    await db.client.reviewClaim.update({ where: { id: claim.id }, data: { reviewVersion: claim.reviewVersion } });
    await expect(matching()).resolves.toEqual(eligible);

    const revoke = () => ownerService.updateClaim(owner, claim.id, { action: "REVOKE", expectedRevision: 2 });
    await rejectAudit("REVIEW_CLAIM_REVOKED", revoke);
    await expect(matching()).resolves.toEqual(eligible);
    await revoke();
    await expect(matching()).resolves.toEqual([]);
    await expect(db.client.reviewClaim.findUnique({ where: { id: claim.id } })).resolves.toMatchObject({
      revision: 3, shareApproved: false, shareConsentSubjectId: null, shareConsentVersion: null, revokedAt: expect.any(Date),
    });

    const open = () => ownerService.openDispute(owner, review.id, { claimId: claim.id, reason: "Please check this evidence." });
    await rejectAudit("REVIEW_DISPUTE_OPENED", open);
    await expect(db.client.reviewDispute.count({ where: { reviewId: review.id } })).resolves.toBe(0);
    const { dispute } = await open();
    const detail = await qa.readDispute(moderator, dispute.id);
    expect(detail.claim).toEqual({
      statement: claim.claimText,
      evidence: { startMs: claim.sourceStartMs, endMs: claim.sourceEndMs, transcript: claim.transcript, context: claim.context },
    });
    expect(JSON.stringify(detail)).not.toContain(feedback.note);
    await qa.decideDispute(moderator, dispute.id, { status: "IN_REVIEW", expectedRevision: 0 });
    const decide = () => qa.decideDispute(moderator, dispute.id, { status: "RESOLVED", expectedRevision: 1, resolution: "Checked." });
    await rejectAudit("REVIEW_DISPUTE_RESOLVED", decide);
    await expect(db.client.reviewDispute.findUnique({ where: { id: dispute.id } })).resolves.toMatchObject({
      status: "IN_REVIEW", revision: 1, resolution: null, resolvedAt: null,
    });
    await decide();

    const ownerActor = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: owner.user.id } });
    const moderatorActor = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: moderator.user.id } });
    const audit = await db.client.auditLog.findMany({ where: {
      OR: [
        { subjectId: claim.id, action: { startsWith: "REVIEW_CLAIM_" } },
        { subjectId: dispute.id, action: { startsWith: "REVIEW_DISPUTE_" } },
      ],
    }, orderBy: { action: "asc" } });
    expect(audit.map(({ action, actorId }) => [action, actorId])).toEqual([
      ...["REVIEW_CLAIM_CONFIRMED", "REVIEW_CLAIM_FEEDBACK_SAVED", "REVIEW_CLAIM_REVOKED", "REVIEW_CLAIM_SHARED"]
        .map(action => [action, ownerActor.subjectId]),
      ["REVIEW_DISPUTE_IN_REVIEW", moderatorActor.subjectId],
      ["REVIEW_DISPUTE_OPENED", ownerActor.subjectId],
      ["REVIEW_DISPUTE_READ", moderatorActor.subjectId],
      ["REVIEW_DISPUTE_RESOLVED", moderatorActor.subjectId],
    ]);
    const approvalAudit = await db.client.auditLog.findMany({ where: { subjectId: review.id, action: "REVIEW_CLAIMS_APPROVED" } });
    expect(approvalAudit).toEqual([expect.objectContaining({ actorId: moderatorActor.subjectId })]);
    for (const row of [...audit, ...approvalAudit]) {
      await expect(db.client.$executeRaw`UPDATE "AuditLog" SET action = 'UNRELATED' WHERE id = ${row.id}`)
        .rejects.toMatchObject({ meta: { code: "23514" } });
      await expect(db.client.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${row.id}`)
        .rejects.toMatchObject({ meta: { code: "23514" } });
    }
  });

  it.each(sourceLosses.flatMap(loss => pendingStates.map(status => [loss, status] as const)))(
    "closes a dispute after %s source loss from %s without exposing its evidence",
    async (loss, initialStatus) => {
      const { client, consent, qa, ownerService, moderator, owner, stranger, patchConsent, generation,
        video, review, approval, matching } = await setupReview();
      const cancellation = new AssignmentCancellationService(client);
      const worker = new AssignmentCancellationWorker(client, cancellation, environment);
      const storage = { bucket: video.bucket, playbackUrl: jest.fn() };
      const videos = new VideoService(client, consent, storage as unknown as PrivateStorageService, cancellation);
      await qa.approve(moderator, review.id, approval);
      const claim = await db.client.reviewClaim.findFirstOrThrow({ where: { reviewId: review.id } });
      await ownerService.updateClaim(owner, claim.id, { action: "CONFIRM", expectedRevision: 0 });
      await ownerService.updateClaim(owner, claim.id, { action: "SHARE", expectedRevision: 1 });
      const sharedClaim = await db.client.reviewClaim.findUniqueOrThrow({ where: { id: claim.id } });
      await expect(matching()).resolves.toHaveLength(1);
      const { dispute } = await ownerService.openDispute(owner, review.id, {
        claimId: initialStatus === "OPEN" ? claim.id : undefined, reason: "Private dispute reason.",
      });
      if (initialStatus === "IN_REVIEW")
        await qa.decideDispute(moderator, dispute.id, { status: "IN_REVIEW", expectedRevision: 0 });
      const before = await db.client.reviewDispute.findUniqueOrThrow({ where: { id: dispute.id } });
      await expect(qa.readDispute(moderator, dispute.id)).resolves.toMatchObject({ dispute: { status: initialStatus } });
      await expect(qa.listDisputes(moderator)).resolves.toMatchObject({ disputes: [{ id: dispute.id }] });
      await worker.runOnce();
      await expect(db.client.reviewDispute.findUnique({ where: { id: dispute.id } })).resolves.toEqual(before);

      if (loss === "VIDEO_DELETED") {
        await videos.remove(owner.user.id, video.id);
      } else {
        await patchConsent(owner, Number(generation.version), [loss], false);
      }
      const expectInaccessible = async (consentRestored: boolean) => {
        await expect(ownerService.list(owner)).resolves.toEqual({ reports: [], nextCursor: null });
        await expect(qa.listDisputes(moderator)).resolves.toEqual({ disputes: [], nextCursor: null });
        await expect(qa.readDispute(moderator, dispute.id)).rejects.toMatchObject({ status: 404 });
        await expect(qa.readDispute(stranger, dispute.id)).rejects.toMatchObject({ status: 403 });
        await expect(qa.decideDispute(moderator, dispute.id, initialStatus === "OPEN"
          ? { status: "IN_REVIEW", expectedRevision: 0 }
          : { status: "RESOLVED", expectedRevision: 1, resolution: "Private resolution." }))
          .rejects.toMatchObject({ status: 404 });
        await expect(matching()).resolves.toEqual([]);
        if (loss !== "EXPERT_VIDEO_REVIEW") {
          const status = loss === "VIDEO_DELETED" ? 404 : consentRestored ? 409 : 403;
          await expect(videos.playback(owner.user.id, video.id)).rejects.toMatchObject({
            status,
          });
          expect(storage.playbackUrl).not.toHaveBeenCalled();
        }
      };
      await expectInaccessible(false);
      if (loss !== "VIDEO_DELETED") {
        // The worker may first see the durable withdrawal after a fresh grant.
        await patchConsent(owner, Number(generation.version) + 1, [loss], true);
        await expectInaccessible(true);
      }

      const auditWhere = { subjectType: "ReviewDispute", subjectId: dispute.id,
        action: { startsWith: "REVIEW_DISPUTE_CLOSED_" } };
      if (loss === "EXPERT_VIDEO_REVIEW" && initialStatus === "IN_REVIEW") {
        await db.client.$executeRawUnsafe(`
          CREATE FUNCTION reject_source_closure_audit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.action = 'REVIEW_DISPUTE_CLOSED_CONSENT_WITHDRAWN' THEN
              RAISE EXCEPTION 'synthetic closure audit failure';
            END IF;
            RETURN NEW;
          END $$`);
        await db.client.$executeRawUnsafe(`
          CREATE TRIGGER reject_source_closure_audit BEFORE INSERT ON "AuditLog"
          FOR EACH ROW EXECUTE FUNCTION reject_source_closure_audit()`);
        try {
          await worker.runOnce();
          await expect(db.client.reviewDispute.findUnique({ where: { id: dispute.id } })).resolves.toEqual(before);
          await expect(db.client.auditLog.count({ where: auditWhere })).resolves.toBe(0);
          await expectInaccessible(true);
        } finally {
          await db.client.$executeRawUnsafe('DROP TRIGGER reject_source_closure_audit ON "AuditLog"');
          await db.client.$executeRawUnsafe("DROP FUNCTION reject_source_closure_audit()");
        }
      }

      await worker.runOnce();
      const closed = await db.client.reviewDispute.findUniqueOrThrow({ where: { id: dispute.id } });
      expect(closed).toEqual({ ...before, status: "CLOSED_SOURCE_UNAVAILABLE",
        revision: before.revision + 1, resolvedAt: expect.any(Date) });
      await expectInaccessible(loss !== "VIDEO_DELETED");
      await expect(db.client.reviewClaim.findUnique({ where: { id: claim.id } })).resolves.toEqual(sharedClaim);
      await worker.runOnce();
      await expect(db.client.reviewDispute.findUnique({ where: { id: dispute.id } })).resolves.toEqual(closed);
      const closureAudits = await db.client.auditLog.findMany({ where: auditWhere });
      expect(closureAudits).toEqual([{
        id: expect.any(String), actorId: null, subjectType: "ReviewDispute", subjectId: dispute.id, createdAt: expect.any(Date),
        action: loss === "VIDEO_DELETED" ? "REVIEW_DISPUTE_CLOSED_VIDEO_DELETED" : "REVIEW_DISPUTE_CLOSED_CONSENT_WITHDRAWN",
      }]);
      await expect(db.client.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${closureAudits[0].id}`)
        .rejects.toMatchObject({ meta: { code: "23514" } });
    },
  );

  it.each(["withdrawal then deletion", "withdrawal then cleanup", "deletion then withdrawal"] as const)(
    "audits the first recorded cause for %s",
    async order => {
      const { client, consent, qa, ownerService, moderator, owner, patchConsent, generation, video, review, approval } = await setupReview();
      const cancellation = new AssignmentCancellationService(client);
      const worker = new AssignmentCancellationWorker(client, cancellation, environment);
      const storage = { bucket: video.bucket, remove: jest.fn().mockResolvedValue(undefined) } as unknown as PrivateStorageService;
      const videos = new VideoService(client, consent, storage, cancellation);
      const withdraw = () => patchConsent(owner, Number(generation.version), ["VIDEO_STORAGE"], false);
      await qa.approve(moderator, review.id, approval);
      const { dispute } = await ownerService.openDispute(owner, review.id, { reason: "Private dispute reason." });

      if (order === "deletion then withdrawal") {
        await videos.remove(owner.user.id, video.id);
        // Keep the stored millisecond timestamps distinct in the reverse-order case.
        await db.client.$queryRaw`SELECT true AS elapsed FROM pg_sleep(0.01)`;
        await withdraw();
      } else {
        await withdraw();
        if (order === "withdrawal then cleanup")
          await new VideoCleanupService(client, storage, environment).runOnce();
        else
          await videos.remove(owner.user.id, video.id);
      }
      await expect(db.client.video.findUnique({ where: { id: video.id } })).resolves.toMatchObject({ status: "DELETED" });
      await worker.runOnce();
      await worker.runOnce();
      await expect(db.client.reviewDispute.findUnique({ where: { id: dispute.id } })).resolves.toMatchObject({
        status: "CLOSED_SOURCE_UNAVAILABLE", revision: 1, resolution: null,
      });
      await expect(db.client.auditLog.findMany({
        where: { subjectType: "ReviewDispute", subjectId: dispute.id, action: { startsWith: "REVIEW_DISPUTE_CLOSED_" } },
        select: { action: true, actorId: true, subjectType: true, subjectId: true },
      })).resolves.toEqual([{
        action: order === "deletion then withdrawal"
          ? "REVIEW_DISPUTE_CLOSED_VIDEO_DELETED" : "REVIEW_DISPUTE_CLOSED_CONSENT_WITHDRAWN",
        actorId: null, subjectType: "ReviewDispute", subjectId: dispute.id,
      }]);
    },
  );

  async function blockedBackend(blocker: number, queryMarker: string) {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const [waiting] = await db.client.$queryRaw<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND ${blocker} = ANY(pg_blocking_pids(pid)) AND position(${queryMarker} IN query) > 0`;
      if (waiting) return waiting.pid;
      await delay(10);
    }
    throw new Error(`Expected PostgreSQL lock contention for ${queryMarker}`);
  }

  it.each(["moderator", "closure"] as const)(
    "serializes a moderator decision and source-loss closure when %s holds the owner lock first",
    async first => {
      const { client, qa, ownerService, moderator, owner, patchConsent, generation, review, approval } = await setupReview();
      const cancellation = new AssignmentCancellationService(client);
      const withdraw = () => patchConsent(owner, Number(generation.version), ["EXPERT_VIDEO_REVIEW"], false);
      await qa.approve(moderator, review.id, approval);
      const { dispute } = await ownerService.openDispute(owner, review.id, { reason: "Private dispute reason." });
      await qa.decideDispute(moderator, dispute.id, { status: "IN_REVIEW", expectedRevision: 0 });
      const resolution = "Private moderator response.";
      const decide = () => qa.decideDispute(moderator, dispute.id, { status: "RESOLVED", expectedRevision: 1, resolution });
      const close = () => cancellation.processSourceUnavailableDispute(dispute.id);

      // Pause the first transaction at its real audit insert, while it still
      // holds the owner row lock. Observe PostgreSQL's wait graph before release.
      await db.client.$executeRawUnsafe(`
        CREATE FUNCTION hold_dispute_race_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action IN ('REVIEW_DISPUTE_RESOLVED', 'REVIEW_DISPUTE_CLOSED_CONSENT_WITHDRAWN') THEN
            PERFORM pg_advisory_xact_lock(hashtextextended(NEW."subjectId", 0));
          END IF;
          RETURN NEW;
        END $$`);
      let release!: () => void;
      const hold = new Promise<void>(resolve => { release = resolve; });
      const running: Promise<unknown>[] = [];
      function track<T>(operation: Promise<T>) {
        void operation.catch(() => undefined);
        running.push(operation);
        return operation;
      }

      try {
        await db.client.$executeRawUnsafe(`
          CREATE TRIGGER hold_dispute_race_audit BEFORE INSERT ON "AuditLog"
          FOR EACH ROW EXECUTE FUNCTION hold_dispute_race_audit()`);
        if (first === "closure") await withdraw();
        let acquired!: (pid: number) => void;
        const ready = new Promise<number>(resolve => { acquired = resolve; });
        const gate = track(db.client.$transaction(async tx => {
          const [lock] = await tx.$queryRaw<{ pid: number }[]>`
            SELECT pg_backend_pid() AS pid FROM pg_advisory_xact_lock(hashtextextended(${dispute.id}, 0))`;
          acquired(lock.pid);
          await hold;
        }, { timeout: 10000 }));
        const gatePid = await Promise.race([ready, gate.then(() => { throw new Error("Audit gate exited early"); })]);

        if (first === "moderator") {
          const decision = track(decide());
          const moderatorPid = await blockedBackend(gatePid, '"AuditLog"');
          const withdrawal = track(withdraw());
          const withdrawalPid = await blockedBackend(moderatorPid, 'FROM "User"');
          const closure = track(close());
          await blockedBackend(withdrawalPid, 'FROM "User"');
          release();
          await expect(decision).resolves.toMatchObject({ dispute: { status: "RESOLVED", revision: 2 } });
          await withdrawal;
          await closure;
        } else {
          const closure = track(close());
          const closurePid = await blockedBackend(gatePid, '"AuditLog"');
          const decision = track(decide());
          await blockedBackend(closurePid, 'FROM "User"');
          release();
          await closure;
          await expect(decision).rejects.toMatchObject({ status: 404 });
        }
        await gate;
        await close();
        await expect(decide()).rejects.toMatchObject({ status: 404 });
        await expect(qa.readDispute(moderator, dispute.id)).rejects.toMatchObject({ status: 404 });
        await expect(db.client.reviewDispute.findUnique({ where: { id: dispute.id } })).resolves.toMatchObject({
          status: first === "moderator" ? "RESOLVED" : "CLOSED_SOURCE_UNAVAILABLE",
          revision: 2, resolution: first === "moderator" ? resolution : null, resolvedAt: expect.any(Date),
        });
        const { subjectId: ownerSubject } = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: owner.user.id } });
        const { subjectId: moderatorSubject } = await db.client.expertActorIdentity.findUniqueOrThrow({ where: { userId: moderator.user.id } });
        await expect(db.client.auditLog.findMany({ where: { subjectType: "ReviewDispute", subjectId: dispute.id },
          select: { action: true, actorId: true }, orderBy: { action: "asc" },
        })).resolves.toEqual(first === "moderator" ? [
          { action: "REVIEW_DISPUTE_IN_REVIEW", actorId: moderatorSubject },
          { action: "REVIEW_DISPUTE_OPENED", actorId: ownerSubject },
          { action: "REVIEW_DISPUTE_RESOLVED", actorId: moderatorSubject },
        ] : [
          { action: "REVIEW_DISPUTE_CLOSED_CONSENT_WITHDRAWN", actorId: null },
          { action: "REVIEW_DISPUTE_IN_REVIEW", actorId: moderatorSubject },
          { action: "REVIEW_DISPUTE_OPENED", actorId: ownerSubject },
        ]);
      } finally {
        release();
        await Promise.allSettled(running);
        await db.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS hold_dispute_race_audit ON "AuditLog"');
        await db.client.$executeRawUnsafe("DROP FUNCTION hold_dispute_race_audit()");
      }
    },
  );
});
