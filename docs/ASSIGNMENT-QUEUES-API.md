# C035 assignment metadata and known-pair candidate API

Ticket T06. Planned subject: `feat(expert-ui): build assignment and moderation queues`.
This is a partial feature pending an implemented moderator scope mechanism and
production assurance. Huong approved Option 2: MODERATOR may view assignments
within their server-authorized moderation scope, not merely their own creations.
That direction does not approve global access or define scope membership.

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

`GET /api/expert-admin/assignments` is reserved for MODERATOR. The approved scope
direction cannot be enforced yet because no assignment moderation scope mechanism
exists. It returns 503 MODERATOR_QUEUE_SCOPE_PENDING without reading queue rows.
The implementation does not silently broaden access. The UI connects to this
route and shows the unavailable state. It is not Safety Report moderation.

## Approved scope direction and missing membership contract

Inspection of the current schema, session, staff assurance and origin/develop found:

- ExpertAssignment.assignedById is nullable creator provenance (ON DELETE SET NULL),
  not scope membership. It must not become the Option 2 authorization predicate.
- Report.moderatorId and ModerationService.visible govern Safety Report claims only.
  There is no relationship mapping those report cases to assignment authorization.
- AuthContext provides identity/session/role; StaffAssurance proves session-bound
  assurance. Neither defines which assignments a moderator may view.
- No assignment moderation scope table, membership issuer, trusted resolver,
  scope-to-assignment mapping or membership revocation mechanism exists.

The following contract must be agreed before enabling moderator list reads:

1. Scope unit and resource mapping: what constitutes a scope and how each assignment
   (including legacy rows) enters or leaves it. No global/creator fallback is implied.
2. Membership provisioning: which authorized server workflow/actor grants membership,
   where it is stored or verified, and what evidence identifies that issuer. No
   implicit ADMIN permission or client-provided scope claim is approved here.
3. Membership verification: the authoritative resolver/persistence and the SQL-level
   predicate intersecting the caller's valid memberships with assignments on every
   request and page, including status/cursor filters. MFA alone is insufficient.
4. Membership lifecycle: expiry/revocation, relationship changes, concurrency/lock
   protocol and audit evidence. Missing/unavailable membership must fail closed.
5. Authorized metadata and failure semantics: approve the returned fields and
   behavior for an existing scope with no membership, cross-scope references,
   revoked membership and an unavailable scope source before implementing them.

Until that exists, the route remains connected to an explicit unavailable API, not
a functioning authorized moderator queue. Real authorized-scope and cross-scope
pagination tests are BLOCKED; inventing memberships in tests would not verify a
real mechanism. Negative tests prove no rows are queried/exposed even when the
caller created assignments, and reject forged scope/moderator query parameters.

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

The existing StaffAssuranceSource interface is reused in the queue module; no
Safety Report source or module is changed. Its default provider supplies no MFA.
This branch additionally denies non-test environments and requires testOnly=true,
user/session-bound MFA proof. Default qualification sources remain empty and test
mode requires synthetic consent policies. Tests cannot enable real production access.
Real metadata publication, shared provider DI/ownership, MFA and evidence sources
require Huong's review before replacing these gates. Role or client flags are not MFA.

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

Manual cancellation, reassignment, media playback, C050/C051 and Safety Report
moderation are not implemented. The combined working tree includes C034 from
origin/develop through a pending merge; integration validation does not approve
production assurance, moderator scope or C050/C051 behavior.
