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
      cancelledAt: null, expiresAt: null, video: { ownerId: "owner", status: "READY", deletedAt: null } };
    const review = { version: 3, status: "SUBMITTED", submittedAt: now, summary: "A recorded observation.",
      limitations: "A single recording.", observations: [] };
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
      auditLog: { create: jest.fn() },
    };
    const prisma = { expertReview: { findUnique: jest.fn(async () => ({ assignmentId: assignment.id, assignment })) } };
    const access = { run: jest.fn(async (_auth, _role, _peers, action) => action(tx, now)) };
    const assurance = { resolve: jest.fn(async () => ({ userId: moderator.user.id, sessionId: moderator.sessionId, level: "MFA",
      verifiedAt: now, expiresAt, testOnly: true })) };
    const consent = { requireInTransaction: jest.fn(async () => ({ subjectId: "opaque-owner" })), requireGenerationInTransaction: jest.fn() };
    const environment = { values: { nodeEnv: "test" } };
    const service = new ReviewQaService(prisma as unknown as PrismaService, access as unknown as SafetyAccessService,
      assurance as unknown as StaffAssuranceSource, environment as EnvironmentService, consent as unknown as ConsentAccessService);
    return { service, tx, assignment, review, assurance, consent, grantLookup };
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
});
