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
const grant = object({ purpose, granted: { type: "boolean", enum: [true] }, policyVersion: string });
const withdraw = object({ purpose, granted: { type: "boolean", enum: [false] }, policyVersion: string }, ["purpose", "granted"]);

export const ApiReadConsent = () => OwnedOperation({
  summary: "Read my consent settings", role: "MEMBER",
  description: "Returns all five purposes. A purpose without a stored decision defaults to off. A missing ledger has version 0. The read does not initialize a ledger.",
  response, errors: { 400: ["VALIDATION_FAILED"], 503: ["CONSENT_STORE_UNAVAILABLE"] },
});

export const ApiUpdateConsent = () => OwnedOperation({
  summary: "Update my consent settings", role: "MEMBER", origin: "required", idempotent: true,
  description: "Send one to five distinct purposes, all grants or all withdrawals. Each grant needs the current approved policy version. The current policy registry has no approved policies, so grants fail validation. Withdrawals remain available and use separate quota capacity. An identical replay returns the saved snapshot.",
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
