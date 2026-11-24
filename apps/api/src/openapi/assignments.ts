import { AssignmentStatus } from "@prisma/client";
import { array, empty, enumeration, fieldError, id, nullable, object, OwnedOperation, revision, timestamp } from "./operation";

const evidenceId = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$" };
const utcTimestamp = { ...timestamp, pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" };
const status = enumeration(...Object.values(AssignmentStatus));
const cursor = { type: "string", pattern: "^[A-Za-z0-9_-]+$", maxLength: 300 };
const queueQuery = [
  { name: "cursor", schema: cursor, description: "Omit for the first page. Use nextCursor verbatim for later pages." },
  { name: "status", schema: status, description: "Filter by assignment status." },
];
const queue = object({
  assignments: array(object({ id, status, dueAt: nullable(timestamp) }), 50),
  nextCursor: nullable(cursor),
});
const queueErrors = ["ASSIGNMENT_QUEUE_UNAVAILABLE", "ASSIGNMENT_ASSURANCE_UNAVAILABLE"];
const consentErrors = ["CONSENT_REQUIRED", "CONSENT_GENERATION_WITHDRAWN"];
export const assignedExpert = "Requires the assigned expert, current qualification, session-bound MFA, and matching storage and review consent generations. The assignment access gate currently limits this workflow to synthetic tests.";

export const ApiApproveExpert = () => OwnedOperation({
  summary: "Approve an expert credential", role: "MODERATOR", status: 201,
  origin: "required", rejectCrossSite: true, path: { name: "userId", schema: id },
  description: "Revision-checked approval for an active, email-verified EXPERT. Training and confidentiality versions and evidence IDs must resolve from a current operator-installed qualification publication verified against a trusted Ed25519 public key. Evidence must match the target expert, version and purpose and remain valid. A supplied expiry must be in the future and within both evidence validity periods. Missing or invalid publication data prevents approval. Approval does not provision MFA.",
  body: {
    ...object({
      expectedRevision: revision, trainingVersion: evidenceId, policyVersion: evidenceId,
      trainingEvidenceId: evidenceId, confidentialityEvidenceId: evidenceId, expiresAt: nullable(utcTimestamp),
    }),
    example: { expectedRevision: 0, trainingVersion: "training-v1", policyVersion: "policy-v1",
      trainingEvidenceId: "training-record-1", confidentialityEvidenceId: "policy-record-1", expiresAt: null },
  },
  response: object({ revision, credential: object({
    userId: id, status: enumeration("APPROVED"), approvalId: id, trainingVersion: evidenceId, policyVersion: evidenceId,
    approvedAt: timestamp, expiresAt: nullable(timestamp),
  }) }),
  errors: { 400: ["VALIDATION_FAILED"], 403: ["EXPERT_INELIGIBLE"], 404: ["EXPERT_NOT_FOUND"],
    409: [fieldError("RESOURCE_REVISION_CONFLICT")], 503: ["EXPERT_APPROVAL_UNAVAILABLE"] },
});

export const ApiCreateAssignment = () => OwnedOperation({
  summary: "Assign a video to an expert", role: "MODERATOR", status: 201,
  origin: "required", rejectCrossSite: true, idempotent: true,
  description: "Creates an assignment for a ready video and a qualified expert. Requires current storage and review consent and the current credential revision. A non-null deadline must not exceed expiry. The assignment creation gate currently limits this operation to synthetic tests.",
  body: {
    ...object({ videoId: id, expertId: id, expectedCredentialRevision: revision, dueAt: nullable(utcTimestamp), expiresAt: nullable(utcTimestamp) }),
    example: { videoId: "video-1", expertId: "expert-1", expectedCredentialRevision: 1, dueAt: null, expiresAt: null },
  },
  response: object({ assignment: object({
    id, videoId: id, expertId: id, status: enumeration("ASSIGNED"), revision: { ...revision, enum: [0] },
    credentialApprovalId: id, dueAt: nullable(timestamp), expiresAt: nullable(timestamp),
  }) }),
  errors: { 400: ["VALIDATION_FAILED"], 403: ["ASSIGNMENT_INELIGIBLE", ...consentErrors], 404: ["VIDEO_NOT_FOUND"],
    409: ["ASSIGNMENT_CONFLICT", "IDEMPOTENCY_KEY_REUSED", "VIDEO_WITHDRAWN", "RESOURCE_REVISION_CONFLICT"],
    503: ["ASSIGNMENT_ASSURANCE_UNAVAILABLE", "ASSIGNMENT_UNAVAILABLE"] },
});

export const ApiExpertAssignments = () => OwnedOperation({
  summary: "List my expert assignments", role: "EXPERT", query: queueQuery, origin: "optional", rejectCrossSite: true,
  description: "Returns up to 50 assignment metadata entries owned by the session expert. Excludes assignments whose video owner has closed their account. Requires current session-bound MFA and is available only with synthetic assurance in tests.",
  response: queue, errors: { 400: ["VALIDATION_FAILED"], 403: ["ASSIGNMENT_ASSURANCE_REQUIRED"], 503: queueErrors },
});

export const ApiModeratorAssignments = () => OwnedOperation({
  summary: "List assignments in my moderator scope", role: "MODERATOR", query: queueQuery, origin: "optional", rejectCrossSite: true,
  description: "Returns up to 50 metadata entries filtered by current assignment-specific grants before pagination. Excludes assignments whose video owner has closed their account. Requires session-bound MFA and a successful read audit. The production queue remains blocked by the grant provisioning gate even with valid MFA.",
  response: queue, errors: { 400: ["VALIDATION_FAILED"], 403: ["ASSIGNMENT_ASSURANCE_REQUIRED"],
    503: [...queueErrors, "MODERATOR_QUEUE_PROVISIONING_UNAVAILABLE"] },
});

export const ApiAssignmentCandidate = () => OwnedOperation({
  summary: "Check a known video–expert pair", role: "MODERATOR", origin: "optional", rejectCrossSite: true,
  description: "Checks eligibility for a known pair under session-bound MFA in synthetic tests. Returns the credential revision needed for assignment. Requests outside the test environment are denied.",
  query: ["videoId", "expertId"].map(name => ({ name, schema: id, required: true })),
  response: object({ candidate: object({ videoId: id, expertId: id, expectedCredentialRevision: revision }) }),
  errors: { 400: ["VALIDATION_FAILED"], 403: ["ASSIGNMENT_ASSURANCE_REQUIRED"], 404: ["ASSIGNMENT_CANDIDATE_UNAVAILABLE"],
    503: [...queueErrors, "ASSIGNMENT_EVIDENCE_UNAVAILABLE", "ASSIGNMENT_UNAVAILABLE"] },
});

export const ApiAssignmentPlayback = () => OwnedOperation({
  summary: "Issue private playback for an assignment", role: "EXPERT", origin: "required", rejectCrossSite: true,
  description: assignedExpert + " Send an empty JSON object. The signed URL lasts up to 60 seconds and may expire earlier based on current authorization.",
  path: { name: "assignmentId", schema: id }, body: empty,
  response: {
    ...object({ id, url: { type: "string", format: "uri" }, expiresAt: timestamp }),
    example: { id: "video-1", url: "https://storage.example.invalid/private/synthetic-video?signature=example", expiresAt: "2026-11-23T12:01:00.000Z" },
  },
  errors: { 400: ["INVALID_REQUEST", "VALIDATION_FAILED"], 403: ["ASSIGNMENT_ACCESS_DENIED", ...consentErrors],
    404: ["ASSIGNMENT_NOT_FOUND"], 503: ["EXPERT_ACCESS_UNAVAILABLE", "VIDEO_STORAGE_UNAVAILABLE", "ASSIGNMENT_UNAVAILABLE"] },
});
