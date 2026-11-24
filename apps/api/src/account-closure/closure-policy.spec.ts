import { generateKeyPairSync, sign } from "node:crypto";
import { closurePolicyMessage, ClosureMinimizationPolicy, minimizationActions, verifyClosurePolicy } from "./closure-policy";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const now = new Date("2026-11-24T00:00:00.000Z");
const payload: ClosureMinimizationPolicy = { schemaVersion: 1, purpose: "CLOSURE_MINIMIZATION", version: "synthetic-v1",
  approvedByReference: "synthetic-owner", legalBasisReference: "synthetic-approval", approvedAt: "2026-11-23T00:00:00.000Z",
  expiresAt: "2026-12-23T00:00:00.000Z", actions: minimizationActions,
  retainedEvidence: "RESTRICTED_PENDING_APPROVED_RETENTION", finalErasureClaim: false };
const envelope = (value = payload) => JSON.stringify({ payload: value, signature: sign(null, closurePolicyMessage(value), keys.privateKey).toString("base64url") });
it("requires a genuine exact-content Ed25519 approval", () => {
  expect(verifyClosurePolicy(envelope(), publicKey, now).payload.version).toBe("synthetic-v1");
  expect(() => verifyClosurePolicy(envelope().replace("synthetic-owner", "forged-owner"), publicKey, now)).toThrow();
  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  expect(() => verifyClosurePolicy(envelope(), other, now)).toThrow();
});
it("rejects unsigned, expired, future, draft and final-erasure approvals", () => {
  expect(() => verifyClosurePolicy(JSON.stringify({ payload, signature: null }), publicKey, now)).toThrow();
  for (const patch of [{ expiresAt: "2026-11-24T00:00:00.000Z" }, { approvedAt: "2026-11-25T00:00:00.000Z" },
    { approvedByReference: "REVIEW_REQUIRED" }, { version: "v1-draft" }, { finalErasureClaim: true }, { unexpected: true }])
    expect(() => verifyClosurePolicy(envelope({ ...payload, ...patch } as ClosureMinimizationPolicy), publicKey, now)).toThrow();
});
