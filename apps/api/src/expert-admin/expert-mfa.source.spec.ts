import { ExpertMfaSource } from "./expert-mfa.source";
import type { StaffMfaService } from "../staff-security/staff-mfa.service";
import type { AuthContext } from "../auth/auth-context";

const auth = { user: { id: "expert" }, sessionId: "session" } as AuthContext;
const tx = {} as never;
const proof = { userId: "expert", sessionId: "session", level: "MFA", verifiedAt: new Date(), expiresAt: new Date(Date.now() + 30000), testOnly: false };

describe("Expert trusted MFA adapter", () => {
  it("passes the current transaction and auth to genuine staff assurance", async () => {
    const resolve = jest.fn().mockResolvedValue(proof);
    const source = new ExpertMfaSource({ resolve } as unknown as StaffMfaService);
    await expect(source.resolve(auth, tx)).resolves.toEqual({ userId: "expert", sessionId: "session", expiresAt: proof.expiresAt, testOnly: false });
    expect(resolve).toHaveBeenCalledWith(tx, auth);
  });
  it.each([undefined, { ...proof, userId: "other" }, { ...proof, sessionId: "other" }, { ...proof, testOnly: true }, { ...proof, level: "PASSWORD" }])("rejects missing or mismatched proof %j", async value => {
    const source = new ExpertMfaSource({ resolve: jest.fn().mockResolvedValue(value) } as unknown as StaffMfaService);
    await expect(source.resolve(auth, tx)).resolves.toBeUndefined();
  });
  it("does not turn provider errors into successful assurance", async () => {
    const source = new ExpertMfaSource({ resolve: jest.fn().mockRejectedValue(new Error("unavailable")) } as unknown as StaffMfaService);
    await expect(source.resolve(auth, tx)).rejects.toThrow("unavailable");
  });
});
