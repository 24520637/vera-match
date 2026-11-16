import { Injectable } from "@nestjs/common";
import { ConsentPurpose } from "@prisma/client";
import { createHash } from "node:crypto";

export const consentPurposes = Object.values(ConsentPurpose);
export interface PolicySnapshot {
  purpose: ConsentPurpose;
  policyVersion: string;
  locale: string;
  content: string;
  testOnly: boolean;
}
export const policyDigest = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

/** No real policy is approved/configured. No environment flag can enable grants.
 * Synthetic implementations exist only in test fixtures, never in this provider.
 */
@Injectable()
export class ConsentPolicyRegistry {
  current(_purpose: ConsentPurpose): PolicySnapshot | undefined { return undefined; }
}
