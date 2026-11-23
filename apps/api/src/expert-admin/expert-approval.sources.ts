import { currentQualification } from "./expert-qualification.publication";
import { Injectable } from "@nestjs/common";

export interface ApprovedExpertVersion {
  version: string;
  content: string;
}
export interface ExpertEvidence {
  id: string;
  userId: string;
  version: string;
  kind: "TRAINING_COMPLETION" | "CONFIDENTIALITY_ACCEPTANCE";
  content: string;
  recordedAt: Date;
  validUntil: Date | null;
}

/** Versions require an operator-installed, independently signed qualification publication. */
@Injectable()
export class ExpertApprovalRegistry {
  training(version: string): ApprovedExpertVersion | undefined { return currentQualification()?.versions.find(v => v.kind === "TRAINING_COMPLETION" && v.version === version); }
  confidentiality(version: string): ApprovedExpertVersion | undefined { return currentQualification()?.versions.find(v => v.kind === "CONFIDENTIALITY_ACCEPTANCE" && v.version === version); }
}

/** Trusted, immutable, target-bound evidence must come from a server integration.
 * A caller's assertion or digest is never evidence. Missing publication denies.
 */
@Injectable()
export class ExpertEvidenceSource {
  async find(id: string): Promise<ExpertEvidence | undefined> {
    const publication = currentQualification();
    const e = publication?.evidence.find(e => e.id === id);
    if (!e || Date.parse(e.validUntil) <= Date.now()) return undefined;
    return { ...e, recordedAt: new Date(e.recordedAt), validUntil: new Date(e.validUntil) };
  }
}
