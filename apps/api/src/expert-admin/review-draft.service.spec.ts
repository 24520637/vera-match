import type { AuthContext } from "../auth/auth-context";
import type { PrismaService } from "../database/prisma.service";
import type { AssignmentAccessService } from "./assignment-access.service";
import { ReviewDraftService } from "./review-draft.service";

describe("C056 review submission", () => {
  const auth: AuthContext = { sessionId: "session", user: { id: "expert", role: "EXPERT", email: "expert@example.invalid", displayName: null } };
  const time = new Date("2026-01-01T00:00:00.000Z");

  function setup() {
    const review = { status: "DRAFT", version: 2, summary: "Observations from one recording.",
      limitations: "A single prompted session.", submittedAt: null as Date | null, observations: [] };
    const assignment = { id: "assignment", status: "ASSIGNED", revision: 0n };
    const tx = {
      expertReview: {
        findFirst: jest.fn(async () => ({ ...review })),
        updateMany: jest.fn(async () => {
          Object.assign(review, { status: "SUBMITTED", version: 3, submittedAt: time });
          return { count: 1 };
        }),
      },
      expertAssignment: {
        updateMany: jest.fn(async ({ data }: { data: { status: string } }) => {
          Object.assign(assignment, { status: data.status, revision: assignment.revision + 1n });
          return { count: 1 };
        }),
      },
      expertActorIdentity: { upsert: jest.fn(async () => ({ subjectId: "opaque-actor" })) },
      auditLog: { create: jest.fn() },
      $executeRaw: jest.fn(),
    };
    const access = {
      requireRuntimeExpert: jest.fn(),
      withAuthorizedAssignment: jest.fn(async (_auth, _id, run) => run(tx, {
        assignment, video: { durationMs: 1000 }, validateTime: async () => ({ now: time }),
      })),
    };
    const prisma = { expertReview: { findFirst: jest.fn(async () => ({ assignmentId: assignment.id })) } };
    const service = new ReviewDraftService(prisma as unknown as PrismaService, access as unknown as AssignmentAccessService);
    return { service, review, tx, access };
  }

  it("validates saved text before making any writes", async () => {
    const { service, review, tx } = setup();
    review.limitations = " ";
    await expect(service.submit(auth, "review", { expectedVersion: 2 })).rejects.toMatchObject({ status: 422 });
    expect(tx.expertReview.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("freezes exactly one version and returns an identical retry receipt", async () => {
    const { service, tx, access } = setup();
    const result = await service.submit(auth, "review", { expectedVersion: 2 });
    expect(result).toEqual({ id: "review", status: "SUBMITTED", version: 3, submittedAt: time });
    await expect(service.submit(auth, "review", { expectedVersion: 2 })).resolves.toEqual(result);
    expect(access.withAuthorizedAssignment).toHaveBeenCalledTimes(2);
    expect(tx.expertReview.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.expertAssignment.updateMany.mock.calls.map(([operation]) => operation.data.status)).toEqual(["IN_PROGRESS", "SUBMITTED"]);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    await expect(service.save(auth, "review", { expectedVersion: 3, summary: "Overwritten" })).rejects.toMatchObject({ status: 409 });
    await expect(service.submit(auth, "review", { expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
  });
});
