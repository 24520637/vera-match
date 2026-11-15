# Data model — PostgreSQL and Prisma

> Reuse the existing `apps/api/prisma/schema.prisma` and migration history.
> C019 chooses concrete schema/migration design, validates existing structures,
> and adds incremental migrations only for verified gaps. Never recreate the
> initial migration. Production security/data-lifecycle approval remains separate.

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

- Store video **objects** in private object storage; store only metadata and opaque keys in SQL. Signed URLs must expire quickly.
- Store **hashes** of session, activation and password-reset tokens, never raw token strings. Store password hashes using Argon2id.
- Canonicalize each pair as `(userLowId, userHighId)` to prevent duplicate reversed pairs.
- Check current consent at **query/access time**, not solely from stale cached flags.
- Subjective reviewer conclusions do not become scoreable claims. Factual claims require QA, owner confirmation, explicit sharing and no revocation.
- Document and enforce retention and deletion based on legal requirements and member promises; never assume indefinite storage is acceptable.

**Draft model gap:** Staff credential/eligibility and some workflow audit details are described as planned work but may require additional migrations. Do not treat a role flag as proof of reviewer qualification.

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
