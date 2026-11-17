import { HttpException } from "@nestjs/common";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";
import { parseExpertApproval } from "./expert-approval.validation";

const valid = { expectedRevision: 0, trainingVersion: "synthetic-training-v1", policyVersion: "synthetic-confidentiality-v1",
  trainingEvidenceId: "training-1", confidentialityEvidenceId: "acceptance-1", expiresAt: null };
describe("C032 strict expert approval input", () => {
  it("accepts explicit null expiry and independent expectedRevision", () => {
    expect(parseExpertApproval(valid)).toEqual(valid);
    expect(parseExpertApproval({ ...valid, expiresAt: "2099-01-01T00:00:00.000Z" }).expiresAt).toEqual(new Date("2099-01-01"));
  });
  it.each([undefined, null, [], "approval", { ...valid, expectedRevision: -1 }, { ...valid, expectedRevision: 0.5 },
    { ...valid, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, expiresAt: undefined },
    { ...valid, expiresAt: "2099-02-30T00:00:00.000Z" }, { ...valid, expiresAt: "2099-01-01" },
    { ...valid, trainingVersion: " " }, { ...valid, trainingEvidenceId: "https://public.example/evidence" },
  ])("rejects malformed input %#", input => { expect(() => parseExpertApproval(input)).toThrow(HttpException); });
  it.each(["approvedById", "verifiedAt", "approvedAt", "sha256", "mfaVerified", "role", "trainingEvidence", "userId"])(
    "rejects forged field %s", field => { expect(() => parseExpertApproval({ ...valid, [field]: "forged" })).toThrow(HttpException); });
  it("keeps production qualification registries and evidence sources closed even in test mode", async () => {
    const registry = new ExpertApprovalRegistry();
    expect(registry.training(valid.trainingVersion)).toBeUndefined();
    expect(registry.confidentiality(valid.policyVersion)).toBeUndefined();
    expect(await new ExpertEvidenceSource().find("synthetic-record")).toBeUndefined();
  });
});
