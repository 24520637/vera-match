# C033 - Assign a READY video to an eligible expert

Plan-Step: C033. Ticket: T06.
Planned commit: `feat(assignment-api): assign READY video with consent`.
This implementation is restricted to isolated synthetic testing. Production
staff-MFA and qualification/policy publication remain release gates, not approvals
granted by this API. C051 cancellation remains Huong-owned; see [Assignment cancellation](ASSIGNMENT-CANCELLATION.md).

## Request and result

`POST /api/expert-admin/assignments` requires an authenticated ACTIVE,
email-verified MODERATOR. ADMIN does not inherit this permission. The session
supplies the actor; body/query authority, snapshots, status, revision, timestamps,
approval IDs and client MFA assertions are rejected. No legacy POST alias exists
at `/expert/assignments`; C034 playback is documented in [EXPERT-PLAYBACK-API.md](EXPERT-PLAYBACK-API.md).

Require configured Origin, JSON, and an Idempotency-Key of 16-128 ASCII letters,
digits, hyphens or underscores, following the existing consent header convention.
The route reuses the expert-admin limiter: 20 authenticated requests per moderator
and 60 per socket IP per minute, shared with approval requests but independent of
auth/withdrawal buckets. This is bounded process-local MVP throttling; 429 includes
Retry-After. Success/errors use private/no-store and Vary: Cookie.

```json
{
  "videoId": "video-id",
  "expertId": "expert-id",
  "expectedCredentialRevision": 1,
  "dueAt": null,
  "expiresAt": null
}
```

Both dates are required, explicitly null or strict UTC ISO timestamps with
milliseconds. Set dates must be future; dueAt cannot exceed expiresAt when both
exist. A set expiresAt cannot exceed approval or training/confidentiality evidence
validity. Null means no additional assignment deadline/expiry; it never overrides
qualification expiry or the mandatory current checks on future expert access.
No 90-day/365-day defaults, workload limits or availability rules are invented.

201 returns only assignment metadata:

```json
{
  "assignment": {
    "id": "server-generated-id",
    "videoId": "video-id",
    "expertId": "expert-id",
    "status": "ASSIGNED",
    "revision": 0,
    "credentialApprovalId": "server-approved-instance-id",
    "dueAt": null,
    "expiresAt": null
  }
}
```

It contains no playback URL, object locator, member profile, notes, qualification
snapshot or internal transaction witness. Video status remains READY: assignment
creation does not introduce an UNDER_REVIEW transition. C034 provides a separate,
assignment-bound playback route without changing assignment or video status.

## Eligibility and generation

The video must be READY and not soft-deleted, owned by an ACTIVE verified MEMBER.
Both VIDEO_STORAGE and EXPERT_VIDEO_REVIEW must pass the real ConsentAccessService
policy-evidence checks. storageConsentVersion must be present, not in the future,
and not superseded by a VIDEO_STORAGE withdrawal task.

The target must be an ACTIVE verified EXPERT, with APPROVED current credential,
matching immutable approval subject and expectedCredentialRevision. Recoverable
C032 snapshots must have correct server SHA-256 and match the current trusted
training/confidentiality registries and source records. Missing, malformed,
expired or unresolvable provenance fails closed; legacy data is not repaired.
Self-review and either-direction owner/expert Block records are denied.
ASSIGNED, IN_PROGRESS and SUBMITTED all occupy the one-active-assignment index.
This is create-only: no automatic cancellation, reassignment or review editing.

New assignments capture ConsentLedger.subjectId and its aggregate version in
reviewConsentSubjectId/reviewConsentVersion. Do not compare only current version
equality: unrelated consent changes need not invalidate a review. The shared
requireGenerationInTransaction helper rejects a missing/mismatched lineage,
future generation or a later withdrawal task for the same purpose. Re-grant does
not remove that permanent barrier. Legacy NULL bindings fail this access check.
Storage generation remains the video-owned binding; no second consent store exists.

## Transactions, races and idempotency

Lock existing moderator/owner/expert User rows in ID order, then Session, Video,
ExpertCredential and existing assignments. Recheck session/account eligibility
and both consents inside this transaction. ConsentAccessService.requireInTransaction
and requireGenerationInTransaction accept the existing transaction; callers must
hold the owner User lock. Do not compose independent isAllowed transactions.

The credential row lock plus expected revision detects concurrent approval changes.
Evidence provenance is loaded first; after all source I/O and lock waits the API
reads PostgreSQL clock_timestamp in UTC immediately before assignment insertion.
It revalidates session expiry, approval/evidence validity and assignment dates
against that fresh clock. Row locks do not freeze natural expiry. Receipt replay
also checks session expiry against a fresh database clock before returning.
The video/owner locks serialize creation against real owner deletion/withdrawal.
The PostgreSQL partial unique index remains the final active-assignment race guard.
Block mutation consumers must coordinate eligibility/access checks; this change
does not add or alter a block-management API.

Creation writes opaque actor evidence, ASSIGNED/revision 0, exact AssignmentEvent
snapshot, EXPERT_ASSIGNMENT_CREATED audit and AssignmentIdempotency receipt in
one transaction. Any failed write rolls everything back, including the C031 ID
reservation. Existing lifecycle, append-only history and database audit clocks
remain authoritative. No automatic mutation retry occurs.

Idempotency scope is opaque moderator subject + CREATE_ASSIGNMENT + hashed key.
Fingerprinting uses a fixed field order and parsed ISO/null date values. Same key
and fingerprint returns the original 201 body with Idempotency-Replayed: true;
different payload returns 409 IDEMPOTENCY_KEY_REUSED. Actor scopes are independent.
Replay rechecks the moderator/session but does not recreate resources or re-run
the original mutation. An original ASSIGNED status in a replay is a historical
receipt, not a claim that the assignment remains active or access is authorized.
Withdrawal, re-consent, cancellation or Video deletion never becomes a grant by
replaying. Receipts reference the retained issued-ID registry, not a cascading
live assignment FK. There is no automatic key expiry/reuse or purge; production
retention/de-identification policy still needs explicit review before real use.

Errors: 400 VALIDATION_FAILED with field/_form details; 401 UNAUTHENTICATED;
403 ASSIGNMENT_INELIGIBLE or CONSENT_REQUIRED; 404 VIDEO_NOT_FOUND;
409 ASSIGNMENT_CONFLICT, RESOURCE_REVISION_CONFLICT, VIDEO_WITHDRAWN or
IDEMPOTENCY_KEY_REUSED. Storage/source/uncertain database failures are sanitized
503 ASSIGNMENT_UNAVAILABLE. No 503 implies successful or rolled-back completion;
manually reconcile using the original key. Only confirmed success emits the
success audit. This step defines no new denial-audit taxonomy.

## Production and integration boundaries

There is no trusted staff-MFA implementation. C033 is therefore unavailable in
development/production (503 ASSIGNMENT_ASSURANCE_UNAVAILABLE), and even in test
mode requires both policy evidences to be explicitly testOnly. NODE_ENV=test alone,
client flags, ordinary real-policy rows or fabricated qualification snapshots do
not enable real-data assignment. Default qualification registries/evidence sources
remain empty; test providers exist only in isolated fixtures.

This is not a new MFA mechanism. A separately reviewed real assurance integration,
approved qualification/consent content and evidence sources are required before
enabling production. Capacity/availability and broader conflict-of-interest rules
are not implemented or represented as approved. C034/C050 must recheck owner
consent, generation, video state, expert eligibility and real MFA on every access.

C051 implements source-bound cancellation using revision CAS and exact immutable
transitions, coordinating this lock protocol; see its separate contract. C033
still only creates assignments. After withdrawal an old row can occupy the active
index until the C051 consumer processes it, while C034 denies access immediately.
Replay and re-consent never turn that row into a grant.

## Validation

Unit validation and disposable PostgreSQL API/migration suites cover eligibility,
generation, replay, concurrency, rollback and history. Migration preserves legacy
rows/events without fabricating consent bindings; a deliberate post-DDL failure
verifies transaction rollback. C031/C032/T04/Auth and available video regressions
must also pass. Synthetic fixtures directly provision READY metadata; they do not
substitute for the separate real MinIO upload/confirm acceptance tests.
Race tests observe real PostgreSQL lock waits before releasing barriers and hold
the real competing domain transaction before COMMIT to exercise both orderings.
Expiry tests let real database time pass while evidence lookup or a User lock is
blocked, then require no assignment/event/success-audit/idempotency receipt.
