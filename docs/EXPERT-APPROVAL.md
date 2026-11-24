# C032 - Moderator expert qualification approval

Plan-Step: C032. Ticket: T06.
Planned subject: `feat(expert-admin): approve eligible expert records`.
This guide describes the expert approval endpoint and its signed qualification
source. Production training and confidentiality policies, evidence provisioning,
staff MFA and retention require separate operational approval.

## HTTP contract

`POST /api/expert-admin/experts/:userId/approvals` requires an existing HttpOnly
session for an ACTIVE, email-verified MODERATOR. ADMIN does not inherit this role;
MEMBER and EXPERT are denied with 403, including self-approval attempts. Missing,
revoked, expired, inactive or unverified sessions return 401. The target must
already be an ACTIVE, verified EXPERT (403 otherwise, 404 if absent). No User is
created, activated, assigned a new role or given access to member data.

The session supplies the approving actor. The route identifies only the target.
Query parameters and unexpected body fields are rejected. Mutations require the
configured Origin, no cross-site Fetch Metadata, and application/json. All route
responses, including guard errors, are private/no-store and vary by Cookie.
Separate process-local limits are 20 requests/moderator/minute and 60/IP/minute;
429 includes Retry-After and never indicates approval. Distributed throttling is
a deployment requirement, not implemented here.

```json
{
  "expectedRevision": 0,
  "trainingVersion": "server-approved-training-version",
  "policyVersion": "server-approved-expert-confidentiality-version",
  "trainingEvidenceId": "opaque-training-record-id",
  "confidentialityEvidenceId": "opaque-acceptance-record-id",
  "expiresAt": null
}
```

The example identifiers are placeholders. The request validator accepts 1–200
ASCII letters, digits, dots, underscores, colons or hyphens, starting with a
letter or digit. A successful lookup also requires the exact identifier in the
signed publication. Publication versions and evidence IDs use 1–128 ASCII
letters, digits, underscores or hyphens. expectedRevision is a nonnegative safe
integer. expiresAt is required:
explicit null or an ISO UTC timestamp with milliseconds. No default expiry is
invented. A supplied expiry must be future and not exceed either evidence's
validUntil. Null expiry does not make finite evidence perpetual; future access
authorization must separately check evidence validity and MFA.

Success is 201 with a resource wrapper; snapshots/private references are excluded:

```json
{
  "revision": 1,
  "credential": {
    "userId": "expert-id",
    "status": "APPROVED",
    "approvalId": "server-generated-uuid",
    "trainingVersion": "server-approved-training-version",
    "policyVersion": "server-approved-expert-confidentiality-version",
    "approvedAt": "2026-11-17T00:00:00.000Z",
    "expiresAt": null
  }
}
```

Validation returns 400 VALIDATION_FAILED with `{field, messages}` details for
expectedRevision, trainingVersion, policyVersion, trainingEvidenceId,
confidentialityEvidenceId or expiresAt. Unsupported fields/query parameters use
_form. Wrong Origin is 403 ORIGIN_DENIED; non-JSON is 415 JSON_REQUIRED.
Stale/conflicting writes are 409 RESOURCE_REVISION_CONFLICT. Storage/evidence
source failures are sanitized 503 EXPERT_APPROVAL_UNAVAILABLE. An unavailable
response or transport error is not proof of success or failure; inspect retained
credential/audit state through an authorized operator before explicitly retrying.
No automatic mutation replay or new credential-reading endpoint is introduced.

## Server-owned evidence and fail-closed operation

ExpertApprovalRegistry resolves approved training and confidentiality content by
version. ExpertEvidenceSource resolves completion and acceptance records by ID.
Both read the current [signed qualification publication](EXPERT-QUALIFICATION-SOURCE.md)
using the absolute, operator-controlled paths `EXPERT_QUALIFICATION_MANIFEST_PATH`
and `EXPERT_QUALIFICATION_PUBLIC_KEY_PATH`. The server verifies the publication
against the trusted authority's Ed25519 public key on each lookup. The source
and signing authority are separate from member consent.

Evidence must match the target expert, purpose and version. The publication
requires nonempty version and evidence content of at most 65,536 UTF-8 bytes,
and evidence dates with `recordedAt` no later than publication issuance and
`validUntil` later than `recordedAt`. Approval requires current evidence.
The submitted IDs locate these server-side records. A client upload, digest,
role assertion or MFA flag cannot establish qualification.

The runtime supports operator-installed publications. Production provisioning
requires an authorized publication with approved versions and actual evidence
plus a trusted public key installed on the target host. Repository support alone
does not establish that provisioning has occurred. Approval fails closed with
unconfigured, invalid or expired publication data. An unapproved version returns
400. A source failure or unavailable evidence record returns sanitized 503.
Synthetic providers are injected only in isolated tests.

The moderator session, target eligibility and revision checks still apply.
Qualification approval grants neither MFA nor assignment access. Assignment
access retains its own session-bound assurance, scope and consent checks and
its test-only gate. QA requires trusted session-bound staff MFA, a current
assignment-specific grant and independence from the assigned expert and video
owner.

The server stores recoverable SNAPSHOT content containing the evidence content,
source ID, credential subject, version, original source business timestamps and
approved training/policy content. SHA-256 is calculated on the server. Approval
identity is the server-owned ExpertActorIdentity opaque subject, not email/name.
Verification/approval timestamps come from PostgreSQL UTC clock time; audit event
recording timestamps remain database-controlled by the existing C031 triggers.
Source recordedAt is retained as business evidence time, never as audit insert time.

## Transaction and revision protocol

Lock moderator/target User rows in stable order and recheck eligibility. Lock and
recheck the authenticated Session. The target User lock serializes initialization
and reapproval. An absent credential has virtual revision 0. First approval creates
PENDING revision 0 plus CREATED event, creates a new immutable approval snapshot,
advances to APPROVED revision 1 by revision CAS and appends APPROVED event.
All actor mapping, current state, approval and event writes commit or roll back
together. Existing pending credentials reuse their original subject/creation event.
Reapproval, including after revocation, always creates a new approval ID and
increments revision once; it never edits old evidence or assignment bindings.
Revision exhaustion fails closed. There is no automatic retry of CAS conflicts.

No C031/T04 migration or schema is changed. No Auth/AuditLog, consent, privacy,
video/storage or assignment-mutation behavior is modified. Existing cancelled
assignments remain cancelled. C033-C036, expert UI, credential discovery UI/API,
video READY/consent/playback authorization and production permissions/retention
remain outside C032. Real MFA is still required before real-member-data access;
credential approval and role membership do not replace it.
