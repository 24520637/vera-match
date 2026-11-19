# Verification and acceptance test matrix

Each feature needs valid inputs, invalid inputs, unauthorized access, state/race tests, UI feedback states, and audit/revoke behavior when relevant.

## C035 assignment queues and PA2 integration (partial)

PA2 Stage 1 persists assignment-specific moderator grants with mandatory expiry,
monotonic revisions and append-only lifecycle evidence. The database/migration
suites use disposable PostgreSQL and cover fresh deployment, upgrade preservation,
rollback after DDL, deletion evidence, CAS and regrant lifecycle rules.

PA2 Stage 2 provides internal grant/revoke service operations. Authorization
requires an ACTIVE, verified ADMIN and transaction-bound provisioning/MFA sources;
missing production providers fail closed. The external grant/revoke HTTP contract
is not implemented. Stage 3 reads moderator queues only through current,
unrevoked, unexpired assignment-specific grants, before status filtering and cursor
pagination. Queue reads are audited and serialized with grant/revoke; responses
contain only assignment metadata. Creator ownership, wildcard and global access are
never fallbacks. Production moderator reads return 503
`MODERATOR_QUEUE_PROVISIONING_UNAVAILABLE` while trusted provisioning is absent.
The candidate endpoint remains unavailable outside the isolated test environment.

`assignment-grants-database.integration-spec.ts`,
`assignment-grants-migration.integration-spec.ts`,
`assignment-grants-service.integration-spec.ts` and
`moderator-assignment-queue.integration-spec.ts` use synthetic providers and
UUID-scoped disposable schemas only. They cover role/account/session checks,
provider outages, expiry, audit rollback, cross-scope pagination, forged scope
claims and read/revoke lock orderings. Synthetic assurance, provisioning, policy
and evidence fixtures never establish production access.

The expert and moderator queue UI uses the existing session and API client
patterns. Browser component tests use HTTP contract mocks, not full-stack browser /
PostgreSQL E2E. C033 assignment confirmation retains the original payload and
idempotency key for manual retry. C051 cancellation and its migrations are
integrated from develop; C034 playback authorization and the merged timezone
regression fix are integrated. C051 tests cover owner deletion, consent withdrawal,
queue metadata, grant evidence retention and playback denial after cancellation.

C035 remains **PARTIAL**. Production trusted ADMIN provisioning, real
session-bound MFA and approved evidence providers are unavailable; the external
grant/revoke HTTP contract and full-stack queue E2E remain open. C050 review
editing/submission and Safety Report moderation are outside this feature. Do not
claim production readiness or weaken the default-deny gates.
## C036 - cancellation and reassignment race acceptance

Plan-Step: C036. Ticket: T06. Planned subject:
`test(expert-assign): test cancel and reassignment races`.

Original scope (`5deaf06:docs/COMMIT-PLAN.csv`): "Transitions, version and audit
tests". Verification: "Canceled assignment access rejected". The ten original
C036 cases remain intact: four database race/rollback cases, three historical
receipt cases and three cancelled-playback cases. Acceptance is limited to these
requirements and combined upstream regression evidence, not production readiness
or completion of all T06 features. Execution results and PR approval are reported
separately; this document does not assert a successful future run or PR merge.

Implemented test scope uses disposable PostgreSQL and existing C033/C034 APIs:

- `assignment-races.integration-spec.ts` observes actual PostgreSQL assignment lock
  contention before releasing the winner. Verify both advance/cancel CAS outcomes,
  one complete replacement, exact revisions/from/to/snapshots, no loser event or
  ID reservation, and append-only history. These are DB fixtures, not authorization
  or a production cancellation/reassignment service.
- Deliberately omit the replacement event only after cancellation, replacement and
  reservation writes succeed. Deferred COMMIT failure must roll everything back;
  a later valid transaction can reuse the rolled-back reservation.
- C036 cases in `assignment-api.integration-spec.ts` cancel valid assignments from
  each active state via DB fixtures, create a new assignment using C033, and replay
  the old key concurrently. Original receipts never change the cancelled history,
  replacement, audit count or idempotency results; changed payload still returns 409.
  Separate cancel/create operations do not establish atomic HTTP reassignment.
- C036 cases in `assignment-access.integration-spec.ts` call actual playback HTTP
  after valid DB cancellation from each active state. Expect 403/private headers,
  no signer call/success audit, and unchanged row/revision/events/receipts.
- Existing C031-C034 suites remain regression coverage for lifecycle, unique active
  assignments (including SUBMITTED), authorization, generation, rollback and expiry.

C051 is implemented upstream through PR #19 and is now integrated into this branch.
Run `assignment-cancellation.integration-spec.ts` and
`assignment-cancellation-migration.integration-spec.ts` alongside C036. They cover
actual owner DELETE and withdrawal consumers, generation isolation, cancellation
CAS, audit rollback, worker contention/retry and migration preservation. Actual
C034 playback succeeds before owner deletion and is denied after atomic C051
cancellation. These tests supplement, rather than relabel, the C036 DB fixtures.
The C033 deletion/replay regression must retain C051's CANCELLED/revision/event
expectations and the unchanged historical creation receipt.

C034's UTC/non-UTC deadline fix is integrated from develop through merged PR #17;
retain its bounded waits and connection-setting restoration checks. No published
migration or production authorization behavior is changed by C036.

Manual cancel/reassign HTTP APIs, their transport authorization/idempotency
contracts, and C035 PA2 administration are outside the original C036 test scope.
Their absence does not block this acceptance and does not authorize creating them
here. Review edit/submit races belong to later review work with C050 coordination.
Real production MFA/provisioning/evidence and provider/retention acceptance remain
separate gates. Signed URLs already issued may remain usable until expiry; test
results do not imply immediate URL revocation or physical deletion.

Validation: run the C036 race suite, C033/C034 API suites, C051 domain/migration
suites and relevant C031/C032/Consent/Auth regressions against disposable schemas.
Record executed/skipped checks explicitly; CI and human review are still required
before merging PR #20. No dependency on unmerged C035 code is introduced.

## C034 - assignment-bound expert playback

Contract: [EXPERT-PLAYBACK-API.md](EXPERT-PLAYBACK-API.md). Run
`test/assignment-access.integration-spec.ts` against disposable PostgreSQL schemas.
Synthetic MFA/evidence and local SigV4 signing are not production acceptance.

- Verify session/role/IDOR denials, identical missing/foreign 404s, strict empty
  JSON, Origin policy, private headers and independent rate limits.
- Verify ASSIGNED/IN_PROGRESS only, READY/non-deleted video, eligible owner/expert,
  current approval binding, bilateral blocks, expiry and authoritative generations.
- Withdrawal/re-consent must not resurrect either storage or review authorization.
- Verify expiry after evidence I/O and observed PostgreSQL lock contention; failures
  return no URL or success audit. Audit failure prevents signing and rolls back.
- Parse actual SigV4 date/TTL and compare exact returned expiry; test every TTL
  bound, insufficient time, invalid TTL rejection and owner default 60 seconds.
- Run C031/C032/C033, Auth, Consent and Video regressions. Real MinIO suites require
  the service; record NOT RUN when unavailable. C051 is integrated: run the real
  cancellation/domain/migration suites and their C034 post-cancellation checks.
  Review edit/submit concurrency remains outside these implemented routes.

## C033 - READY video assignment

Contract: [ASSIGNMENT-API.md](ASSIGNMENT-API.md). Use synthetic qualification and
policy providers in disposable PostgreSQL schemas only; no production MFA bypass.

- Deny non-MODERATOR/inactive/unverified/revoked/expired sessions and forged fields.
- Require READY/non-deleted video, eligible owner, both authoritative consents,
  valid storage generation, eligible expert, approved current credential/evidence,
  no self-review and no bilateral block. No invented availability/workload quota.
- Check credential revision, approval/evidence expiry, explicit null/future UTC
  dates, dueAt <= expiresAt and qualification validity ceilings.
- Let session, qualification, evidence and assignment dates expire during source
  I/O or a proven User-lock wait; use a fresh PostgreSQL clock immediately before
  mutation and assert no assignment/event/success audit/idempotency receipt.
- Persist review subject/generation; prove withdrawal/re-grant never validates the
  old generation. Preserve C031 immutable snapshot/event/ID-reservation protections.
- Same actor/key/canonical payload replays the original receipt with no new event;
  different payload conflicts, other actors have independent key scopes. Replay
  after soft/hard video deletion or withdrawal must not recreate or authorize work.
- Concurrent duplicates have one event; competing creates have one winner/409;
  SUBMITTED remains active. Race against real owner deletion, consent withdrawal
  and reapproval using deterministic test barriers under the shared locks. Observe
  pg_blocking_pids/pg_stat_activity contention before release; test the competing
  transaction held before COMMIT as well as assignment-first ordering, including
  withdrawal/re-consent generation and historical-receipt consequences.
- Inject failure on final receipt persistence; verify rollback of assignment,
  event, issued-ID reservation, audit and idempotency result. No automatic retry.
- Fresh migration and upgrade preserve old data/events with NULL legacy bindings;
  deliberately fail after DDL and assert rollback. Redeploy is a no-op.
- Run C031/C032/T04/Auth/Video regressions, Prisma, TypeScript, builds and diff checks;
  report missing SMTP/MinIO services as NOT RUN, not successful provider acceptance.

```text
npm run test:integration --workspace apps/api -- --runTestsByPath test/assignment-api.integration-spec.ts test/assignment-migration.integration-spec.ts
```

## C032 - moderator expert approval

Contract: [EXPERT-APPROVAL.md](EXPERT-APPROVAL.md). Tests use server-injected
synthetic versions/evidence and UUID-owned disposable PostgreSQL schemas only.
The default application providers remain closed even when NODE_ENV=test.

- Deny MEMBER self-approval, EXPERT and ADMIN (403, no role inheritance); deny
  missing/revoked/expired/inactive/unverified moderator sessions (401).
- Require an existing ACTIVE verified EXPERT; never create/activate/change a User.
- Reject unapproved versions, unavailable/mismatched/expired/future evidence,
  forged authority/hash/timestamp fields, bad Origin/JSON and query overrides.
- Preserve actual recoverable evidence snapshots and server-calculated SHA-256,
  opaque actor identity, server timestamps and immutable approval/event history.
- Cover null/future expiry and both evidence validity ceilings; no default expiry.
- Cover first approval, existing pending credential, reapproval after revocation,
  stale revision and concurrent initialization/reapproval (one winner, one 409).
- Inject a final audit INSERT failure to prove rollback of initialization, actor
  mapping, approval and all events; retain cancelled assignments and old bindings.
- Verify private/no-store errors/success and separate quotas with 429 Retry-After.
- Run C031 migration/database, T04, Auth, unit, Prisma, TypeScript and build checks.
  No synthetic test result establishes production evidence approval or real MFA.

```text
npm run test:integration --workspace apps/api -- --runTestsByPath test/expert-approval.integration-spec.ts
```

## C031 - credential and assignment database foundation

PR #12 identity-reuse regression coverage must reproduce CANCELLED revision 1
DELETE/recreate as ASSIGNED revision 0 on the reviewed schema, then reject that
operation after the additive fix. Verify reservation backfill for both live and
deleted assignments with retained events without changing their evidence. Verify
ID reservations survive Video/Assignment/Review cascades and cannot be deleted or
truncated. Reject actor mapping DELETE/recreate and TRUNCATE for a live User, while
allowing real User deletion and preserving historical opaque actor evidence.

Plan subject: `feat(expert-db): add credentials and assignments` (T06).
The seven approved decisions and remaining integration/production boundaries are
recorded in [DATABASE.md](DATABASE.md#c031---approved-credential-and-assignment-database-decisions).

- Apply all existing plus additive migrations to a fresh disposable schema.
- Upgrade initial-migration fixtures without losing users, videos, assignments or
  reviews; create no fabricated historic approvals/events. Re-deploy is a no-op.
- Legacy duplicate active assignments/orphan actors stop migration atomically;
  no automatic repair, winner selection or data deletion.
- Inject a failure after DDL/backfill execution; assert tables, types, indexes,
  added columns and data changes roll back, not merely a preflight failure.
- Exactly one current credential per expert; FK/approval-subject checks; retain
  immutable training/confidentiality versions, verification/approval actors,
  timestamps/expiry, revocation reason and distinct reapproval instances.
- Reject public evidence URLs and incorrect snapshot hashes. No storage durability
  guarantee is inferred from accepting a private object locator.
- Exercise every approved lifecycle edge, terminal states, stale CAS, revision
  jumps, transaction rollback and binding immutability. dueAt and expiresAt differ.
- Concurrent inserts hit the PostgreSQL partial unique index; concurrent CAS
  transitions/credential updates have exactly one winner. Reassignment is atomic.
- State and matching event commit together; reject orphan history. Reject
  UPDATE/DELETE/TRUNCATE of newly retained evidence/history.
- For both event tables, commit valid mutations with caller-supplied past/future
  createdAt values and assert persisted recording time is within database-clock
  bounds. A delayed transaction must record insertion time, not transaction start;
  verify UTC behavior under a different session-local timezone. No unrelated
  validation rejection may count as timestamp enforcement evidence.
- Reject standalone legacy revision-0 events and wrong from/to history even with
  an otherwise matching snapshot. A real mutation with correct history succeeds.
- Negative tests supply matching events and assert the intended database error;
  CAS race losers must report the explicit revision conflict, not arbitrary failure.
- assignedById uses FK SET NULL without losing retained evidence. Existing
  Video -> Assignment -> Review cascade still works; new history/approvals survive
  that cascade and current-credential/account deletion in disposable fixtures.
- Upgrade legacy active/terminal assignments, delete their assigning User and
  verify opaque actor evidence survives, reverse mapping disappears, and no
  qualification/approval or transition event is fabricated.
- Reject credential DELETE/recreate and TRUNCATE CAS resets for a live account;
  real User deletion cascades still work without losing immutable evidence.
- Run Prisma validate/generate, TypeScript, API build, API unit and available
  existing integration regressions; report unavailable SMTP checks honestly.
- Test only synthetic data in UUID-named schemas on a verified disposable local
  PostgreSQL. Verify cleanup and `git diff --check`; never reset public/shared data.

Focused commands after configuring a disposable test database:

```text
npm run test:integration --workspace apps/api -- --runTestsByPath test/expert-database.integration-spec.ts test/expert-migration.integration-spec.ts
npm run prisma:validate
npm run prisma:generate
```

This is database evidence only, not HTTP 409 implementation, moderator approval,
independent QA authorization, video READY/consent/MFA enforcement, signed URL
revocation, privacy cleanup or production retention approval. C032-C036 remain
unimplemented by C031. The reviewed integration baseline already contains T04;
run its regressions without modifying or copying its existing migrations.

| Suite | Required scenarios | Passing evidence |
| --- | --- | --- |
| Auth | Duplicate registration; expired/replayed verification; pending login; refresh restore; logout-all; replayed reset token | Correct `401`/`403`; no token exposure or account enumeration |
| Browser auth | Auto-login, protected routes, offline vs 401, remember-email opt-in, open redirects | Outage/5xx does not silently log out; understandable UI |
| Private media | Another user's video, unsupported MIME/oversized file, revoked playback, expired signed URL | Unauthorized video cannot be downloaded |
| Reviewer workflow | Missing assignment, revoked consent, invalid timestamps, optimistic version conflict, self-QA attempt | Correct `403`/`400`/`409`; unpublished draft stays private |
| Member controls | Unapproved report, disputed claim, revoked approved claim | Withdrawn claim never contributes to matching |
| Matching | Reciprocal filters, either-direction block, consent withdrawal, pair duplicates, concurrent decisions | Consistent explanations; no sensitive data exposure |
| Security | CSRF, cookie flags, throttling, redacted audit logs, signed URL TTL | Reproducible security evidence; no open critical/high issues |
| E2E | Register → verify → login → profile/consent → upload → expert → QA → owner → matching | Browser journey passes with synthetic or explicitly licensed test media only |

## T01 executable foundation checks

- `npm test`: unit checks for typed configuration, Prisma lifecycle, Argon2id, cookie/session validation and role authorization.
- `npm run test:integration --workspace apps/api`: explicit PostgreSQL 18 smoke on localhost:5433; reads the machine-local DATABASE_URL. All synthetic users/sessions are inserted in transactions that always roll back, with cleanup verification. No reset, truncation or migration is run by this suite.
- Integration-only HTTP fixtures are absent from the production app. Real guard/Prisma behavior covers 200/401/403, changed account/session state, readiness and shutdown. DB failures stay 503 rather than masquerading as session expiry.

## C011 CI validation

C011 belongs to T02 (web foundation and CI). Its historical scope is recorded
in `docs/COMMIT-PLAN.md` at commit `5deaf06`: validate API/web builds, Jest and
Prisma on PRs; verify workflow YAML and an actual workflow run. The plan was
later removed during documentation cleanup. There is no AI job to remove in
the current workflow.

| Check | Command / acceptance |
| --- | --- |
| Reproducible dependencies | `npm ci`; no package or lockfile changes |
| Prisma | `npm run prisma:validate` then `npm run prisma:generate` before tests/builds |
| Unit tests | `npm test`; configuration, password, session/role, health and mocked Prisma lifecycle checks; no running DB required |
| Build | `npm run build`; both API and web must succeed |
| Database integration | `npm run test:integration --workspace apps/api`; real PostgreSQL 18 on loopback port 5433, existing migration applied to a fresh CI database, synthetic fixtures rolled back and cleanup verified |
| Shared Playwright | Build first, then set `CI=1` and run `npm run test:ui --workspace apps/web`; desktop/mobile transport, UI/axe and synthetic C010 boundary checks; no API/DB required |
| Authentication Playwright | `npm run test:auth --workspace apps/web`; rebuilds for the test API, then verifies real registration/SMTP/sessions, protected SSR and the same-origin health proxy using PostgreSQL 18 and Mailpit |
| Workflow | Validate `.github/workflows/ci.yml` with an Actions-aware checker such as `actionlint`; require a successful GitHub Actions run for the final revision |

The shared suite starts only the web app and C010 fixture. The authentication
suite's API uses `NODE_ENV=test` on port 4100 and waits for `/api/health/ready`.
Its runner supplies the matching `API_INTERNAL_ORIGIN` during web build/runtime
and creates a UUID-scoped disposable schema. CI provides synthetic database,
MinIO and SMTP configuration. The shared web app uses its production build in
CI, while the isolated C010 fixture uses a development server on port 3101.

Preserve the native PostgreSQL startup, migration deploy, T01 integration suite,
Playwright reports and unconditional database cleanup. These checks do not
require Docker, a live MinIO service, or changes to authentication logic,
Prisma schema or migrations. Real email integration/auth browser tests require
Mailpit; the shared UI suite does not. They do not establish full media/matching
E2E acceptance. Record each result as PASS, FAIL or NOT RUN; local
build/unit success alone does not establish that CI or browser checks pass.

## C012 technical review record - MVP APPROVED / PRE-PRODUCTION OPEN

Huong technically approved reviewed commit
`b25e4d6d93823f560ae3fc8be443313902097abd` as the MVP implementation/testing
contract, with no further technical corrections in this review round.
Review evidence is the project owner's supplied Huong confirmation; no date or
GitHub review timestamp was supplied. This is not fresh test execution, a
production sign-off, or a claim that Draft PR #8 is merged.

The [contract decision register](PROFILE-CONSENT-CONTRACT.md) records approved
D1-D11, independent resource revisions/expectedRevision/409, safe legacy
503/remediation, append-only verifiable policy evidence, exact catalogs/three
prompts/limits, separate withdrawal quota, CAS/idempotency and 60-second URLs.
Existing auth remains unchanged. C019-C024 and their executable tests are not
implemented by this documentation.

Remaining checklist items below are implementation/handoff or PRE-PRODUCTION
verification requirements, not requests to reapprove the agreed MVP vocabulary.

- [ ] Compare auth request DTOs, flat AuthUser responses, message/202 responses,
  empty 204 responses and cookie behavior against existing code. Preserve
  registration/login validation differences and current optional/null handling.
- [ ] Confirm existing 400/401/403/415/429/503 behavior, validation details,
  Retry-After and non-JSON/framework fallbacks. Do not claim a universal response
  envelope, nested validation format or implemented auth 409/422 behavior.
- [x] Record Huong's technical approval of D1-D11 and concrete MVP values at
  the reviewed commit. Keep real-user production policy approvals separate.
- [x] Record technical acceptance of feature request/response examples,
  GET-empty, PATCH/null/arrays, questionnaire PUT/versioning, ownership and
  security/throttling composition; executable verification remains future work.
- [ ] Map feature DTOs to existing Prisma models; document policy/history and
  concurrency gaps without changing schema or promising a migration design.
- [ ] Preserve one auth provider/client, server session validation and
  server-derived ownership. No frontend userId or role may authorize writes.
- [x] Record reviewer Huong and reviewed commit above; no review date is invented.
- [ ] Complete PRE-PRODUCTION approval/verification of real-user retention/legal,
  storage/backup/restore policies and actual signed-URL provider enforcement.
- [ ] Review documentation-only diff, links and `git diff --check`; no app,
  test, dependency, schema or migration changes belong to this draft.

## C019-C024 MVP acceptance - NOT IMPLEMENTED / NOT RUN

These checks specify the agreed MVP contract, not implemented or passing
tests. Real-user retention and other PRE-PRODUCTION gates remain separate. Do not mark tasks DONE because
the following scenarios or schema tables exist.

| Task | Acceptance scenarios and required evidence |
| --- | --- |
| C019 | Reuse existing Profile/MatchPreference/QuestionnaireAnswer relations/indexes; Prisma validate/generate, reviewed migration only for confirmed gaps, FK/unique checks and no drift/loss of auth data in an isolated test database. Do not recreate the initial migration. |
| C020 | Own-profile GET/PATCH against actual DB; approved absent/default and omission/null/array rules; server timestamps; reject unknown/privileged fields, invalid values and cross-user access. No implicit User.displayName/auth-state change. Success followed by GET/reload returns approved persisted values. |
| C021 | Save three approved keys/texts for one supported version and reload identically under the approved normalization; reject duplicates/unknown keys, invalid version, missing answers and oversized text. Failed multi-answer write leaves no partial changes; another member's answers stay inaccessible; verify agreed version retention/conflict behavior. |
| C022 | Validate effective persisted + PATCH age bounds; reject inverted/out-of-policy/noninteger ranges and invalid JSON/catalog entries. Verify approved null/one-sided rules, arrays, persistence and ownership. Preference save cannot grant consent or enable visibility. |
| C023 | Fresh member GET projects all five purposes OFF; each purpose can be independently granted/withdrawn. Validate boolean/purpose/policy input under D9. Commit state and approved audit event atomically; audit failure rolls back the state change. Verify repeated requests and concurrent grant/revoke under D11, policy-version evidence, no unauthorized actor/timestamp injection, and withdrawn data/access excluded under D10. |
| C024 | Actual UI -> API -> DB save, browser refresh and withdrawal flow for profile, questionnaire, preferences and five separate consents. Cover loading/empty/error/success, field errors, keyboard/mobile/axe, failed-save input retention, 401 versus 403/outage, and approved conflict recovery. No opt-in defaults or page-local preview presented as account persistence. |

### Review-specific future checks - approved MVP baseline / NOT RUN

- D1: future nested validation paths use the approved dot/index grammar, e.g.
  consents.0.policyVersion; no secret values in details and no regression to
  existing top-level auth errors/flat success responses. Whole-request errors
  use visible _form summary; cross-field errors appear beside relevant inputs
  and in the linked summary, including unknown-path fallback.
- D2: prove GET writes no resource/audit/version rows; test omitted versus []
  versus API null, SQL NULL/JSON null read projection, approved legacy-shape
  errors, explicit replacement and no silent backfill on reads/unrelated writes.
  Corrupt profile/preferences fixtures must not block consent withdrawal or its
  response projection, including policy-less explicit OFF.
  A valid-field PATCH beside unrelated malformed legacy data must return 503
  with no field/revision change. Details identify only allowlisted paths and
  current revision, never raw data, arbitrary JSON keys, SQL/stack traces or
  another member. Explicit corrections succeed only when the complete merged
  state is valid; remaining bad fields still fail. Do not drop extra questionnaire
  rows or backfill on GET. Test visible remediation/unsaved edits, explicit
  confirmation and separately approved operator cases, not automatic repair.
- D3/D4: staff cannot bypass MEMBER ownership; verify per-member/per-feature and
  socket-IP buckets at approved boundaries, independent of auth buckets. Test
  429/Retry-After and no automatic retry. Exhaust profile/grant/general-IP limits
  and prove reserved revocation capacity remains; reject/split mixed batches
  under the approved design. A withdrawal 429 is visible, never success, and
  does not prove the result of an earlier uncertain request.
- D5/D6: optional birthDate draft save and missing-age matching exclusion;
  approved UTC date/age rules, birthday/day boundaries and February 29 behavior;
  catalog/length/code-point/NFC/blank/null validation; displayName remains on User.
- D7/D8: all three approved keys in one transaction with rollback on any failure,
  approved version/length/order/retention, merged PATCH range validation,
  one-sided/null ranges, unknown/duplicate dealbreakers and priority ordering.
  Retired versions stay read-only and retain original prompt meanings/order;
  approved MVP read selector/rejection codes apply; real-data retention expiry
  still requires policy approval.
  Different goals must not hard-exclude unless the breaker is explicitly set.
  Exercise candidate null/[] priority defaults and lexicographic/Jaccard ordering
  against the approved MVP catalogs/formulas; T14 aggregate matching remains
  separate implementation/review work.
- D9: grant rejects missing/stale policy at the correct path; revoke can omit
  policy; state/revision/immutable events commit or roll back together. Verify
  the approved policy/timestamp retention and reaffirmation event behavior.
  Verify application roles cannot edit/delete append-only events or accepted
  policy snapshots. Grants/re-consent bind version/purpose/locale to retained
  content or digest plus corresponding recoverable snapshot. Changing a latest
  policy entry cannot change historical proof; test digest verification, missing
  evidence markers and no fabricated backfill. Missing legacy policy evidence
  cannot block policy-less withdrawal.
- D10: after successful revoke, deny new access/signed URLs and exclude withdrawn
  matching contributions, even while cleanup fails/retries. Verify cache and
  in-flight behavior and documented issued-URL limitations, not instant erasure.
- D11: under the approved MVP CAS, two tabs read version 4; revoke or already-OFF
  reaffirmation commits 5; old grant at 4 fails 409 with no state/event changes.
  Also test reversed ordering, missing/invalid expectedVersion (400), atomic
  initial-version creation, no version reset after purpose recreation, audit
  failure rollback, coherent reads and explicit-action-only conflict recovery.
  Concurrent same-key/same-payload requests produce one version/event set;
  replays, different-payload reuse, expired records and lost responses cannot
  duplicate them. Distinguish STATE_CHANGED/OFF_REAFFIRMED/GRANT_REAFFIRMED/
  POLICY_RECONSENT under approved event vocabulary; replayed historical success
  does not overwrite newer UI state without a fresh read.

### Independent editing revisions - future C020-C024 checks

- GET reports independent profile/preferences/questionnaire revisions, separate
  from consent version. Missing resources return virtual 0 with no writes.
- Every mutation requires expectedRevision: invalid/missing is 400; stale is
  409 RESOURCE_REVISION_CONFLICT at visible _form. Two editors at revision 3
  cannot both commit: one advances to 4, the other changes no state.
- Concurrent first writes initialize once. Accepted mutation advances once;
  malformed-result 503, stale CAS, DB or questionnaire failure advances nothing.
  Clearing/recreating data must not reset an active-account revision.
- questionnaireVersion selects a catalog only; questionnaire editing revision
  covers that member's answers across versions. Test stale atomic PUT, retired
  reads/read-only writes, and rejection of profile/consent tokens as substitutes.
- Preserve edits after 409, fetch fresh data and require explicit reconciliation;
  never silently merge/retry. Consent CAS/idempotency tests remain separate.

### Additional policy/media validation - NOT IMPLEMENTED by C012

- Section B: with synthetic clocks/data, verify category triggers, deletion
  targets, current versus retired questionnaire expiry, separate current-state/
  immutable-audit retention and account-session denial before deletion. Test
  retry sequence, durable restart recovery, owner alerts, partial object-version
  failures and backup restore suppression. Never mark erasure verified merely
  because DELETE returned success. Periods are proposed, not legal requirements.
  Hard-delete a synthetic User/Consent graph and prove unexpired audit events,
  policy snapshots/digests and ordering survive without cascades. Verify approved
  separate mapping erasure/minimization, restrictive evidence references,
  authorized expiry purge only after retention/holds and restore suppression.
  Do not rewrite immutable events for de-identification or label pseudonymous
  evidence anonymous. Missing retention policy is a release decision, not
  authorization to invent indefinite legal holds.
- Section C: verify authorization/consent/assignment/eligibility/MFA before every
  playback URL, renewal and supported range access; no issuance after withdrawal
  commit. Confirm approved MVP 60-second expiry on the actual provider, cache headers,
  URL/log redaction and no public ACL. Test previously issued URL and in-flight
  behavior explicitly; do not claim immediate revocation if expiry is the only
  enforcement. Provider invalidation/proxy choices require separate acceptance.
- Scope: C019-C024 implement Phuc-owned domain features against the approved MVP contract; Huong
  owns private-media/account-privacy controls. Shared workers, backup/retention
  policy and stronger streaming enforcement are later release work, not evidence
  that profile implementation or C012 has completed them.

These are future test cases for the reviewed design, not tests executed by C012.

For protected feature endpoints, include pending/suspended/deleted account and
expired/revoked session denial, valid MEMBER ownership, staff-role policy (D3),
Origin/JSON mutation checks and agreed throttling. Where nested DTO errors are
used, verify the reviewed field-path format reaches the matching UI control.
On dependency or network failure do not assert logout or successful save;
exercise revalidation before a retry that could repeat a committed mutation.

Keep current auth and transport/loading regression coverage. Use synthetic
fixtures and isolated/rollback test databases; do not reset development or
production data. Full withdrawal effects involving media/review/matching need
coordination with the owners of those features and cannot be certified by
profile-only tests. Report PASS, FAIL or NOT RUN with actual execution evidence;
this C012 draft does not implement or execute C019-C024 tests.

## Release gate

- [ ] Prisma validation and migration apply plus a tested rollback/recovery procedure in a test database.
- [ ] Actual `npm` build/tests and end-to-end checks pass; no PASS claims based on docs alone.
- [ ] No known private media/PII leakage. Session, `401`/`403`, withdrawal, and independent QA checks pass.
- [ ] Cross-reviewed release PR, changelog, and known limitations are documented.
- [ ] If any critical gate is not met: label the build **internal demonstration only**, not public production.

### C019 design and PRE-PRODUCTION release gates

- C019 chooses concrete schema/migration design after inspecting existing models
  and migrations; reuse migration history and never recreate the initial migration.
- Before real-user production: explicitly approve retention/legal basis, category
  deletion deadlines, storage/backup/restore suppression and cleanup ownership.
  Section B periods remain candidates, not approved production policy.
- Verify the actual signed-URL provider enforces the 60-second MVP TTL and cache,
  range/HEAD, expiry/race/in-flight behavior. Review residual pre-issued URL risk.
- Execute and record implementation/security tests separately; documentation
  approval does not establish PASS results or completion of C019-C024.

## T13 password recovery regression

- Unit: bounded background acceptance without synchronous account lookup, typed recovery TTL/cooldown, password/token validation, Unicode and whitespace policy, origin/Fetch Metadata checks and exact rate-window boundaries.
- Native PostgreSQL/Mailpit integration: generic known/unknown/ineligible responses, actual SMTP fragment link and hash-only storage, persisted cooldown across worker restarts, superseded/expired/used tokens, concurrent consumption, all target sessions revoked, unrelated sessions preserved, old/new password login, audit failure rollback and SMTP failure invalidation. All data is synthetic in disposable schemas; cleanup removes only owned schemas and recipient messages.
- Actual Next proxy/browser: full recovery and subsequent login, two independently issued browser sessions, used-link recovery, keyboard validation focus, WCAG axe checks, desktop/mobile/320px layout, Origin/Fetch Metadata failures, real 429 headers/countdown and input preservation after network failure. Negative network interception aborts requests; authentication success uses the real API and SMTP. No secret-bearing traces are recorded.
- Commands: `npm test`, `npm run test:integration --workspace apps/api`, `npm run test:auth --workspace apps/web`, `npm run test:ui --workspace apps/web`, `npm run lint`, `npm run build`, `npm run prisma:validate`, `npm run prisma:generate`, `prisma migrate status` and read-only `prisma migrate diff`.
- Production SMTP, deployed proxy topology, crash-durable delivery and shared multi-instance throttling are deployment gates, not verified by local Mailpit tests. Dependency audit findings inherited from the unchanged lockfile must be reported separately.

### T13 security/reliability review

Recovery regressions additionally cover independent real loopback clients, shared native proxy socket quotas, forged forwarding headers, pair-quota isolation and exact boundaries. Native SMTP greeting timeout preserves the previous delivered link and waits for worker shutdown. Actual Mailpit deliveries with controlled acknowledgement ordering verify late-ack safety and concurrent old/new-token reset atomicity. Queue tests cover active-job saturation, draining accepted work during shutdown and redacted failure continuation. No production proxy, multi-instance limiter or crash-durable outbox is claimed by these tests.

## C051 cancellation acceptance

- Real owner DELETE atomically cancels ASSIGNED/IN_PROGRESS/SUBMITTED once; foreign callers are denied and terminal rows remain unchanged.
- Source-bound storage/review withdrawal, independent immutable receipts, 20-row batches, delayed old tasks and newer re-consent generations.
- Real PostgreSQL lock contention between workers; CAS zero-row failure, audit rollback, DB retry and missing-mapping reconciliation.
- Opaque actual-owner versus system executor/initiator evidence; no retroactive history, no raw payload logs and no shared-task completion.
- Context/history survive live resource removal; migration preserves C031-C034 rows and rolls back post-DDL failure.
- UTC timestamps under a non-UTC transaction and unchanged real C034 post-cancellation denial.
- C054 full edit/submit races remain incomplete until actual review APIs exist.

## T15 implemented-subset regression

See [Security regression](SECURITY-REGRESSION.md) for step evidence, the reproduced
C034 provider-boundary finding and release blockers. New security-*.integration-spec.ts
suites use synthetic accounts, actual login and disposable PostgreSQL; media
suites use native MinIO with owned UUID buckets. security-regression.auth-e2e.ts
uses real Mailpit and actual Chromium offline networking on desktop/mobile. They
are discovered by existing integration/auth CI commands, without a bypass handler.
Existing tests are preserved. Independent QA/Matching/real MFA/deployed TLS and
account deletion are not claimed by these tests.
