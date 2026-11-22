import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import type { AuthContext } from "../auth/auth-context";
import type { EnvironmentService } from "../config/environment.service";
import type { ConsentAccessService } from "../consent/consent-access.service";
import type { PrismaService } from "../database/prisma.service";
import type { SafetyAccessService } from "../safety/safety-access.service";
import type { StaffAssuranceSource } from "../safety/staff-assurance.source";
import { ReviewQaService } from "./review-qa.service";

describe("C057–C058 independent quality review", () => {
  const moderator: AuthContext = { sessionId: "session", user: { id: "moderator", role: "MODERATOR", email: "qa@example.invalid", displayName: null } };
  const now = new Date("2026-01-01T00:00:00Z");
  const expiresAt = new Date(now.getTime() + 60_000);

  function setup(expertId = "expert") {
    const assignment = { id: "assignment", expertId, videoId: "video", status: "SUBMITTED", revision: 2n,
      cancelledAt: null, expiresAt: null, video: { ownerId: "owner", status: "READY", deletedAt: null, durationMs: 8000 } };
    const review = { version: 3, status: "SUBMITTED", submittedAt: now, summary: "A recorded observation.",
      limitations: "A single recording.", observations: [] as Array<{
        id: string; category: string; startMs: number; endMs: number; observation: string; context: string;
      }> };
    const approved = { ...review, id: "review", qaAt: now, qaById: moderator.user.id, assignment,
      decisions: [{ version: 3, moderatorId: moderator.user.id, decidedAt: now }] };
    const dispute = { id: "dispute", claimId: null, reviewVersion: 3, review: approved, claim: null, revision: 0,
      status: "OPEN", reason: "Synthetic owner reason.", resolution: null, createdAt: now, inReviewAt: null, resolvedAt: null };
    const grantLookup = jest.fn(async () => [{ expiresAt }]);
    const tx = {
      $queryRaw: jest.fn(async (query: TemplateStringsArray) =>
        query[0].includes('SELECT "expiresAt" FROM') ? grantLookup() : [{ now }]),
      $executeRaw: jest.fn(),
      session: { findUnique: jest.fn(async () => ({ expiresAt })) },
      block: { count: jest.fn(async () => 0) },
      expertReview: { findFirst: jest.fn(async () => review), findUniqueOrThrow: jest.fn(async () => review),
        updateMany: jest.fn(async () => ({ count: 1 })) },
      expertAssignment: { findUnique: jest.fn(async () => assignment), updateMany: jest.fn(async () => ({ count: 1 })) },
      expertActorIdentity: { upsert: jest.fn(async () => ({ subjectId: "opaque-actor" })) },
      reviewDecision: { create: jest.fn() },
      reviewClaim: { createMany: jest.fn() },
      reviewDispute: { findFirst: jest.fn(async () => dispute), updateMany: jest.fn(async () => ({ count: 1 })) },
      auditLog: { create: jest.fn() },
    };
    const prisma = { expertReview: { findUnique: jest.fn(async () => ({ assignmentId: assignment.id, assignment })) },
      reviewDispute: { findUnique: jest.fn(async () => ({ reviewId: "review" })) } };
    const access = { run: jest.fn(async (_auth, _role, _peers, action) => action(tx, now)) };
    const assurance = { resolve: jest.fn(async () => ({ userId: moderator.user.id, sessionId: moderator.sessionId, level: "MFA",
      verifiedAt: now, expiresAt, testOnly: true })) };
    const consent = { requireInTransaction: jest.fn(async () => ({ subjectId: "opaque-owner" })), requireGenerationInTransaction: jest.fn() };
    const environment = { values: { nodeEnv: "test" } };
    const service = new ReviewQaService(prisma as unknown as PrismaService, access as unknown as SafetyAccessService,
      assurance as unknown as StaffAssuranceSource, environment as EnvironmentService, consent as unknown as ConsentAccessService);
    return { service, tx, assignment, review, assurance, consent, grantLookup, dispute };
  }

  it("rejects a blank reason and writes no feedback", () => {
    const { service, tx } = setup();
    expect(() => service.returnReview(moderator, "review", { expectedVersion: 3, reason: " \n " })).toThrow(expect.objectContaining({ status: 400 }));
    expect(tx.expertReview.updateMany).not.toHaveBeenCalled();
  });

  it("returns the submitted version with private feedback and a metadata-only audit", async () => {
    const { service, tx } = setup();
    const reason = "Describe the opening prompt.";
    await expect(service.returnReview(moderator, "review", { expectedVersion: 3, reason: ` ${reason} ` }))
      .resolves.toEqual({ id: "review", status: "RETURNED", version: 4, decidedAt: now });
    expect(tx.expertAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "IN_PROGRESS" }) }));
    expect(tx.reviewDecision.create).toHaveBeenCalledWith({ data: { reviewId: "review", moderatorId: "moderator", version: 4, status: "RETURNED", reason, decidedAt: now } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId: "moderator", subjectId: "review", subjectType: "ExpertReview", action: "EXPERT_REVIEW_RETURNED" } });
  });

  it("rejects stale decisions and returns against an editable review", async () => {
    const { service, review, tx } = setup();
    const body = { expectedVersion: 2, reason: "Add context." };
    await expect(service.returnReview(moderator, "review", body)).rejects.toMatchObject({ status: 409, response: { code: "REVIEW_VERSION_CONFLICT" } });
    review.status = "DRAFT";
    await expect(service.returnReview(moderator, "review", { ...body, expectedVersion: 3 })).rejects.toMatchObject({ status: 409, response: { code: "REVIEW_STATE_CONFLICT" } });
    expect(tx.reviewDecision.create).not.toHaveBeenCalled();
  });

  it("denies self-approval even when the former author has moderator assurance", async () => {
    const { service, tx } = setup(moderator.user.id);
    await expect(service.approve(moderator, "review", { expectedVersion: 3 })).rejects.toMatchObject({
      status: 403, response: { code: "REVIEW_QA_NOT_INDEPENDENT" },
    });
    expect(tx.expertReview.updateMany).not.toHaveBeenCalled();
  });

  it("denies a proof bound to another session", async () => {
    const { service, tx, assurance } = setup();
    const proof = await assurance.resolve();
    assurance.resolve.mockResolvedValue({ ...proof, sessionId: "foreign-session" });
    await expect(service.approve(moderator, "review", { expectedVersion: 3 })).rejects.toMatchObject({ status: 403 });
    expect(tx.reviewDecision.create).not.toHaveBeenCalled();
  });

  it("hides the review from assured moderators without a current assignment grant", async () => {
    const { service, tx, grantLookup } = setup();
    grantLookup.mockResolvedValue([]);
    await expect(service.read(moderator, "review")).rejects.toMatchObject({ status: 404 });
    await expect(service.approve(moderator, "review", { expectedVersion: 3 })).rejects.toMatchObject({ status: 404 });
    expect(tx.expertReview.findFirst).not.toHaveBeenCalled();
    expect(tx.expertReview.updateMany).not.toHaveBeenCalled();
  });

  it("rechecks grant expiry before writing a decision", async () => {
    const { service, tx, grantLookup } = setup();
    grantLookup.mockResolvedValue([{ expiresAt: now }]);
    await expect(service.returnReview(moderator, "review", { expectedVersion: 3, reason: "Add context." }))
      .rejects.toMatchObject({ status: 404 });
    expect(tx.reviewDecision.create).not.toHaveBeenCalled();
  });

  it("denies approval after source consent withdrawal even if current consent was restored", async () => {
    const { service, consent, tx } = setup();
    consent.requireGenerationInTransaction.mockRejectedValueOnce(new ForbiddenException("Synthetic withdrawal"));
    await expect(service.approve(moderator, "review", { expectedVersion: 3 })).rejects.toMatchObject({ status: 404 });
    expect(tx.expertReview.updateMany).not.toHaveBeenCalled();
  });

  it("sanitizes upstream staff assurance failures", async () => {
    const { service, assurance } = setup();
    assurance.resolve.mockRejectedValueOnce(new ServiceUnavailableException("Synthetic private provider text"));
    await expect(service.read(moderator, "review")).rejects.toMatchObject({
      status: 503, response: { code: "REVIEW_QA_UNAVAILABLE", message: "Staff access could not be confirmed." },
    });
  });

  it("validates the snapshot and completes the source assignment on approval", async () => {
    const { service, tx, review } = setup();
    review.summary = "";
    await expect(service.approve(moderator, "review", { expectedVersion: 3 })).rejects.toMatchObject({ status: 422 });
    expect(tx.expertReview.updateMany).not.toHaveBeenCalled();
    review.summary = "A brief pause while answering.";
    await expect(service.approve(moderator, "review", { expectedVersion: 3 })).resolves.toEqual({
      id: "review", status: "APPROVED", version: 4, decidedAt: now,
    });
    expect(tx.expertAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId: "moderator", subjectId: "review", subjectType: "ExpertReview", action: "EXPERT_REVIEW_APPROVED" } });
  });

  it("captures only canonical claims and takes their time ranges from the approved speech snapshot", async () => {
    const { service, tx, review } = setup();
    review.observations.push({ id: "speech", category: "SPEECH", startMs: 150, endMs: 2000,
      observation: "The member mentioned reading.", context: "Hobbies prompt." });
    await service.approve(moderator, "review", { expectedVersion: 3, claims: [{
      type: "INTEREST_READING", observationId: "speech", context: " Hobbies prompt. ", transcript: " I enjoy reading. ",
    }] });
    expect(tx.reviewClaim.createMany).toHaveBeenCalledWith({ data: [{
      ownerId: "owner", reviewId: "review", reviewVersion: 4, claimType: "INTEREST_READING",
      claimText: "The member said they enjoy reading.", sourceObservationId: "speech", sourceCategory: "SPEECH",
      sourceStartMs: 150, sourceEndMs: 2000, transcript: "I enjoy reading.", context: "Hobbies prompt.",
      qaApproved: true, ownerConfirmed: false, shareApproved: false,
    }] });
  });

  it("rejects foreign or non-speech evidence before any transition", async () => {
    const { service, tx, review } = setup();
    review.observations.push({ id: "gesture", category: "BODY", startMs: 150, endMs: 2000,
      observation: "A gesture.", context: "Hobbies prompt." });
    for (const observationId of ["gesture", "foreign"]) {
      await expect(service.approve(moderator, "review", { expectedVersion: 3, claims: [{
        type: "INTEREST_READING", observationId, context: "Hobbies prompt.",
      }] })).rejects.toMatchObject({ status: 400 });
    }
    expect(tx.expertReview.updateMany).not.toHaveBeenCalled();
    expect(tx.reviewClaim.createMany).not.toHaveBeenCalled();
  });

  it("rejects unsupported, duplicate, or client-authored claims before taking the QA lock", () => {
    const { service, tx } = setup();
    const claim = { type: "INTEREST_READING", observationId: "speech", context: "Hobbies prompt." };
    for (const claims of [[{ ...claim, type: "HONESTY" }], [claim, claim], [{ ...claim, claimText: "Free text." }]]) {
      expect(() => service.approve(moderator, "review", { expectedVersion: 3, claims })).toThrow(expect.objectContaining({ status: 400 }));
    }
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("transitions a dispute separately from the immutable review and audits the action without free text", async () => {
    const { service, tx, dispute } = setup();
    await expect(service.decideDispute(moderator, "dispute", { expectedRevision: 0, status: "RESOLVED", resolution: "Response" }))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.decideDispute(moderator, "dispute", { expectedRevision: 0, status: "IN_REVIEW" }))
      .resolves.toMatchObject({ dispute: { status: "IN_REVIEW", revision: 1, inReviewAt: now } });
    dispute.status = "IN_REVIEW";
    dispute.revision = 1;
    await expect(service.decideDispute(moderator, "dispute", { expectedRevision: 1, status: "RESOLVED", resolution: "Response" }))
      .resolves.toMatchObject({ dispute: { status: "RESOLVED", revision: 2, resolution: "Response", resolvedAt: now } });
    expect(tx.auditLog.create).toHaveBeenLastCalledWith({ data: { actorId: moderator.user.id, subjectType: "ReviewDispute",
      subjectId: "dispute", action: "REVIEW_DISPUTE_RESOLVED" } });
    expect(tx.expertReview.updateMany).not.toHaveBeenCalled();
    expect(tx.reviewClaim.createMany).not.toHaveBeenCalled();
  });

  it("denies dispute access without a current moderator grant", async () => {
    const { service, tx, grantLookup } = setup();
    grantLookup.mockResolvedValueOnce([]);
    await expect(service.readDispute(moderator, "dispute")).rejects.toMatchObject({ status: 404 });
    expect(tx.reviewDispute.findFirst).not.toHaveBeenCalled();
  });

  it("returns only the approved report context for a report-wide dispute", async () => {
    const { service, dispute } = setup();
    const { review, reviewVersion: _version, claim: _claim, ...privateCase } = dispute;
    await expect(service.readDispute(moderator, dispute.id)).resolves.toEqual({
      dispute: privateCase, reviewId: review.id, claim: null,
      report: { version: review.version, summary: review.summary, limitations: review.limitations, approvedAt: now },
    });
  });

  it.each(["stale version", "missing approved content"])("denies reading or deciding a report-wide dispute with %s", async problem => {
    const { service, tx, dispute } = setup();
    if (problem === "stale version") dispute.reviewVersion--;
    else dispute.review.summary = " ";
    dispute.status = "IN_REVIEW";
    dispute.revision = 1;
    await expect(service.readDispute(moderator, dispute.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.decideDispute(moderator, dispute.id, { expectedRevision: 1, status: "RESOLVED", resolution: "Response" }))
      .rejects.toMatchObject({ status: 404 });
    expect(tx.reviewDispute.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
