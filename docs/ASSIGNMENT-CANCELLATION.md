# C051 - Durable assignment cancellation

Huong / T09. This follow-up implements cancellation for owner video deletion and
VIDEO_STORAGE / EXPERT_VIDEO_REVIEW withdrawal. It does not complete Feature 03,
C050/C053/C054, account deletion, reviewer edit/submit or production MFA/policies.

## Public behavior and ownership

Existing DELETE /api/videos/:id stays MEMBER/owner-only and returns 202 with
DELETED / cleanup PENDING. It verifies the authenticated owner as before, takes
an owner-scoped Video lock, and cancels active assignments in the same transaction
as the soft deletion, redacted audit and object-cleanup handoff. Cancellation
failure inside that transaction rolls it back; a transport/commit-acknowledgement
failure is uncertain and requires idempotent retry/reconciliation. A response
never claims physical erasure. No public cancel/worker endpoint or client-supplied actor is introduced.

ASSIGNED, IN_PROGRESS and SUBMITTED become CANCELLED. CANCELLED and COMPLETED
are untouched, including their revision/history. Reassignment requires a new
explicit C033 operation; re-consent never reopens or rebinds an old assignment.
Approval/consent bindings and original assignedByEvidence are preserved.

Cancellation uses the latest locked revision in a conditional update, advances
exactly once, and supplies cancelledAt from a fresh PostgreSQL UTC clock. A zero
row update is a conflict; exhaustion fails closed. The exact C031 AssignmentEvent
snapshot and immutable actor evidence commit with cancellation context and audit.
No automatic CAS replay or bulk UPDATE without one event per transition occurs.

## Cause and actor evidence

AssignmentCancellationContext is append-only and keyed by the retained event ID.
It stores only a reason, optional source task reference, minimal initiator evidence
and DB-owned recording time. It does not extend or rewrite the exact event snapshot.

| Reason                                                  | Executor in AssignmentEvent.actorEvidence                    | Initiator/context                                              |
| ------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| VIDEO_DELETED, authenticated owner request              | Existing opaque account actor mapping, derived on the server | ACCOUNT subject; no raw User, email, role claim or session     |
| VIDEO_STORAGE_WITHDRAWN / EXPERT_VIDEO_REVIEW_WITHDRAWN | Server-owned system:assignment-cancellation:v1               | CONSENT_SUBJECT from the actual retained withdrawal event/task |
| VIDEO_DELETED, worker discovers existing deletion       | The same system actor                                        | UNKNOWN; no invented attribution to an owner or moderator      |

ExpertActorIdentity is reused as the existing opaque account-actor map, not an
expert credential or role grant. Creating an owner actor mapping never creates
an expert credential. The worker has no fake staff/User account and grants no
private access. Context insertion verifies the current transaction witness,
terminal transition, authoritative resource/source/owner and executor/initiator
binding. It cannot retrofit context onto old transitions. Existing history is
never backfilled or recategorized.

## Withdrawal consumer and generation isolation

The independent worker consumes real ConsentWithdrawalTask records and verifies
the linked immutable event is OFF, with matching subject, purpose and version.
It does not require a new consent grant, current policy publication, staff MFA or
an active expert to restrict access. C034 already denies new issuance as soon as
withdrawal commits, before asynchronous cancellation is processed.

For review withdrawal, cancel only the owner's active assignments bound to that
subject with a review version older than the task. For storage withdrawal, scope
to that owner's videos with a storage generation older than the task. C033 never
creates new NULL bindings; legacy NULL bindings cannot authorize C034 playback
and are conservatively cancelled under a known owner/source without inventing a
grant or filling in a generation. A newer valid generation is never cancelled by
an old task. Mismatched/non-resolvable lineage is not repaired by this feature.

Review withdrawal cancels work but does not delete videos or disable owner storage
consent. Storage withdrawal object removal remains the existing VideoCleanupService
responsibility. This consumer does not depend on MinIO availability and performs
no provider I/O while holding assignment locks.

Each task batch handles at most 20 qualifying assignments. AssignmentWithdrawalReceipt
is inserted only when no qualifying active rows remain, in the same transaction.
It is a per-consumer historical completion, not authorization or an erasure claim.
Replay remains harmless even after live identity mapping removal. It never marks
the shared withdrawal task COMPLETE or edits another consumer's state. A missing
live mapping leaves pending work for reconciliation rather than guessing an owner.
Absent/cascaded assignments cannot receive fabricated retrospective transitions.

## Locks, retries and observability

Follow the C033/C034 global partial order: sorted User rows, Session if needed,
sorted Videos, credentials if needed, then sorted Assignments. Cancellation only
needs the owner User, relevant Videos and Assignments; it never acquires additional
expert User locks after a Video lock. Owner locking serializes it with assignment
creation, playback, reapproval and withdrawal. Locators authorize nothing and
relationships/state are reread under lock. No nested consent transaction is opened.

The native Nest worker runs every 15 seconds, scans up to 20 withdrawal tasks and
20 deleted videos, and continues after per-item failures. Missing mappings sort
behind mapped work. Successful receipts suppress repeat work; failed transactions
leave no receipt, so later scans retry from the durable source. Local scans coalesce;
row locks and receipts handle concurrent workers/processes. Tests drive runOnce
explicitly; only the scheduler is disabled in test mode, not authorization.

Scan failures/recovery, retry and missing mapping use fixed allowlisted log codes.
Raw driver/SDK errors, account/task IDs, media keys, URLs and contents are not logged.
The worker awaits an in-flight scan on shutdown. Operational reconciliation and
monitoring remain necessary for persistent failures; no new queue/Redis/Docker or
production retry SLA is claimed.

## Migration and remaining gates

20261118050000_assignment_cancellation_evidence is additive. Existing scalar
columns, migrations, events, bindings and idempotency receipts are unchanged.
New context and receipt tables use restrictive retained-evidence FKs and reject
UPDATE/DELETE/TRUNCATE. Historical schemas keep their original projections.
Tests deploy only fresh UUID schemas and verify a post-DDL failure rolls back.
No migration/reset is performed on the developer public database.

Opaque references remain potentially personal data. This technical preservation
is not an approved retention duration. Policy,
minimization, legal holds and backups need separate approval. C065 must cancel
and persist evidence/handoffs before cascading live resources or erasing mappings;
this feature adds no account lifecycle endpoint. Already-issued URLs may remain
valid until expiry and in-flight bytes cannot be recalled. Object erasure still
requires provider verification by the existing cleanup worker.

C051 is implemented for review on this branch. C054 remains incomplete: the real
C034 post-cancellation denial is checked, but complete revoke/delete versus
review edit/submit and QA/claim integration awaits those actual Phuc APIs. No
synthetic handler or missing API is presented as completed workflow acceptance.

## Executed verification

- PASS: Prisma validate/generate; API/Next production builds and both TypeScript lint commands.
- PASS: 247 unit tests; 309 API/PostgreSQL/native-storage integration cases across 23 suites, including 26 C051 domain cases and the additive migration rollback/upgrade case.
- PASS: two real Video Playwright cases desktop/mobile, including recording, upload, playback, deletion and withdrawal with native MinIO/API.
- The complete local integration run uses UTC connection options to avoid the pre-existing C034 timezone-fixture defect tracked in Phuc PR #17; no local .env/database timezone is changed. C051 additionally proves its own timestamps under a transaction-local UTC+7 timezone.
- NOT RUN: full review edit/submit C054 races, real MFA/policy publication and production storage/backup enforcement. No developer public-schema migration is run.
