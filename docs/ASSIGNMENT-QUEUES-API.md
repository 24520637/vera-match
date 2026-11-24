# C035 assignment metadata and known-pair candidate API

Ticket T06. Planned subject: `feat(expert-ui): build assignment and moderation queues`.
Huong approved Option 2: MODERATOR may view assignments
within their server-authorized moderation scope, not merely their own creations.
PA2 defines explicit per-assignment grants, never global or creator access.

PA2 update: Huong approved explicit per-assignment PostgreSQL grants administered
by trusted-provisioned ACTIVE/verified ADMIN with real session-bound MFA. Expiry
is mandatory; regrant creates a new lifecycle. Stage 1 adds persistence and DB
tests; see [DATABASE.md](DATABASE.md#c035-pa2-persistence-and-reader).
The grant/revoke service is available through the authenticated ADMIN endpoints below. Moderator queue and QA reads check grant expiry, revocation and binding to the recipient's current staff identity and MFA enrollment epoch.

## Read contracts implemented in this branch

All routes use existing SessionAuthGuard/RolesGuard, active verified accounts,
server-derived identity and private/no-store/Vary Cookie responses. ADMIN has no
implicit EXPERT/MODERATOR permission. Unknown query keys, arrays and malformed
references/cursors receive 400 VALIDATION_FAILED. Read buckets are separate from
authentication, creation and withdrawal quotas; 429 includes Retry-After.

`GET /api/expert/assignments/me?status=ASSIGNED&cursor=...` is EXPERT-only. Optional
status is one existing AssignmentStatus; omitted means all own assignment states.
No client userId/expertId filter exists. Fifty rows per page are ordered by id DESC;
the opaque next cursor is the last returned ID. Ownership is always part of SQL.

```json
{"assignments":[{"id":"assignment-id","status":"ASSIGNED","dueAt":null}],"nextCursor":null}
```

Only id/status/dueAt are returned: no owner, video key, email, notes, credential
evidence or signed URL. Historical assignment metadata is not playback authority;
withdrawal may invalidate access before C051 updates the row's status.

`GET /api/expert-admin/assignments` is MODERATOR-only, using the same DTO/status/
cursor contract. A materialized authorized SQL set joins the authenticated user's
live opaque identity, assignment-specific scope and current GRANTED event. It
excludes revoked/expired lifecycles using PostgreSQL clock_timestamp before applying
status/cursor/order/limit. No grant means an audited 200 empty queue, not an outage.
The reader creates no identities, scopes or grant events. Legacy creator IDs,
wildcards, client scope headers and forged cursors never confer authority.

The moderator User lock precedes Session, matching Stage 2 mutation ordering. Read
and revoke serialize on that shared User; all normal grant writers must honor this
protocol. Relationships are re-read under lock. Minimal ASSIGNMENT_QUEUE_READ audit
and authorization commit together; audit failure returns no metadata. A fresh DB
clock after audit rechecks session/MFA and every selected grant (including cursor
lookahead). Expiry during audit rolls it back and returns sanitized 503 rather than
expired rows/cursor. Authorization is at the transaction decision; metadata already
read/copied before a later revoke cannot be recalled. Every page rechecks membership.

Missing/failing MFA source returns 503 ASSIGNMENT_ASSURANCE_UNAVAILABLE. Invalid or
expired assurance returns 403; missing/expired/revoked sessions return 401. Synthetic
proofs are rejected outside test. Deployed reads exclude synthetic and legacy grants. Reissue them through the authenticated grant flow. Unexpected DB/audit failures and read-time grant expiry return 503 ASSIGNMENT_QUEUE_UNAVAILABLE.

## Grant administration

Both endpoints require an active, verified ADMIN session, current MFA, and the signed `ASSIGNMENT_GRANT_ADMIN` permission. Requests use JSON and the configured exact Origin.

| Method and path | Body | Success |
| --- | --- | --- |
| POST `/api/expert-admin/assignment-grants` | `assignmentId`, `moderatorId`, `expectedRevision`, `expiresAt` as a UTC timestamp with milliseconds | 201 |
| POST `/api/expert-admin/assignment-grants/revoke` | `scopeId`, `grantId`, `expectedRevision` | 200 |

Both return `scopeId`, `grantId`, `revision`, `kind` and `expiresAt`. The first grant uses revision 0. Retain the response revision for the next change on that scope. The recipient must be a currently authorized moderator, and the grant cannot outlive their staff authorization. Verify administration and QA scope on staging before release.

## Approved PA2 policy and integration boundaries

The original inspection before PA2 persistence found the following boundaries:

- ExpertAssignment.assignedById is nullable creator provenance (ON DELETE SET NULL),
  not scope membership. It must not become the Option 2 authorization predicate.
- Report.moderatorId and ModerationService.visible govern Safety Report claims only.
  There is no relationship mapping those report cases to assignment authorization.
- AuthContext provides identity/session/role; StaffAssurance proves session-bound
  assurance. Neither defines which assignments a moderator may view.
- PA2 provides explicit assignment/subject scope, grant/revoke history tables,
  and a grant-filtered queue reader.

## Stage 2 internal mutation service (no HTTP endpoint)

AssignmentGrantsService resolves signed administrator provisioning under the same User lock used to apply or revoke directives. MFA binds the proof to the current session. Missing sources return sanitized 503; invalid, mismatched or expired proofs return 403. Test-only evidence stays in isolated fixtures.

Mutation lock order is sorted participating Users, Session, live Assignment (when
present), then Scope. Target identity/relationships are re-read under those locks.
Grant requires an existing ACTIVE/verified MODERATOR and live assignment. It uses
virtual revision 0 before scope creation. Revoke identifies scope plus the original
grant ID and current expected revision; it can remove retained grants after target
ineligibility/deletion or expiry. It never rebinds to a new moderator identity.
State, immutable event, server-owned actor evidence and minimal success AuditLog
are atomic. Audit/source failure rolls back identities, scope and events. Fresh
PostgreSQL time after source I/O/lock waits checks session/MFA and mandatory grant
expiry; expiry is checked again after the grant audit. No assignment state or
revision changes, playback permission or MODERATOR read permission is granted to ADMIN.

### External API proposal — PENDING APPROVAL / NOT IMPLEMENTED

Possible routes are POST /api/admin/assignment-moderator-grants and
POST /api/admin/assignment-moderator-grants/:scopeId/revoke. These names, HTTP status
mapping and response wrapper are proposals only, not approved external contracts.
The implemented internal inputs are:

```json
{"assignmentId":"assignment-id","moderatorId":"moderator-id","expectedRevision":0,"expiresAt":"2090-01-01T00:00:00.000Z"}
```

```json
{"scopeId":"00000000-0000-4000-8000-000000000001","grantId":"00000000-0000-4000-8000-000000000002","expectedRevision":1}
```

Grant expiry must be strict UTC ISO with milliseconds, non-null and after database
time, without a default TTL. Internal results contain scopeId/grantId/revision/kind/
expiresAt; external wrapping remains pending. Forged/unknown fields return 400
VALIDATION_FAILED. Invalid session/account returns 401 UNAUTHENTICATED; role/proof
denial is 403; unavailable resources 404 ASSIGNMENT_GRANT_NOT_FOUND; stale revision,
wrong lifecycle or replacing a live grant without revoke returns 409
RESOURCE_REVISION_CONFLICT. Missing provisioning/MFA returns 503
ASSIGNMENT_ADMIN_PROVISIONING_UNAVAILABLE / ASSIGNMENT_ADMIN_MFA_UNAVAILABLE;
unexpected source/database errors use 503 ASSIGNMENT_GRANT_UNAVAILABLE without
private exception details.

There is no HTTP idempotency key, receipt store, reconciliation endpoint or automatic
retry in Stage 2. Repeating a successful mutation with its old expectedRevision
conflicts; this is CAS, not durable idempotency. Actor/operation/key scoping, canonical
fingerprints, original-result replay and retention require approval before HTTP
exposure. Origin/JSON guards, dedicated rate limits/429 Retry-After, private headers
and SessionAuthGuard/RolesGuard must be added at an approved controller boundary.
The service independently rechecks database session/role and never trusts a forged
AuthContext role. These future transport requirements are not implemented guarantees.

Deletion preserves opaque scope/event evidence through the issued assignment-ID
registry. Lost live actor/moderator mappings cannot grant a replacement account
authority. A trusted ADMIN may still revoke a retained scope after live resources
are deleted. Production retention/de-identification and erasure procedures remain
open; the service does not hard-delete evidence or change account-deletion policy.

The approved scope unit is one assignment and one live moderator identity. Stage 3
tests actual PostgreSQL grants through the Stage 2 service and real queue HTTP,
including creator denial, cross-scope pagination, expiry, revocation and both
read/revoke transaction orderings. Synthetic providers attest only synthetic test
identities. Staging acceptance must exercise the signed provision, MFA and authenticated endpoints against the target deployment. Retention/de-identification and durable HTTP idempotency remain separate work.

`GET /api/expert-admin/assignments/candidate?videoId=...&expertId=...` is a MODERATOR
known-pair check, not a directory/search or public candidate list. It returns only:

```json
{"candidate":{"videoId":"video-id","expertId":"expert-id","expectedCredentialRevision":1}}
```

It rechecks the C033 READY/non-deleted video, eligible owner, both current consent
purposes, valid storage generation, eligible expert/current approval/evidence,
self-review, bilateral block and active-assignment uniqueness (including SUBMITTED).
Missing or ineligible pairs share a 404 response. Evidence/store outages fail closed.
Candidate reads do not create assignments or reserve eligibility. C033 revalidates
everything during creation; a read result can become stale immediately afterwards.

## Transactions, assurance and release gates

The read transaction uses sorted participating User locks, Session, and for candidate
checks Video, ExpertCredential, sorted ExpertAssignment locks. Locator queries give
no authority. Session and server assurance are rechecked with a fresh PostgreSQL UTC
clock after external I/O and before returning. Candidate qualification expiry is
also checked after the required audit. Minimal read audits contain no evidence/text.

The queue reuses the session-bound StaffAssuranceSource. Candidate reads also check the current signed qualification and consent publications. The moderator queue filters by current, approved grants before pagination.

## UI and C033 creation

The existing presentation adapters now use apiJson and runtime response validation.
Queue errors hide rows; identity changes discard stale reads. The moderator form
accepts only known opaque references and asks the server to check the pair. No
broader user/video discovery is offered. Dates are explicit UTC ISO/null values.
Confirmation uses the server's credential revision and the existing C033 request.

One original payload/key is retained in browser memory per authenticated user while
an outcome is uncertain; retry is manual and never changes the original request.
Countdown expiry does not send requests. Late receipts update only their original
user's pending operation. A receipt confirms the historical create operation, not
current media access. A document reload loses browser memory; C033's database
uniqueness/idempotency remains authoritative. Review server state before replacing
an unknown operation. Production endpoints remain unavailable without reviewed sources.

Manual moderator cancellation/reassignment and C050 review editing/submission are
not implemented by C035. C034 playback authorization and the C051 owner-deletion /
consent-withdrawal cancellation implementation are integrated from develop, along
with the C034 timezone regression fix and C036 race-test coverage. Existing
Safety Report moderation remains a separate Safety feature; this PR does not add
or change its behavior. Validation does not approve production assurance or
trusted moderator provisioning.
