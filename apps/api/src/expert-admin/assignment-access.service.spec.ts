import { AssignmentAccessService } from "./assignment-access.service";
import { ExpertMfaSource } from "./expert-mfa.source";
import { PrismaService } from "../database/prisma.service";
import { ConsentAccessService } from "../consent/consent-access.service";
import { EnvironmentService } from "../config/environment.service";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";
import { AuthContext } from "../auth/auth-context";

describe("C034 fail-closed boundary", () => {
  const tx = jest.fn();
  const service = (nodeEnv: string) => new AssignmentAccessService({ $transaction: tx } as unknown as PrismaService,
    {} as ConsentAccessService, { values: { nodeEnv } } as EnvironmentService,
    new ExpertApprovalRegistry(), new ExpertEvidenceSource(), new ExpertMfaSource());
  beforeEach(() => tx.mockReset());
  test.each(["ADMIN", "MODERATOR", "MEMBER"] as const)("rejects %s before database access", async role => {
    await expect(service("test").withAuthorizedAssignment({ user: { role } } as AuthContext, "id", jest.fn())).rejects.toMatchObject({ status: 403 });
    expect(tx).not.toHaveBeenCalled();
  });
  test.each(["production", "development"])("%s denies access when session-bound MFA is missing", async env => {
    const transaction = {
      expertAssignment: { findUnique: async () => ({ expertId: "expert", video: { ownerId: "owner" } }) },
      $queryRaw: jest.fn(),
      session: { findUnique: async () => ({ id: "session", userId: "expert", revokedAt: null }) },
      user: { findUnique: async () => ({ id: "expert", role: "EXPERT", status: "ACTIVE", emailVerifiedAt: new Date() }) },
      video: { findUnique: jest.fn() },
    };
    tx.mockImplementation(callback => callback(transaction));
    await expect(service(env).withAuthorizedAssignment({
      user: { id: "expert", role: "EXPERT" }, sessionId: "session",
    } as AuthContext, "id", jest.fn())).rejects.toMatchObject({ status: 403 });
    expect(transaction.video.findUnique).not.toHaveBeenCalled();
  });
  test("default MFA provider never asserts assurance", async () => {
    await expect(new ExpertMfaSource().resolve({} as never, {} as never)).resolves.toBeUndefined();
  });
  test.each(["", "bad!", "with space", "with/slash", "with\u0000null", "a".repeat(201)])("rejects malformed ID %j before database access", async id => {
    await expect(service("test").withAuthorizedAssignment({ user: { role: "EXPERT" } } as AuthContext, id, jest.fn())).rejects.toMatchObject({
      status: 400, response: { code: "VALIDATION_FAILED", details: [{ field: "assignmentId", messages: ["Send a valid identifier."] }] },
    });
    expect(tx).not.toHaveBeenCalled();
  });
});
