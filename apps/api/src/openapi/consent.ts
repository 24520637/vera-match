import { ConsentPurpose } from "@prisma/client";
import { array, boolean, enumeration, fieldError, nullable, object, OwnedOperation, revision, string, timestamp } from "./operation";

const purposes = Object.values(ConsentPurpose);
const purpose = enumeration(...purposes);
const response = object({
  version: revision,
  consents: { ...array(object({
    purpose, granted: boolean, grantedAt: nullable(timestamp), revokedAt: nullable(timestamp),
    policyVersion: nullable(string), updatedAt: nullable(timestamp),
  }), purposes.length), minItems: purposes.length },
});
const grant = object({ purpose, granted: { type: "boolean", enum: [true] }, policyVersion: string, locale: enumeration("en", "vi"), policyDigest: { type: "string", pattern: "^[a-f0-9]{64}$" } });
const withdraw = object({
  purpose, granted: { type: "boolean", enum: [false] }, policyVersion: string, locale: string, policyDigest: string,
}, ["purpose", "granted"]);

export const ApiReadConsent = () => OwnedOperation({
  summary: "Read my consent settings", role: "MEMBER",
  description: "Returns all five purposes. A purpose without a stored decision defaults to off. A missing ledger has version 0. The read does not initialize a ledger.",
  response, errors: { 400: ["VALIDATION_FAILED"], 503: ["CONSENT_STORE_UNAVAILABLE"] },
});

export const ApiUpdateConsent = () => OwnedOperation({
  summary: "Update my consent settings", role: "MEMBER", origin: "required", idempotent: true,
  description: "Send one to five distinct purposes, all grants or all withdrawals. Each real grant needs the current signed approved policy version, displayed locale and exact UTF-8 SHA-256 policyDigest returned by GET /api/consents/policies. Without an installed, valid approval manifest, grants fail validation. No draft or testOnly fixture is a production publication. Withdrawals remain available and use separate quota capacity. For withdrawals, policyVersion, locale and policyDigest are optional strings and are not checked against a publication. An identical replay returns the saved snapshot.",
  body: {
    oneOf: [
      object({ expectedVersion: revision, consents: { ...array(grant, purposes.length), minItems: 1 } }),
      object({ expectedVersion: revision, consents: { ...array(withdraw, purposes.length), minItems: 1 } }),
    ],
    example: { expectedVersion: 0, consents: [{ purpose: ConsentPurpose.VIDEO_STORAGE, granted: false }] },
  },
  response,
  errors: {
    400: ["VALIDATION_FAILED"],
    409: [fieldError("VERSION_CONFLICT"), fieldError("IDEMPOTENCY_KEY_REUSED")],
    503: ["CONSENT_STORE_UNAVAILABLE", "POLICY_EVIDENCE_UNAVAILABLE", "CONSENT_VERSION_EXHAUSTED"],
  },
});

export const ApiReadConsentPolicies = () => OwnedOperation({
  summary: "Read approved consent notices in the selected language", role: "MEMBER",
  description: "Returns exact currently approved signed snapshots only. No configured publication returns an empty list; this does not grant consent. Candidate drafts, signatures and private approval metadata are never returned. Default language is en. Expired approval disables grants and new feature authorization; withdrawal remains available.",
  query: [{ name: "locale", schema: enumeration("en", "vi"), description: "Choose the exact notice language displayed before an explicit grant." }],
  response: object({ locale: enumeration("en", "vi"), policies: array(object({ purpose, policyVersion: string, locale: enumeration("en", "vi"), content: string, digest: { type: "string", pattern: "^[a-f0-9]{64}$" }, optional: { type: "boolean", enum: [true] }, dependencies: array(purpose) }), 5) }),
  errors: { 400: ["VALIDATION_FAILED"] },
});
