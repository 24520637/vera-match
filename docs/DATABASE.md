# Data model — PostgreSQL and Prisma

> `apps/api/prisma/schema.prisma` is a **draft**. Run `prisma validate`, generate a migration, and review foreign keys, indexes, security constraints, and data-lifecycle behavior before using real user data.

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

## C012 DTO-to-Prisma mapping — PENDING REVIEW

The [Profile/Consent contract draft](PROFILE-CONSENT-CONTRACT.md) proposes API
types for C019-C024. These are not generated Prisma types, implemented routes,
approved schema changes or a completed C012 review. Existing tables and the
initial migration must be reused; do not recreate them to satisfy task IDs.

| Proposed API type | Existing storage | Mapping and boundary |
| --- | --- | --- |
| `ProfilePatchDto` / `ProfileReadDto` | `Profile` | Scalar fields map by name; server supplies `userId` from CurrentUser. `visibilityEnabled` already defaults false. Birth date API date-only versus Prisma DateTime serialization needs D5 approval. Proposed string arrays for interests/values narrow `Json?` through validation, not a schema guarantee. |
| `PreferencesPatchDto` / `PreferencesReadDto` | `MatchPreference` | minAge/maxAge/relationshipGoal map directly. Proposed dealBreakers/priorities arrays require an agreed JSON shape/catalog; Int?/Json? alone do not enforce adult bounds, min <= max or allowed values. |
| `QuestionnairePutDto` / `QuestionnaireReadDto` | `QuestionnaireAnswer[]` | Group rows by caller and questionnaireVersion. Existing composite unique key is `(userId, questionKey, questionnaireVersion)`; exactly three approved keys, ordering and version lifecycle require application/catalog validation. |
| `ConsentPatchDto` / `ConsentStateDto` | `Consent` | Existing purpose enum has five values, unique `(userId,purpose)` and granted=false. Server-owned timestamps map to grantedAt/revokedAt/updatedAt. Missing row => OFF projection is proposed; it is not an existing API behavior. |
| Auth `CurrentUser` / `AuthUser` | Safe selection from `User` | id/email/displayName/role only. User.displayName is not a Profile column. Do not return Prisma User/Session objects or mutate account fields through profile DTOs. |

### Existing schema gaps and review dependencies

- **Nullable JSON mapping (D2/D6/D8), PENDING REVIEW:** interests/values and
  dealBreakers/priorities use `Json?`. Database NULL and stored JSON null are
  distinct and may have different domain meanings; neither is automatically
  equivalent to an empty array. The draft's `string[] | null` DTOs do not decide
  which storage value API null represents, how reads normalize existing rows,
  or what PATCH null/[] persists. Huong must review these read/write semantics
  before implementation. No conversion or migration rule is chosen here.
- **Consent policy/history (D9):** Consent has no policyVersion, policy text
  reference or append-only transition relation. Its timestamps represent current
  state, not a complete sequence of grants/withdrawals. C023 explicitly requires
  policyVersion and event history; an approved persistence design may need an
  incremental migration later. No design or migration is selected by this draft.
- **Audit binding (D9/D10):** AuditLog currently has id, optional actorId,
  action, subjectType, optional subjectId and createdAt. It has no structured
  old/new-state or policy-version payload and does not guarantee typed,
  immutable consent transitions or foreign-key ownership. Review whether an
  extension or a dedicated event model is needed; enforce atomic state + audit
  persistence in the future feature. Do not claim the existing audit table
  already stores the evidence required by C023.
- **Catalogs and validation (D5-D8):** nullable strings/JSON and questionnaire
  uniqueness do not define three canonical questions, accepted vocabulary,
  limits, adult validation or age-range consistency. Add no duplicate models
  merely to express DTO validation; approve application versus DB enforcement.
- **Concurrency (D11):** these four resource models have updatedAt but no
  dedicated optimistic version. Do not describe timestamps as locking or invent
  conflict safety. Agree transactions/version/ETag/idempotency before deciding
  whether an additional constraint or migration is necessary.
- **Defaults/lifecycle (D2/D10):** User relations do not automatically create
  Profile/MatchPreference or five Consent rows. Decide lazy creation versus
  provisioning without changing registration implicitly. Existing cascading
  deletes do not establish an approved retention/audit-deletion policy.

C019 should inspect and verify the already-present relations/indexes before
proposing changes. C020-C024 remain responsible for API validation, permissions,
atomic writes, UI and acceptance evidence. C012 documents gaps only; it changes
neither Prisma schema/migrations nor Huong's authentication implementation.
