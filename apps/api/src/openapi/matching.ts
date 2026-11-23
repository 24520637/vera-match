import { MatchChoice } from "@prisma/client";
import { array, boolean, enumeration, nullable, object, OwnedOperation, string, timestamp } from "./operation";

const choice = enumeration(...Object.values(MatchChoice));
const handle = { type: "string", minLength: 1, maxLength: 768, pattern: "^[A-Za-z0-9_-]+$" };
const key = { type: "string", pattern: "^[a-f0-9]{64}$" };
const paging = { name: "after", schema: handle,
  description: "Omit for the first page. Pass nextCursor verbatim. The cursor expires after 15 minutes and is bound to the issuing account, session, and endpoint." };
const errors = { 400: ["INVALID_REQUEST"], 503: ["MATCHING_UNAVAILABLE"] };
const deployment = "Production requires a valid MATCHING_HANDLE_KEY.";

export const ApiRecommendations = () => OwnedOperation({
  summary: "List reciprocal recommendations", role: "MEMBER", query: [paging],
  description: "Returns up to 16 currently eligible, unblocked recommendations that the caller has not decided on. Both members need current matching consent and must meet reciprocal eligibility checks. An ineligible caller gets available=false and an empty page. A page can be empty and still supply a continuation cursor. Reasons can contain currently shareable canonical statements. " + deployment,
  response: {
    ...object({ available: boolean, recommendations: array(object({ key, pairId: handle, reasons: array(string) }), 16), nextCursor: nullable(handle) }),
    example: { available: false, recommendations: [], nextCursor: null },
  },
  errors,
});

export const ApiMatchingHistory = () => OwnedOperation({
  summary: "List my matching decisions", role: "MEMBER", query: [paging],
  description: "Returns only the caller’s recorded decisions, up to 20 per page in descending decision time. History stays readable after matching consent withdrawal. An unavailable pair has available=false and mutual=false. " + deployment,
  response: {
    ...object({ decisions: array(object({ id: key, choice, createdAt: timestamp, available: boolean, mutual: boolean }), 20), nextCursor: nullable(handle) }),
    example: { decisions: [], nextCursor: null },
  },
  errors,
});

export const ApiMatchingDecision = () => OwnedOperation({
  summary: "Record a reciprocal matching decision", role: "MEMBER", origin: "required", rejectCrossSite: true,
  description: "Use a recommendation reference issued to this account and session within the last 15 minutes. The server rechecks both members’ current eligibility and blocks. Repeating the same choice is idempotent while the reference and pair remain valid. Mutual indicates both members accepted. " + deployment,
  path: { name: "pairId", schema: handle, description: "Temporary reference from recommendations." },
  body: { ...object({ choice }), example: { choice: MatchChoice.ACCEPT } },
  response: { ...object({ choice, mutual: boolean }), example: { choice: MatchChoice.ACCEPT, mutual: false } },
  errors: { ...errors, 404: ["MATCH_UNAVAILABLE"], 409: ["MATCH_DECISION_CONFLICT"] },
});
