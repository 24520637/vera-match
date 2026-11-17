import { ServiceUnavailableException } from "@nestjs/common";
import { ExpertCredentialApproval, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ExpertApprovalRegistry, ExpertEvidenceSource } from "./expert-approval.sources";

export function assignmentUnavailable(): never {
  throw new ServiceUnavailableException({ code: "ASSIGNMENT_UNAVAILABLE", message: "Assignment could not be confirmed. Review the original request before retrying." });
}
/** Verify the actual recoverable C032 evidence against trusted server sources.
 * Missing/legacy/malformed provenance is never silently repaired or accepted.
 */
export async function assignmentEvidence(approval: ExpertCredentialApproval, expertId: string,
  registry: ExpertApprovalRegistry, source: ExpertEvidenceSource) {
  const limits: Date[] = [];
  if (approval.verifiedAt > approval.approvedAt) assignmentUnavailable();
  if (approval.expiresAt) limits.push(approval.expiresAt);
  for (const [stored, kind, version, approved] of [
    [approval.trainingEvidence, "TRAINING_COMPLETION", approval.trainingVersion, registry.training(approval.trainingVersion)],
    [approval.confidentialityEvidence, "CONFIDENTIALITY_ACCEPTANCE", approval.policyVersion, registry.confidentiality(approval.policyVersion)],
  ] as const) {
    if (!approved || approved.version !== version || !approved.content.trim()) assignmentUnavailable();
    const snapshot = stored as Prisma.JsonObject;
    if (snapshot?.kind !== "SNAPSHOT" || typeof snapshot.content !== "string" ||
      snapshot.sha256 !== createHash("sha256").update(snapshot.content, "utf8").digest("hex")) assignmentUnavailable();
    let content: Record<string, unknown>;
    try { content = JSON.parse(snapshot.content); } catch { assignmentUnavailable(); }
    if (!content || typeof content !== "object" || typeof content.sourceId !== "string") assignmentUnavailable();
    const record = await source.find(content.sourceId);
    if (!record || record.id !== content.sourceId || record.userId !== expertId || record.kind !== kind || record.version !== version ||
      !record.content.trim() || !(record.recordedAt instanceof Date) || !Number.isFinite(record.recordedAt.getTime()) || record.recordedAt > approval.verifiedAt ||
      content.subject !== approval.subjectId || content.kind !== kind || content.version !== version || content.content !== record.content ||
      content.recordedAt !== record.recordedAt.toISOString() || content.approvedContent !== approved.content) assignmentUnavailable();
    if (record.validUntil !== null) {
      if (!(record.validUntil instanceof Date) || !Number.isFinite(record.validUntil.getTime()) ||
        record.validUntil <= record.recordedAt) assignmentUnavailable();
      limits.push(new Date(record.validUntil));
    }
    if (content.validUntil !== (record.validUntil?.toISOString() ?? null)) assignmentUnavailable();
  }
  return limits;
}

/** Pure time check: call only with a fresh database clock after all source I/O
 * and lock waits. Never repeat source I/O after the final authorization clock.
 */
export function requireCurrentAssignmentEvidence(approval: ExpertCredentialApproval, limits: readonly Date[], now: Date) {
  if (approval.approvedAt > now || limits.some(limit => limit <= now)) assignmentUnavailable();
}
