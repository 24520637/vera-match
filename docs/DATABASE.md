# Data model — PostgreSQL and Prisma

> Reuse the existing `apps/api/prisma/schema.prisma` and migration history.
> C019 chooses concrete schema/migration design, validates existing structures,
> and adds incremental migrations only for verified gaps. Never recreate the
> initial migration. Production security/data-lifecycle approval remains separate.

## C035 PA2 persistence and reader

Migration `20261118120000_assignment_moderator_grants` adds explicit per-assignment
metadata scope. It backfills no authority and changes no C031-C034 lifecycle.
`AssignmentModeratorScope` is unique by retained assignment ID and opaque moderator
subject, with independent revision/CAS and a nullable current lifecycle pointer.
`AssignmentModeratorGrantEvent` is append-only: GRANTED starts a new UUID lifecycle;
REVOKED refers to that original grant. Every event has mandatory finite expiresAt
(TIMESTAMPTZ(3)); grants must expire after actual PostgreSQL insertion time. Audit
recording time is always database-owned. Revocation retains the original expiry,
even when it has passed. A valid grant must be revoked before replacement; after
expiry a new lifecycle may replace its pointer. Old lifecycles can never be rebound.

Scope changes advance revision exactly once and require matching events in the
same transaction via database-owned witnesses and deferred constraints. The current
pointer FK is deferred so state and history can be written atomically. Standalone
DELETE/TRUNCATE cannot reset scope revisions; events cannot be changed or removed.
Services must still use expectedRevision CAS and the agreed global lock order.

Scopes reference ExpertAssignmentIdentity, not the cascading live assignment.
Moderator subjects are retained opaque UUIDs, resolved from the existing live
ExpertActorIdentity only by a future trusted service. User/Video deletion preserves
history; loss of the live mapping gives no authority and a new account subject
cannot inherit old grants. No retention period or production erasure policy is
approved by this stage. These models do not establish ADMIN provisioning or MFA.

Stage 1 implements persistence tests. Stage 2 adds an internal grant/revoke service
with exact ADMIN authorization boundaries, revision CAS and atomic success audit.
Stage 3 adds grant-filtered moderator queue reads with atomic minimal read audit.
External grant mutation DTOs and HTTP idempotency remain future integration work;
no proposed route is an approved or implemented external contract. Moderator queue
uses valid per-assignment grants, not creator identity. Empty membership is an empty
queue. Default trusted provisioning/MFA sources remain unavailable; explicit
production gates still prevent real-data authorization.

The service never changes these Stage 1 tables/triggers. Trusted provisioning and
session-bound MFA providers default-deny; synthetic proofs are test-only. Mutation
evidence retains an opaque actor subject, server provisioning reference and MFA
verification/expiry times, not tokens or raw private data. Mandatory expiry and
fresh PostgreSQL time remain authoritative. Missing scopes use virtual revision 0;
revocation removes only the explicitly identified current lifecycle. No HTTP
idempotency or automatic retry is implied by the internal CAS service.

Queue readers serialize with grant/revoke through the same moderator User lock,
then Session, and join only the current live identity/current unrevoked grant.
PostgreSQL expiry filters apply before status/cursor pagination; a fresh post-audit
clock prevents returning selected grants that expired during the audit. Reads do
not change scope/assignment revisions or create missing identities. Deleted/recreated
accounts cannot inherit retained opaque scope evidence. No schema/migration changes
are needed in Stage 3, and no C050/C051 behavior is added.

| Area | Models | Why they exist |
| --- | --- | --- |
| Identity and sessions | `User`, `Session`, `EmailVerificationToken`, `PasswordResetToken` | Verified email, account status, token hashes, session revocation |
| Member data | `Profile`, `MatchPreference`, `QuestionnaireAnswer`, `Consent` | Member attributes, versioned answers, five privacy purposes |
| Private media | `Video` | Object metadata and authorization state, not video bytes |
| Expert review | `ExpertAssignment`, `ExpertReview`, `ExpertObservation` | Assigned jobs, drafts, timestamps, QA/version tracking |
| Claims and disputes | `ReviewClaim`, `ReviewDispute` | Factual claim approval, owner permission/withdrawal and feedback |
| Connections | `MatchPair`, `MatchDecision` | Canonical pairs and both users' decisions |
| Trust and safety | `Block`, `Report`, `AuditLog` | Blocking, member reports, scoped moderation, redacted audit data |

## Data and security invariants

### C033 additive assignment persistence

`20261118010000_assignment_consent_and_idempotency` adds paired nullable
reviewConsentSubjectId/reviewConsentVersion to ExpertAssignment. Existing rows
remain NULL without invented grants; the new API supplies both. A CHECK bounds
the version, a RESTRICT FK binds the retained ConsentSubject, and an UPDATE trigger
prevents rebinding. The existing C031 event snapshot projection includes the new
columns for new mutations without rewriting prior events.

AssignmentIdempotency has a PostgreSQL composite primary key on actorSubjectId,
operation and keyHash; canonical fingerprint, original assignment ID/result and
createdAt commit with assignment/event/audit. Its assignment reference targets the
independent ExpertAssignmentIdentity registry, so Video/account deletion cannot
cascade-delete receipts or release keys. UPDATE/DELETE/TRUNCATE are denied.
No automatic expiry or production retention period is introduced. Production use
and retention/de-identification still require review; see [Assignment API](ASSIGNMENT-API.md).
All earlier migrations, C031 lifecycle constraints and C051 ownership are preserved.

- Store video **objects** in private object storage; store only metadata and opaque keys in SQL. Signed URLs must expire quickly.
- Store **hashes** of session, activation and password-reset tokens, never raw token strings. Store password hashes using Argon2id.
- Canonicalize each pair as `(userLowId, userHighId)` to prevent duplicate reversed pairs.
- Check current consent at **query/access time**, not solely from stale cached flags.
- Subjective reviewer conclusions do not become scoreable claims. Factual claims require QA, owner confirmation, explicit sharing and no revocation.
- Document and enforce retention and deletion based on legal requirements and member promises; never assume indefinite storage is acceptable.

**C031 database foundation:** Staff credentials and assignment history are described below.
This does not implement eligibility approval, assignment APIs or authorization.
Do not treat a role flag as proof of reviewer qualification.

## C031 - approved credential and assignment database decisions

Scope: T06/C031, `feat(expert-db): add credentials and assignments`.
The project owner supplied Huong's seven approved design decisions for this
implementation. This records technical direction, not production retention approval.
The reviewed integration baseline is `4ec54b187c4a2b934cf422b41d501d5b8052dc5d`,
which already includes T04. This review fix does not integrate any additional
branch or modify existing T04 migrations/services.

| Approved decision | Persistence design |
| --- | --- |
| One current credential; immutable qualification evidence | `ExpertCredential` uses userId as primary key and a separate UUID subject. `ExpertCredentialApproval` retains each distinct approval with training/policy versions, private evidence, verifier/approver evidence, timestamps and optional expiry. `ExpertCredentialEvent` records creation, training, confidentiality, verification, approval and reasoned revocation. |
| Approved lifecycle and reassignment | Existing `ExpertAssignment` remains; SQL enforces ASSIGNED -> IN_PROGRESS -> SUBMITTED, SUBMITTED -> IN_PROGRESS/COMPLETED, and any active state -> CANCELLED. CANCELLED/COMPLETED cannot be reopened or edited. Reassignment cancels the old row and creates a new one in one transaction. dueAt is a scheduling deadline; expiresAt is an independent optional access-expiry boundary. |
| One active primary assignment per video | PostgreSQL partial unique index `ExpertAssignment_one_active_video` covers ASSIGNED, IN_PROGRESS and SUBMITTED. All assignments currently represent primary work; no secondary-assignment feature is introduced. |
| Independent revisions/history | Credential and assignment revisions are separate BigInt counters, initial 0, bounded by Number.MAX_SAFE_INTEGER. Updates advance exactly once. SQL requires matching append-only events in the same transaction. Each new assignment is bound to a particular approval instance, never automatically rebound on reapproval. |
| Nullable assignment actor FK | assignedById references User with ON DELETE SET NULL. `ExpertActorIdentity` maps known legacy assigning users to opaque subjects; assignedByEvidence retains that subject independently. Mapping deletion follows User deletion, not evidence deletion. FK existence never proves authority. |
| Preserve existing deletion chain | Video -> ExpertAssignment -> ExpertReview cascade is unchanged. New approvals/events have no cascading FK through User, Video, current credential or assignment. Approval references use RESTRICT. |
| Preserve integration ownership | No Auth/AuditLog/video/storage/privacy module is changed. READY/current consent, active eligibility, staff MFA, independent QA and withdrawal integration remain mandatory future API checks. |

### Write protocol and evidence

PR #12 identity-reuse corrections are delivered by the separate additive migration
`20261117010000_prevent_expert_identity_reuse`; published migrations are unchanged.
`ExpertAssignmentIdentity` reserves every issued assignment ID independently of
live resources. It is seeded from existing assignments and retained events, is
append-only (including TRUNCATE protection), and has no cascading foreign keys.
An INSERT trigger reserves the ID transactionally using a primary key, preventing
DELETE/recreate revision resets and concurrent reuse. Failed creations roll back
their reservations. Video deletion still cascades to assignments/reviews, while
reservations and existing evidence survive. Previously deleted IDs with neither
a surviving assignment nor retained event cannot be reconstructed retrospectively.
Actor mappings reject independent DELETE while the User exists and reject TRUNCATE;
actual User deletion may still cascade without deleting retained actor evidence.
These are integrity protections, not approval of a production retention period.

Credential creation starts PENDING at revision 0 with a CREATED event. No role or
legacy row is auto-approved. Future approval creates a new immutable approval
snapshot, changes current state with expectedRevision CAS and appends an APPROVED
event in one transaction. Reapproval cannot reuse the old approval ID or revive
terminal assignments. A REVOKED event retains revokedAt and a nonblank reason.
Training/confidentiality events require the corresponding version; verification
events retain verifiedAt and verifying actor evidence. Expiry is evaluated at
authorization time; no expiry worker or default duration is introduced here.

Future mutation code must authorize first, update current state with
`WHERE revision = expectedRevision`, require exactly one affected row, then append
the matching event before commit. A zero-row CAS must become HTTP 409 at the future
API boundary; C031 adds no HTTP endpoint/error mapper or automatic retry.
AssignmentEvent.snapshot matches the database row projection excluding assignedById,
expertId and the internal eventFromStatus/eventTransactionId witness fields.
The assignment write trigger derives the old status and current PostgreSQL
transaction ID; event insertion must match that actual mutation and from/to status,
revision and approval ID. Callers cannot supply their own witness: the trigger
overwrites it. Legacy revision 0 has no witness; reading or FK identity cleanup
cannot authorize retroactive events. Events cannot be inserted for absent/future
state or independently in a later transaction. Deferred constraint triggers reject a current
state write without its event. Transaction failure rolls back both. FK SET NULL
identity minimization is a narrow exception: it preserves domain revision and
retained evidence without fabricating a new assignment transition.

AssignmentEvent.createdAt and ExpertCredentialEvent.createdAt are audit recording
times controlled by PostgreSQL BEFORE INSERT triggers. Caller values, including
past/future timestamps, are unconditionally overwritten with
`clock_timestamp() AT TIME ZONE 'UTC'`, stored at millisecond precision. This is
insertion time, not transaction-start CURRENT_TIMESTAMP or caller clock time,
and does not depend on the session timezone. Existing verifiedAt/revokedAt and
approval evidence fields describe separate business facts; no extra historical
time field is introduced. Append-only protections continue to prevent later edits.

Standalone DELETE of a current credential while its User still
exists is rejected, as is TRUNCATE. This prevents credential DELETE/recreate from
resetting CAS revision for the same live account. Existing User DELETE cascades
still remove these live mappings after the parent disappears, without deleting
retained approvals/events. This adds no account-deletion endpoint or retention
period; privileged maintenance remains subject to separately approved procedures.

Evidence uses either `{kind: "PRIVATE_REFERENCE", bucket, objectKey}` without a
public URL, or `{kind: "SNAPSHOT", content, sha256}` with a verified UTF-8 SHA-256
digest. Only those envelope fields are accepted. Private-reference existence and
object immutability require later storage verification; a locator alone is not
proof of durable evidence. Future servers must derive actors, never accept
client-provided evidence as proof of approval or independent QA authority.

SQL triggers reject UPDATE/DELETE/TRUNCATE of approvals/events. They protect
against application writes, not privileged administrators disabling triggers.
Production privileges, evidence access, retention/expiry/holds and backup
enforcement require separate review. Opaque subjects/locators remain potentially
personal data, not anonymous data. No production hard-delete endpoint, indefinite
retention policy or purge exception is introduced. Existing expert FK restrictions
also remain in effect.

### Additive migration and legacy boundary

`20261116120000_add_expert_credentials_and_assignment_revision` follows the existing
initial migration. It runs transactionally and fails without rewriting data if
legacy active assignments duplicate a video or assignedById is orphaned. An
operator must review remediation separately before deployment.

Legacy assignments retain status, IDs and data at revision 0. Only the known
assignedById fact is mapped to an opaque subject, with source LEGACY_ASSIGNED_BY_ID;
no name, email, role-at-assignment, qualification or approval is inferred/copied.
The live reverse mapping cascades with User deletion while retained actor subjects
survive in assignedByEvidence, including terminal assignments. Opaque evidence is
still potentially personal data; no retention/de-identification policy is newly
approved here. Approval remains null with no invented transition history. Their first future
mutation must append revision 1 evidence; unknown historic approvals cannot be
silently retrofitted. Future access must fail closed for missing bindings.
Nullable schema fields support this boundary; new inserts require approval binding
and actor evidence. Indexes/triggers/check constraints are partly SQL-only: Prisma
schema/client generation alone cannot verify them.

API eligibility (including revocation/expiry), READY/current consent, independent
QA and MFA are not enforced by FK existence or these structural checks. Later
features must implement/test them. Retention, storage/backup guarantees and signed
URL provider enforcement remain pre-production gates under C012.

## C012 DTO-to-Prisma mapping - approved MVP contract, not implemented

Huong technically approved reviewed commit
`b25e4d6d93823f560ae3fc8be443313902097abd` as the MVP implementation/testing
contract, with no further technical corrections in this review round.
The [Profile/Consent contract](PROFILE-CONSENT-CONTRACT.md) separates that
technical baseline from PRE-PRODUCTION retention/legal, storage/backup and
signed-URL provider verification gates. These DTOs are not generated Prisma
types or implemented routes. C019 selects concrete persistence design, reuses
existing models/migrations and never recreates the initial migration.

| Proposed API type | Existing storage | Mapping and boundary |
| --- | --- | --- |
| `ProfilePatchDto` / `ProfileReadDto` | `Profile` plus future independent revision storage | Fields map by name with server userId; visibility defaults false. Wrapper revision/request expectedRevision have no existing column/mechanism. Date/age and catalogs are approved MVP rules; no silent legacy reinterpretation. |
| `PreferencesPatchDto` / `PreferencesReadDto` | `MatchPreference` plus future independent revision storage | expectedRevision gates the complete merged write, separately from profile/consent counters. Json?/Int? alone do not enforce catalogs/ranges. |
| `QuestionnairePutDto` / `QuestionnaireReadDto` | `QuestionnaireAnswer[]` plus future independent questionnaire revision | Existing unique key is (userId,questionKey,questionnaireVersion). Catalog version is not editing revision; member questionnaire revision covers edits across catalogs. Atomic all-three PUT and retired read-only access still apply. No current revision/CAS mechanism exists. |
| `ConsentPatchDto` / `ConsentReadDto` / `ConsentStateDto` | `Consent` plus proposed revision/event storage | Existing enum has five values, unique `(userId,purpose)` and granted=false. Missing row => OFF projection is accepted review direction, not an implemented API. Current schema has neither policyVersion nor aggregate version/expectedVersion enforcement; retained timestamp/policy rules are approved MVP contracts. |
| Auth `CurrentUser` / `AuthUser` | Safe selection from `User` | id/email/displayName/role only. User.displayName is not a Profile column. Do not return Prisma User/Session objects or mutate account fields through profile DTOs. |

### Existing schema gaps and review dependencies

- **Nullable JSON mapping (D2), approved for MVP:** interests/values
  and dealBreakers/priorities use `Json?`; database NULL and JSON null remain
  distinct in storage. PATCH null writes database NULL, [] writes a
  JSON empty array and omission leaves storage unchanged. GET projects
  either null representation as API null without backfill. Legacy object/scalar/
  invalid arrays are not silently rewritten or discarded; the MVP contract requires
  sanitized 503 DATA_SHAPE_UNAVAILABLE with only allowlisted affected field paths
  and current revision. Validate the complete resulting resource, not just
  submitted keys; untouched malformed fields fail atomically, never get silently
  repaired. Explicit owner corrections require current expectedRevision;
  unsupported cases need separately approved operator remediation.
  Such malformed rows cannot be dependencies of withdrawal:
  consent authorization/transactions must not load their API projections.
  No conversion, migration or backfill is performed by this documentation.
- **Consent policy/history (D9):** Consent has no policyVersion, policy text
  reference or append-only transition relation. Its timestamps represent current
  state, not a complete sequence of grants/withdrawals. C023 explicitly requires
  policyVersion and event history; an approved persistence design may need an
  incremental migration later. No design or migration is selected by this draft.
- **Audit binding (D9/D10):** Atomic current-state + immutable-event persistence
  is accepted review direction, but not implemented. AuditLog currently has id,
  optional actorId, action, subjectType, optional subjectId and createdAt. It has no structured
  old/new-state or policy-version payload and does not guarantee typed,
  immutable consent transitions or foreign-key ownership. Review whether an
  extension or a dedicated event model is needed; enforce atomic state + audit
  persistence in the future feature. Do not claim the existing audit table
  already stores the evidence required by C023. Candidate evidence includes
  old/new consent state, accepted policy, actor/member/purpose, server time,
  operation kind and old/new aggregate consent version. Concrete storage/immutability enforcement needs implementation review;
  real-data retention and production access/storage policy need explicit approval.
- **Policy evidence and append-only enforcement (D9):** current schema has no
  immutable policy content/snapshot, versioned digest/algorithm/locale binding,
  protected event-to-evidence reference or append-only event permissions. A
  registry label/hash without a recoverable corresponding snapshot is not
  sufficient. Preserve verifiable accepted policy evidence for referencing
  events' approved retention, independent of registry retirement. Physical
  storage/canonicalization and access controls need implementation review;
  no schema change is made by C012.
- **Audit subjects/deletion safety (D9/B):** AuditLog currently has no User FK,
  so do not claim it currently cascades; Consent/member tables do cascade.
  That absence is not a complete retained-evidence design. Future events must
  have no cascading deletion path through User/Consent/policy registry. Use
  independent subject/actor references with a separately controlled identity
  mapping and restrictive evidence deletion rules. Approved mapping erasure/
  minimization must not rewrite immutable events. Pseudonymous data may remain
  personal data; retention/holds, legal basis and mapping lifecycle need approval.
  Verify hard User deletion preserves unexpired events and policy snapshots.
- **Catalogs and validation (D5-D8):** nullable strings/JSON and questionnaire
  uniqueness do not define three canonical questions, accepted vocabulary,
  limits, adult validation or age-range consistency. Add no duplicate models
  merely to express DTO validation; approve application versus DB enforcement.
- **Concurrency/idempotency (D11), approved MVP contract / persistence design pending:** these models have updatedAt
  but no dedicated write-conflict revision. The MVP contract requires one per-member
  aggregate consent version, virtual initial 0, required request expectedVersion
  and transactional CAS of state/version/immutable events. Every accepted consent
  mutation, including already-OFF reaffirmation, advances it to block stale grants;
  stale versions require 409 VERSION_CONFLICT. A unique per-member revision and
  atomic conditional updates need a reviewed later persistence design; purpose
  deletion must not reset it. Consent version is not questionnaireVersion.
  Separately, accepted technical direction requires independent member/resource
  revisions for Profile, Preferences and Questionnaire, wrapper revision and
  mutation expectedRevision, atomic CAS/increment and stale-write 409. Neither
  updatedAt nor questionnaireVersion substitutes. Revision metadata survives
  active-account row clears, uses virtual initial 0 without GET provisioning
  and serializes first writes. Review per-row versus independent metadata,
  legacy initialization and constraints before later migrations; no duplicate
  tables or schema changes are made here.
- **Idempotency evidence (D11):** no model currently provides scoped
  Idempotency-Key uniqueness, payload fingerprint, operation version/result or
  replay semantics. MVP deduplication result records expire after 24 hours but cannot
  reset the aggregate version or duplicate audit events. Lookup/CAS/state/event/
  result writes need one approved transactional design. Concrete fields/storage design remain C019 work; real-user retention needs
  policy approval. Replay semantics are approved for MVP, not implemented here.
- **Catalog provenance (A):** current JSON/string/questionKey fields do not
  store an approved product-catalog revision or canonical questionnaire prompts.
  Approved MVP IDs/prompts are not existing persisted product data. Retired questionnaire
  versions must remain read-only; future catalog storage/validation and any
  needed provenance migration require review, not duplication of current tables.
- **Retention and deletion (B):** existing cascade FKs, Video.deletedAt and
  account statuses are not a durable cleanup/retention implementation. There is
  no job/outbox, retry/deadline/evidence model or backup deletion-suppression
  ledger in the current schema. Candidate per-category schedules, audit
  identity-mapping erasure, idempotency purge and retention evidence need policy/privacy/legal
  approval before later migrations. Immutable audit means no editing while
  retained; any approved expiry purge is privileged, not ordinary event CRUD.
  Account deletion preserves unexpired append-only audit/policy evidence outside
  User cascades while approved mapping erasure/backup suppression is enforced.
  The candidate 365-day audit period is not an approved expiry or lawful basis;
  do not invent an indefinite legal hold because policy sign-off is missing.
- **Signed media capabilities (C):** Video has metadata, not per-URL revocation,
  issued-capability tracking or guaranteed provider invalidation. The approved MVP
  60-second playback TTL/cache/issuance controls are Huong-owned future media
  work. Do not claim current DB flags instantly revoke outstanding object URLs.
- **Defaults/lifecycle (D2/D10):** User relations do not automatically create
  Profile/MatchPreference or five Consent rows. GET non-provisioning/defaults
  are accepted direction; first-write lazy creation and virtual version behavior
  are approved MVP contracts, not registration changes. Existing cascading
  deletes do not establish an approved retention/audit-deletion policy.

C019 will choose concrete schema/migration design after inspecting and verifying
already-present relations/indexes. Reuse existing migrations and never recreate
the initial migration; add incremental changes only for verified gaps. C020-C024 remain responsible for API validation, permissions,
atomic writes, UI and acceptance evidence. C012 documents gaps only; it changes
neither Prisma schema/migrations nor Huong's authentication implementation.
