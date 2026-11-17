# Trust, safety and account privacy

## Scope and status

Huong / T11. This independently testable deliverable implements member blocking,
bounded reporting and a moderator-only workflow. It does not implement matching,
expert assignment/review access, account closure, hard deletion or retention policy.
C062 matching/review integration and C065 remain explicit dependencies; C066
account-deletion controls must not imply an unavailable service.

## C061 persistence

Existing Block/Report/AuditLog models are reused. Directional blocks reference real
users, remain unique and reject self-blocks. Reports gain a nullable technical
reason catalog and independent bounded revision; existing free text is preserved
without inventing a historical classification. Reporter/target/moderator mappings
use SET NULL so future account removal cannot cascade report evidence away.
Moderator transitions retain separate append-only actions and opaque actor evidence;
recording times are database-owned. Safety-prefixed AuditLog rows cannot be edited
or deleted, and AuditLog truncation is denied. These integrity constraints do not
approve indefinite retention or add a privileged purge procedure.

The additive migration validates existing foreign keys/self-reference constraints.
It fails atomically on inconsistent legacy rows rather than dropping/repairing them.
Review orphan/self-reference records before deployment. Apply only through the
normal reviewed migration process; local public database migration is NOT performed.
Tests use synthetic UUID-owned schemas and test initial-schema upgrades.

## C062 blocking and consumer boundary

POST /blocks accepts only targetUserId, denies self-block/unavailable targets and
returns 204 after an idempotent own directional block. Targets are opaque account
references, not email/name lookups; active verified accounts may be blocked
regardless of their role. DELETE /blocks/:targetUserId requires empty JSON, removes
only the caller's edge and never removes a reverse block. GET /blocks/me returns
50 own outgoing references/dates plus nextCursor; inbound block direction, names
and contact data are private. No consent grant is required to restrict contact.

Mutations lock participant User IDs in sorted order, then revalidate the actor and
session before committing state plus redacted atomic audit. Separate bounded MVP
quotas reserve unblock capacity independently of block/report writes.

BlockAccessService.assertClear(tx,a,b) rejects either direction; excludedPeers
supplies an internal reciprocal filter. Consumers must check authoritative rows
in their own transaction after the same sorted participant locks. No positive
result is a cached grant. The actual matching/review access routes do not exist
yet: endpoint-level immediate exclusion is BLOCKED until Phuc integrates and
tests these helpers. Existing MatchPair/decision history is not blindly deleted.

## C063 report submission

POST /reports requires MEMBER authentication and exactly targetUserId, reason,
details. Reasons: HARASSMENT, INAPPROPRIATE_CONTENT, IMPERSONATION, SPAM, OTHER.
These are technical intake categories, not findings or production policy approval.
Details are NFC/newline-normalized plain text, 10-2000 Unicode code points; control
characters and obvious private capability/credential markers are rejected.
Do not include passwords, private video links or unrelated personal information.
No attachment, media fetch, HTML execution or client-supplied authority is supported.

A 202 message acknowledges receipt of the request without disclosing target
existence/availability or returning report evidence/status/IDs. Eligible targets
create an OPEN report and redacted audit in one transaction. Absent/inactive or
unverified targets create no report but receive the same message. This is not
constant-time lookup or a claim that a moderation decision was made. Reporting
remains available after blocking; five requests/member/minute are process-local
MVP quotas and never consume the separate unblock bucket. No automatic POST
replay or durable duplicate-report suppression is claimed.

## C064 moderation and real-assurance release gate

Only active verified MODERATOR sessions may call GET /moderation/reports,
GET /moderation/reports/:id and PATCH /moderation/reports/:id. ADMIN does not
inherit access. StaffAssuranceSource is empty by default in every environment;
there is no client boolean or environment override granting MFA. Private report
access requires trusted session-bound, unexpired MFA assurance. Synthetic proofs
are injected only into isolated tests and are rejected outside NODE_ENV=test.
Production moderation remains BLOCKED until a reviewed real assurance source
is integrated. Role membership and email verification alone are insufficient.

The queue returns bounded metadata/cursor only for unassigned OPEN cases or the
caller's cases, excluding cases involving that moderator. Details require an
explicit successful claim. OPEN -> IN_REVIEW assigns the moderator; only that
moderator may move IN_REVIEW -> RESOLVED or DISMISSED. Terminal states cannot
reopen. Resolving a case does not suspend users, erase evidence or fetch media.

PATCH takes exactly expectedRevision/status. User/session rechecks, sorted User
locks, Report row lock, revision CAS, opaque actor mapping, immutable action and
redacted audit commit together. Stale writes return 409; a case claimed by another
moderator becomes out-of-scope (404), including a lost concurrent claim. Queue and
detail reads are audited without report text. Unassigned or other staff's details
return the same unavailable response. No report/media/consent data is public.
