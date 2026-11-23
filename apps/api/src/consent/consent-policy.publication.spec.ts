import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsentPurpose } from "@prisma/client";
import { candidateNotices, candidatePolicyVersion } from "./consent-policy.catalog";
import { ConsentPolicyRegistry, policyDigest } from "./consent.policy";
import { canonicalPolicyPayload, policyApprovalMessage, verifyPolicyPublication, PolicyApprovalPayload } from "./consent-policy.publication";
import { consentFingerprint, parseConsentPatch } from "./consent.validation";

/** Ephemeral synthetic authority for isolated tests. No production key or approval. */
const authority = generateKeyPairSync("ed25519");
const publicKey = authority.publicKey.export({ type: "spki", format: "pem" }).toString();
function payload(): PolicyApprovalPayload {
  const now = Date.now();
  return { schemaVersion: 1, publicationId: "synthetic-approval-fixture", approvedByReference: "synthetic-test-authority", legalBasisReference: "synthetic-test-not-legal-approval", approvedAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(),
    policies: Object.values(ConsentPurpose).flatMap(purpose => (["en", "vi"] as const).map(locale => ({ purpose, locale, policyVersion: candidatePolicyVersion, content: candidateNotices[purpose][locale], digest: policyDigest(candidateNotices[purpose][locale]) }))) };
}
const signed = (p: unknown) => JSON.stringify({ payload: p, signature: sign(null, policyApprovalMessage(p), authority.privateKey).toString("base64url") });

describe("Real consent publication approval boundary", () => {
  afterEach(() => jest.restoreAllMocks());
  it("verifies exact EN/VI snapshots without manufacturing authority or legal approval", () => {
    const verified = verifyPolicyPublication(signed(payload()), publicKey);
    expect(verified.snapshots).toHaveLength(10);
    for (const snapshot of verified.snapshots) {
      expect(snapshot.testOnly).toBe(false);
      expect(snapshot.content).toBe(candidateNotices[snapshot.purpose][snapshot.locale as "en" | "vi"]);
      expect(Object.isFrozen(snapshot)).toBe(true);
    }
    expect(Object.isFrozen(verified.snapshots)).toBe(true);
  });
  it("uses a domain-separated canonical payload, independent of object property order", () => {
    const p = payload();
    const reordered = Object.fromEntries(Object.entries(p).reverse());
    expect(canonicalPolicyPayload(reordered)).toBe(canonicalPolicyPayload(p));
    const envelope = JSON.parse(signed(p)); envelope.payload = reordered;
    expect(verifyPolicyPublication(JSON.stringify(envelope), publicKey).snapshots).toHaveLength(10);
    envelope.signature = sign(null, Buffer.from(canonicalPolicyPayload(p)), authority.privateKey).toString("base64url");
    expect(() => verifyPolicyPublication(JSON.stringify(envelope), publicKey)).toThrow("CONSENT_POLICY_APPROVAL_INVALID");
  });
  it.each([
    ["unknown purpose", (p: any) => { p.policies[0].purpose = "UNSUPPORTED"; }],
    ["draft version", (p: any) => { p.policies[0].policyVersion = "2026.v1-draft"; }],
    ["wrong digest", (p: any) => { p.policies[0].digest = "0".repeat(64); }],
    ["unreviewed wording", (p: any) => { p.policies[0].content += " Changed."; p.policies[0].digest = policyDigest(p.policies[0].content); }],
    ["duplicate locale", (p: any) => { p.policies[1] = p.policies[0]; }],
    ["missing translation", (p: any) => { p.policies.pop(); }],
    ["extra approval field", (p: any) => { p.bypass = true; }],
    ["missing legal reference", (p: any) => { p.legalBasisReference = ""; }],
    ["future approval", (p: any) => { p.approvedAt = new Date(Date.now() + 60000).toISOString(); }],
    ["expired approval", (p: any) => { p.expiresAt = new Date(Date.now() - 1000).toISOString(); }],
    ["excessive lifetime", (p: any) => { p.expiresAt = new Date(Date.now() + 400 * 86400000).toISOString(); }],
  ])("rejects %s even when signed by the configured synthetic test key", (_name, mutate) => {
    const p = payload(); mutate(p); expect(() => verifyPolicyPublication(signed(p), publicKey)).toThrow("CONSENT_POLICY_APPROVAL_INVALID");
  });
  it("rejects tampering, another key, private-key configuration and malformed envelopes", () => {
    const envelope = JSON.parse(signed(payload())); envelope.payload.approvedByReference = "altered";
    expect(() => verifyPolicyPublication(JSON.stringify(envelope), publicKey)).toThrow();
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => verifyPolicyPublication(signed(payload()), other)).toThrow();
    expect(() => verifyPolicyPublication(signed(payload()), authority.privateKey.export({ type: "pkcs8", format: "pem" }).toString())).toThrow();
    expect(() => verifyPolicyPublication("{", publicKey)).toThrow();
    expect(() => verifyPolicyPublication(JSON.stringify({ payload: payload(), signature: "0".repeat(86) }), publicKey)).toThrow();
  });
  it("does not enable a registry through a boolean or draft catalog alone", () => {
    const env = jest.replaceProperty(process, "env", { ...process.env, CONSENT_POLICY_MANIFEST_PATH: undefined, CONSENT_POLICY_APPROVAL_PUBLIC_KEY_PATH: undefined, CONSENT_ENABLED: "true" });
    try { const registry = new ConsentPolicyRegistry(); expect(registry.current("VIDEO_STORAGE")).toBeUndefined(); expect(registry.list("en")).toEqual([]); }
    finally { env.restore(); }
  });
  it("rejects partial configuration without exposing the supplied location", () => {
    const env = jest.replaceProperty(process, "env", { ...process.env, CONSENT_POLICY_MANIFEST_PATH: "C:/private-location/approval.json", CONSENT_POLICY_APPROVAL_PUBLIC_KEY_PATH: undefined });
    try { expect(() => new ConsentPolicyRegistry()).toThrow("CONSENT_POLICY_CONFIGURATION_INVALID"); } finally { env.restore(); }
  });
  it("loads bounded signed files, expires closed, and never reports private file paths in configuration failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "vera-policy-")), manifest = join(directory, "manifest.json"), key = join(directory, "authority.pub");
    const p = payload(); writeFileSync(manifest, signed(p), { mode: 0o600 }); writeFileSync(key, publicKey, { mode: 0o600 });
    const env = jest.replaceProperty(process, "env", { ...process.env, CONSENT_POLICY_MANIFEST_PATH: manifest, CONSENT_POLICY_APPROVAL_PUBLIC_KEY_PATH: key });
    try {
      const registry = new ConsentPolicyRegistry();
      expect(registry.current("VIDEO_STORAGE", "vi")?.content).toBe(candidateNotices.VIDEO_STORAGE.vi);
      expect(registry.list("en")).toHaveLength(5);
      const clock = jest.spyOn(Date, "now").mockReturnValue(Date.parse(p.expiresAt));
      expect(registry.current("VIDEO_STORAGE", "vi")).toBeUndefined();
      clock.mockRestore();
      writeFileSync(manifest, "{}");
      expect(() => new ConsentPolicyRegistry()).toThrow("CONSENT_POLICY_CONFIGURATION_INVALID");
      try { new ConsentPolicyRegistry(); } catch (e) { expect((e as Error).message).not.toContain(directory); }
    } finally { env.restore(); unlinkSync(manifest); unlinkSync(key); rmdirSync(directory); }
  });
  it("preserves historical idempotency fingerprints and binds locale/digest in new grants", () => {
    const previous = { expectedVersion: 0, consents: [{ purpose: "VIDEO_STORAGE" as const, granted: false }] };
    expect(consentFingerprint(parseConsentPatch(previous))).toBe(policyDigest(JSON.stringify({ expectedVersion: 0, consents: [{ purpose: "VIDEO_STORAGE", granted: false, policyVersion: null }] })));
    const grant = { expectedVersion: 0, consents: [{ purpose: "VIDEO_STORAGE", granted: true, policyVersion: candidatePolicyVersion, locale: "en", policyDigest: policyDigest(candidateNotices.VIDEO_STORAGE.en) }] };
    const vi = structuredClone(grant); vi.consents[0].locale = "vi";
    expect(consentFingerprint(parseConsentPatch(grant))).not.toBe(consentFingerprint(parseConsentPatch(vi)));
  });
});
