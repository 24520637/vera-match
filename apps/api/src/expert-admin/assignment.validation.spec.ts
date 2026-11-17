import { assignmentFingerprint, parseAssignment } from "./assignment.validation";
const valid = { videoId: "video-id", expertId: "expert-id", expectedCredentialRevision: 1, dueAt: null, expiresAt: null };
describe("C033 assignment request", () => {
  it("requires explicit null dates and has a stable canonical fingerprint", () => {
    expect(parseAssignment(valid)).toEqual(valid);
    expect(assignmentFingerprint(parseAssignment(valid))).toBe(assignmentFingerprint(parseAssignment({ expiresAt: null,
      dueAt: null, expectedCredentialRevision: 1, expertId: "expert-id", videoId: "video-id" })));
    expect(assignmentFingerprint(parseAssignment(valid))).not.toBe(assignmentFingerprint(parseAssignment({ ...valid, expertId: "other" })));
  });
  it.each([null, [], "assignment", { ...valid, videoId: "" }, { ...valid, expertId: "https://private.invalid" },
    { ...valid, expectedCredentialRevision: -1 }, { ...valid, expectedCredentialRevision: 0.1 },
    { ...valid, expectedCredentialRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, dueAt: undefined },
    { ...valid, expiresAt: "2099-01-01" }, { ...valid, dueAt: "2099-02-30T00:00:00.000Z" },
    { ...valid, dueAt: "2099-01-01T00:00:00.000Z", expiresAt: "2098-01-01T00:00:00.000Z" },
    ...["assignedById", "credentialApprovalId", "revision", "status", "createdAt", "reviewConsentVersion", "mfaVerified"].map(field => ({ ...valid, [field]: "forged" })),
  ])("rejects malformed or forged request %#", input => { expect(() => parseAssignment(input)).toThrow(); });
});
