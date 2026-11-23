import { Injectable } from "@nestjs/common";
import { ConsentPurpose } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { verifyPolicyPublication, PolicyLocale } from "./consent-policy.publication";

export const consentPurposes = Object.values(ConsentPurpose);
export interface PolicySnapshot {
  purpose: ConsentPurpose;
  policyVersion: string;
  locale: string;
  content: string;
  testOnly: boolean;
}
export const policyDigest = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

/** An operator-installed, signed approval is required. Neither an environment
 * boolean nor a draft catalog enables grants. Publication changes require a
 * reviewed, single-process restart; do not hot-edit a running release. */
@Injectable()
export class ConsentPolicyRegistry {
  private readonly snapshots: readonly PolicySnapshot[];
  private readonly expiresAt: number;
  constructor() {
    const manifest = process.env.CONSENT_POLICY_MANIFEST_PATH;
    const publicKey = process.env.CONSENT_POLICY_APPROVAL_PUBLIC_KEY_PATH;
    if (!manifest && !publicKey) { this.snapshots = []; this.expiresAt = 0; return; }
    try {
      if (!manifest || !publicKey || !isAbsolute(manifest) || !isAbsolute(publicKey)) throw new Error();
      const policyFile = statSync(manifest), keyFile = statSync(publicKey);
      if (!policyFile.isFile() || !keyFile.isFile() || policyFile.size > 262144 || keyFile.size > 16384) throw new Error();
      const verified = verifyPolicyPublication(readFileSync(manifest, "utf8"), readFileSync(publicKey, "utf8"));
      this.snapshots = verified.snapshots; this.expiresAt = verified.expiresAt;
    } catch { throw new Error("CONSENT_POLICY_CONFIGURATION_INVALID: check the approved manifest and trusted Ed25519 public-key files"); }
  }
  current(purpose: ConsentPurpose, locale: string = "en"): PolicySnapshot | undefined {
    if (Date.now() >= this.expiresAt) return undefined;
    return this.snapshots.find(p => p.purpose === purpose && p.locale === locale);
  }
  list(locale: PolicyLocale): PolicySnapshot[] {
    return consentPurposes.flatMap(purpose => { const snapshot = this.current(purpose, locale); return snapshot ? [snapshot] : []; });
  }
}
