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

/** No production versions are approved. Test providers are injected only by tests. */
@Injectable()
export class ExpertApprovalRegistry {
  training(_version: string): ApprovedExpertVersion | undefined { return undefined; }
  confidentiality(_version: string): ApprovedExpertVersion | undefined { return undefined; }
}

/** Trusted, immutable, target-bound evidence must come from a server integration.
 * A caller's assertion or digest is never evidence. No production source exists yet.
 */
@Injectable()
export class ExpertEvidenceSource {
  async find(_id: string): Promise<ExpertEvidence | undefined> { return undefined; }
}
