import { DisputeStatus, ObservationCategory } from "@prisma/client";
import { factualStatements } from "../expert-admin/review-claim.validation";
import { assignedExpert } from "./assignments";
import { array, boolean, empty, enumeration, id, nullable, object, OwnedOperation, string, timestamp } from "./operation";

const reviewVersion = { type: "integer", minimum: 1, maximum: 2147483647 };
const claimRevision = { type: "integer", minimum: 0, maximum: 2147483646 };
const timecode = { type: "integer", minimum: 0, maximum: 2147483647 };
const durationMs = nullable({ ...timecode, minimum: 1 });
const path = (description: string) => ({ name: "id", schema: id, description });
const query = [{ name: "after", schema: id, description: "Omit for the first page. Pass nextCursor verbatim for the next page." }];
const reviewBody = { origin: "required", rejectCrossSite: true } as const;
const reviewRead = { rejectCrossSite: true } as const;
const requiredText = { type: "string", pattern: "^(?=[\\s\\S]*\\S)[^\\u0000]+$" };
const privateText = (limit: number) => ({
  ...requiredText,
  description: "After trimming, 1 to " + limit.toLocaleString("en-US") + " UTF-16 code units.",
});
const draftText = nullable({ type: "string", pattern: "^[^\\u0000]*$" });
const observationFields = {
  category: enumeration(...Object.values(ObservationCategory)), startMs: timecode,
  endMs: { ...timecode, description: "Must be at least startMs and at most the server-verified video duration." },
  observation: requiredText, context: requiredText,
};
const observation = object(observationFields);
const savedObservation = object({ id, ...observationFields, context: nullable(string) });
const sampleObservation = { category: ObservationCategory.SPEECH, startMs: 1000, endMs: 2000,
  observation: "The speaker mentioned reading.", context: "They were describing a weekend activity." };

const draftFields = {
  id, version: reviewVersion, summary: nullable(string), limitations: nullable(string),
  observations: array(savedObservation), feedback: nullable(string),
};
const draft = object(draftFields, ["id", "version", "summary", "limitations", "observations"]);
const draftResponse = {
  ...object({ draft, durationMs }),
  example: { draft: { id: "review-1", version: 1, summary: null, limitations: null, observations: [] }, durationMs: null },
};
const receiptFields = { id, version: reviewVersion, submittedAt: timestamp };
const expertErrors = {
  400: ["INVALID_REQUEST", "VALIDATION_FAILED"],
  403: ["ASSIGNMENT_ACCESS_DENIED", "CONSENT_REQUIRED", "CONSENT_GENERATION_WITHDRAWN"],
  404: ["ASSIGNMENT_NOT_FOUND", "REVIEW_NOT_FOUND"],
  503: ["EXPERT_ACCESS_UNAVAILABLE", "ASSIGNMENT_UNAVAILABLE"],
};
const editErrors = {
  ...expertErrors, 409: ["REVIEW_VERSION_CONFLICT", "REVIEW_STATE_CONFLICT"], 422: ["INVALID_OBSERVATION_TIMECODE"],
  503: [...expertErrors[503], "REVIEW_UNAVAILABLE", "REVIEW_DURATION_UNAVAILABLE"],
};

export const ApiReadDraft = () => OwnedOperation({
  ...reviewRead, summary: "Read an assignment’s review workspace", role: "EXPERT",
  description: assignedExpert + " Returns an editable draft, null before initialization, or a receipt for a locked submission. Editable workspaces include nullable server-measured duration; locked workspaces return null for duration.",
  path: path("Assignment identifier."),
  response: {
    oneOf: [
      object({ draft: nullable(draft), durationMs }),
      object({ draft: { type: "object", nullable: true, enum: [null] },
        submission: object({ ...receiptFields, status: enumeration("SUBMITTED", "APPROVED") }),
        durationMs: { type: "integer", nullable: true, enum: [null] } }),
    ],
    example: { draft: null, durationMs: null },
  },
  errors: expertErrors,
});

export const ApiInitializeDraft = () => OwnedOperation({
  ...reviewBody, summary: "Initialize an assignment’s review draft", role: "EXPERT",
  description: assignedExpert + " Send an empty JSON object. Creates version 1 or returns the existing editable draft. A locked submission returns a conflict.",
  path: path("Assignment identifier."), body: empty, response: draftResponse,
  errors: { ...expertErrors, 409: ["REVIEW_STATE_CONFLICT"] },
});

export const ApiUpdateDraft = () => OwnedOperation({
  ...reviewBody, summary: "Save a versioned review draft", role: "EXPERT",
  description: assignedExpert + " Provide at least one change. Omitting observations keeps them, while an empty list clears them. A nonempty list replaces all observations and requires a verified video duration. Null clears summary or limitations.",
  path: path("Review identifier."), response: draftResponse,
  body: {
    ...object({ expectedVersion: reviewVersion, summary: draftText, limitations: draftText, observations: array(observation) }, ["expectedVersion"]),
    minProperties: 2, example: { expectedVersion: 1, summary: "The member described a hobby.", observations: [] },
  },
  errors: editErrors,
});

export const ApiAppendObservation = () => OwnedOperation({
  ...reviewBody, summary: "Append a review observation", role: "EXPERT",
  description: assignedExpert + " Appends one observation to the current editable draft. Times are whole milliseconds within the verified duration. The response contains the updated draft and version.",
  path: path("Review identifier."), response: draftResponse,
  body: { ...object({ expectedVersion: reviewVersion, observation }), example: { expectedVersion: 1, observation: sampleObservation } },
  errors: editErrors,
});

export const ApiSubmitReview = () => OwnedOperation({
  ...reviewBody, summary: "Submit a review for independent QA", role: "EXPERT",
  description: assignedExpert + " The current draft must already contain a nonblank summary and limitations, and any observations must be within the verified duration. Returns a submission receipt. A retry with the prior version returns the same receipt while the review remains submitted.",
  path: path("Review identifier."),
  body: { ...object({ expectedVersion: reviewVersion }), example: { expectedVersion: 2 } },
  response: object({ ...receiptFields, status: enumeration("SUBMITTED") }),
  errors: { ...editErrors, 409: [...editErrors[409], "RESOURCE_REVISION_CONFLICT"], 422: [...editErrors[422], "REVIEW_INCOMPLETE"] },
});

const qaPolicy = "Requires trusted session-bound staff MFA, an active assignment-specific grant, and independence from the assigned expert and the video owner. Production staff MFA and trusted grant provisioning are pending.";
const qaQueueErrors = {
  400: ["VALIDATION_FAILED"], 403: ["STAFF_ASSURANCE_REQUIRED"],
  503: ["SAFETY_STORE_UNAVAILABLE", "REVIEW_QA_UNAVAILABLE"],
};
const qaErrors = {
  ...qaQueueErrors, 400: ["INVALID_REQUEST", "VALIDATION_FAILED"],
  403: [...qaQueueErrors[403], "REVIEW_QA_NOT_INDEPENDENT"], 404: ["REVIEW_NOT_FOUND"],
};
const qaDecisionErrors = { ...qaErrors, 409: ["REVIEW_VERSION_CONFLICT", "REVIEW_STATE_CONFLICT", "RESOURCE_REVISION_CONFLICT"] };
const decisionReceipt = (status: string) => object({ id, status: enumeration(status), version: reviewVersion, decidedAt: timestamp });
const claimType = enumeration(...Object.keys(factualStatements));

export const ApiSubmittedReviews = () => OwnedOperation({
  ...reviewRead, summary: "List submitted reviews in my QA scope", role: "MODERATOR",
  description: qaPolicy + " Returns up to ten submitted receipts within the current scope.",
  query, response: { ...object({ reviews: array(object(receiptFields), 10), nextCursor: nullable(id) }),
    example: { reviews: [], nextCursor: null } },
  errors: qaQueueErrors,
});

export const ApiReadSubmittedReview = () => OwnedOperation({
  ...reviewRead, summary: "Read a submitted review for QA", role: "MODERATOR",
  description: qaPolicy + " Returns the submitted draft, observation identifiers, and the supported factual claim catalog.",
  path: path("Review identifier."),
  response: object({
    review: object({ ...receiptFields, summary: nullable(string), limitations: nullable(string), observations: array(savedObservation) }),
    claimTypes: array(object({ type: claimType, statement: string }), Object.keys(factualStatements).length),
  }),
  errors: qaErrors,
});

export const ApiReturnReview = () => OwnedOperation({
  ...reviewBody, summary: "Return a submitted review for changes", role: "MODERATOR",
  description: qaPolicy + " Records a versioned decision and sends actionable feedback back to the assigned expert.",
  path: path("Review identifier."),
  body: { ...object({ expectedVersion: reviewVersion, reason: privateText(2000) }),
    example: { expectedVersion: 3, reason: "Explain the limits of this observation." } },
  response: decisionReceipt("RETURNED"), errors: qaDecisionErrors,
});

export const ApiApproveReview = () => OwnedOperation({
  ...reviewBody, summary: "Approve a submitted review", role: "MODERATOR",
  description: qaPolicy + " Approves the current submitted version. Optional claims must use distinct catalog types and reference speech observations from that submission. Claims start unconfirmed and unshared.",
  path: path("Review identifier."),
  body: {
    ...object({ expectedVersion: reviewVersion, claims: array(object({
      type: claimType, observationId: id, context: privateText(1000), transcript: privateText(2000),
    }, ["type", "observationId", "context"]), Object.keys(factualStatements).length) }, ["expectedVersion"]),
    example: { expectedVersion: 3, claims: [{ type: "INTEREST_READING", observationId: "observation-1",
      context: "The member was describing a weekend activity." }] },
  },
  response: decisionReceipt("APPROVED"),
  errors: { ...qaDecisionErrors, 422: ["REVIEW_INCOMPLETE", "INVALID_OBSERVATION_TIMECODE"],
    503: [...qaDecisionErrors[503], "REVIEW_DURATION_UNAVAILABLE"] },
});

const dispute = object({
  id, claimId: nullable(id), reason: string, status: enumeration(...Object.values(DisputeStatus)),
  resolution: nullable(string), revision: { type: "integer", minimum: 0, maximum: 2 },
  createdAt: timestamp, inReviewAt: nullable(timestamp), resolvedAt: nullable(timestamp),
});
const evidence = object({ startMs: timecode, endMs: timecode, transcript: nullable(string), context: string });
const claim = {
  id, type: claimType, statement: string, evidence, ownerConfirmed: boolean, shareApproved: boolean,
  revokedAt: nullable(timestamp), revision: { type: "integer", minimum: 0, maximum: 2147483647 },
};
const feedbackTarget = enumeration("TRANSCRIPT", "CONTEXT");
const feedback = object({ target: feedbackTarget, note: string, revision: { type: "integer", minimum: 1 }, updatedAt: timestamp });
const disputeResponse = object({ dispute });

export const ApiListQaDisputes = () => OwnedOperation({
  ...reviewRead, summary: "List open disputes in my QA scope", role: "MODERATOR",
  description: qaPolicy + " Returns up to ten OPEN or IN_REVIEW cases linked to current approved sources.",
  query, response: object({ disputes: array(object({
    id, reviewId: id, status: enumeration("OPEN", "IN_REVIEW"), createdAt: timestamp,
  }), 10), nextCursor: nullable(id) }),
  errors: qaQueueErrors,
});

export const ApiReadQaDispute = () => OwnedOperation({
  ...reviewRead, summary: "Read a private dispute for QA", role: "MODERATOR",
  description: qaPolicy + " Returns the dispute and either its approved report context or its linked claim evidence. The other context field is null.",
  path: path("Dispute identifier."),
  response: object({ dispute, reviewId: id,
    report: nullable(object({ version: reviewVersion, summary: string, limitations: string, approvedAt: timestamp })),
    claim: nullable(object({ statement: string, evidence })),
  }),
  errors: qaErrors,
});

const disputeRevision = { type: "integer", enum: [0, 1] };
export const ApiDecideQaDispute = () => OwnedOperation({
  ...reviewBody, summary: "Advance or close a QA dispute", role: "MODERATOR",
  description: qaPolicy + " Move OPEN to IN_REVIEW without a resolution. Move IN_REVIEW to RESOLVED or REJECTED with a private resolution. Send the current revision.",
  path: path("Dispute identifier."),
  body: {
    oneOf: [
      object({ expectedRevision: disputeRevision, status: enumeration("IN_REVIEW") }),
      object({ expectedRevision: disputeRevision, status: enumeration("RESOLVED", "REJECTED"), resolution: privateText(2000) }),
    ],
    example: { expectedRevision: 1, status: "RESOLVED", resolution: "The case has been reviewed." },
  },
  response: disputeResponse,
  errors: { ...qaErrors, 409: ["REVIEW_DISPUTE_CONFLICT"] },
});

const ownerErrors = { 400: ["INVALID_REQUEST", "VALIDATION_FAILED"], 503: ["SAFETY_STORE_UNAVAILABLE"] };

export const ApiOwnerReports = () => OwnedOperation({
  ...reviewRead, summary: "List my approved review reports", role: "MEMBER",
  description: "Returns up to ten independently approved reports for the signed-in video owner whose original review source and consent remain current. Includes private evidence, annotations, and recent disputes. Without current storage and review consent the list is empty.",
  query,
  response: {
    ...object({ reports: array(object({
      id, summary: string, limitations: string, approvedAt: timestamp, reviewer: nullable(string),
      source: object({ videoId: id, uploadedAt: timestamp }),
      claims: array(object({ ...claim, feedback: array(feedback, 2) })), disputes: array(dispute, 10),
    }), 10), nextCursor: nullable(id) }),
    example: { reports: [], nextCursor: null },
  },
  errors: { ...ownerErrors, 400: ["VALIDATION_FAILED"] },
});

export const ApiUpdateClaim = () => OwnedOperation({
  ...reviewBody, summary: "Confirm, share, or revoke my review claim", role: "MEMBER",
  description: "Only the video owner can update an eligible claim in their approved report. Confirm before sharing. Sharing requires current PROFILE_MATCHING, REPORT_SHARING, and VIDEO_CLAIM_MATCHING consent. Revocation removes sharing and prevents further claim state changes.",
  path: path("Claim identifier."),
  body: { ...object({ expectedRevision: claimRevision, action: enumeration("CONFIRM", "SHARE", "REVOKE") }),
    example: { expectedRevision: 0, action: "CONFIRM" } },
  response: object({ claim: object(claim) }),
  errors: { ...ownerErrors, 403: ["CONSENT_REQUIRED"], 404: ["REVIEW_CLAIM_NOT_FOUND"], 409: ["REVIEW_CLAIM_CONFLICT"] },
});

export const ApiSaveClaimFeedback = () => OwnedOperation({
  ...reviewBody, summary: "Save private feedback on my claim evidence", role: "MEMBER",
  description: "The video owner can annotate context or an existing transcript. Revision 0 creates an annotation; resending the identical note returns the current annotation. Notes stay private and do not change the claim evidence or sharing permissions.",
  path: path("Claim identifier."),
  body: { ...object({ expectedRevision: claimRevision, target: feedbackTarget, note: privateText(2000) }),
    example: { expectedRevision: 0, target: "CONTEXT", note: "The question was about my family." } },
  response: object({ feedback }),
  errors: { ...ownerErrors, 404: ["REVIEW_CLAIM_NOT_FOUND"], 409: ["REVIEW_FEEDBACK_CONFLICT"] },
});

export const ApiOpenReviewDispute = () => OwnedOperation({
  ...reviewBody, summary: "Open a private dispute on my report or claim", role: "MEMBER", status: 201,
  description: "The video owner can dispute the current approved report or a claim in that report. Omit claimId to dispute the report. Only one OPEN or IN_REVIEW dispute is permitted per approved report version.",
  path: path("Approved review identifier."),
  body: { ...object({ reason: privateText(2000), claimId: id }, ["reason"]),
    example: { reason: "The report omits context about this observation." } },
  response: disputeResponse,
  errors: { ...ownerErrors, 404: ["REVIEW_NOT_FOUND", "REVIEW_CLAIM_NOT_FOUND"], 409: ["REVIEW_DISPUTE_CONFLICT"] },
});
