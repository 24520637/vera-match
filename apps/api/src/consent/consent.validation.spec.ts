import { HttpException } from "@nestjs/common";
import { ConsentPolicyRegistry, consentPurposes, policyDigest } from "./consent.policy";
import { consentFingerprint, parseConsentPatch, parseIdempotencyKey } from "./consent.validation";

const off = () => ({ expectedVersion: 0, consents: [{ purpose: "PROFILE_MATCHING", granted: false }] });
describe("C023 consent contract validation", () => {
  it("has exactly five purposes and no runtime policies", () => {
    expect(consentPurposes).toEqual(["PROFILE_MATCHING", "VIDEO_STORAGE", "EXPERT_VIDEO_REVIEW", "REPORT_SHARING", "VIDEO_CLAIM_MATCHING"]);
    for (const purpose of consentPurposes) expect(new ConsentPolicyRegistry().current(purpose)).toBeUndefined();
    expect(policyDigest("synthetic")).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([null, [], {}, { ...off(), expectedVersion: "0" }, { ...off(), expectedVersion: -1 },
    { ...off(), userId: "injected" }, { ...off(), consents: [] },
    { ...off(), consents: [{ purpose: "UNKNOWN", granted: false }] },
    { ...off(), consents: [{ purpose: "PROFILE_MATCHING", granted: "false" }] },
    { ...off(), consents: [{ purpose: "PROFILE_MATCHING", granted: false, policyVersion: null }] },
    { ...off(), consents: [...off().consents, ...off().consents] },
  ])("rejects invalid input without coercion: %j", input => {
    let caught: HttpException | undefined;
    try { parseConsentPatch(input); } catch (error) { caught = error as HttpException; }
    expect(caught?.getStatus()).toBe(400);
  });
  it("rejects mixed grant/revoke batches with a visible whole-form error", () => {
    try { parseConsentPatch({ expectedVersion: 0, consents: [...off().consents, { purpose: "VIDEO_STORAGE", granted: true }] }); }
    catch (error) { expect((error as HttpException).getResponse()).toMatchObject({ details: [{ field: "_form" }] }); return; }
    throw new Error("Expected mixed-batch rejection");
  });
  it("requires bounded random-format keys and hashes rather than storing raw keys", () => {
    expect(parseIdempotencyKey("synthetic_key_123456")).toMatch(/^[a-f0-9]{64}$/);
    for (const key of [undefined, "short", "x".repeat(129), "bad key with spaces", ["a", "b"]]) expect(() => parseIdempotencyKey(key)).toThrow();
  });
  it("fingerprints purpose order canonically but includes policy IDs and expectedVersion", () => {
    const dto = parseConsentPatch({ expectedVersion: 0, consents: [...off().consents, { purpose: "VIDEO_STORAGE", granted: false }] });
    expect(consentFingerprint(dto)).toBe(consentFingerprint({ ...dto, consents: [...dto.consents].reverse() }));
    expect(consentFingerprint(dto)).not.toBe(consentFingerprint({ ...dto, expectedVersion: 1 }));
    expect(consentFingerprint(dto)).not.toBe(consentFingerprint({ ...dto, consents: dto.consents.map(item => ({ ...item, policyVersion: "ignored-for-revoke" })) }));
  });
});
