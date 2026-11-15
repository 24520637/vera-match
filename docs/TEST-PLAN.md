# Verification and acceptance test matrix

Each feature needs valid inputs, invalid inputs, unauthorized access, state/race tests, UI feedback states, and audit/revoke behavior when relevant.

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

## C012 contract draft review — PENDING REVIEW

This is a documentation review checklist, not executable feature coverage or a
fresh PASS claim. C012/T02 historically requires agreement on auth/profile DTO
envelopes/types with Huong and completed contract review. See
[API contracts](API-CONTRACT.md) and the
[proposed profile/consent contract](PROFILE-CONSENT-CONTRACT.md).

- [ ] Compare auth request DTOs, flat AuthUser responses, message/202 responses,
  empty 204 responses and cookie behavior against existing code. Preserve
  registration/login validation differences and current optional/null handling.
- [ ] Confirm existing 400/401/403/415/429/503 behavior, validation details,
  Retry-After and non-JSON/framework fallbacks. Do not claim a universal response
  envelope, nested validation format or implemented auth 409/422 behavior.
- [ ] Resolve and record every decision D1-D11 with Huong; identify additional
  product/privacy decisions rather than filling them with invented requirements.
- [ ] Approve feature request/response examples, GET-empty, PATCH/null/arrays,
  questionnaire PUT/versioning, ownership and security/throttling composition.
- [ ] Map feature DTOs to existing Prisma models; document policy/history and
  concurrency gaps without changing schema or promising a migration design.
- [ ] Preserve one auth provider/client, server session validation and
  server-derived ownership. No frontend userId or role may authorize writes.
- [ ] Record reviewer, date and review reference. No automatic approval: keep
  C012 PROPOSED / PENDING REVIEW while any required decision remains open.
- [ ] Review documentation-only diff, links and `git diff --check`; no app,
  test, dependency, schema or migration changes belong to this draft.

## C019-C024 future acceptance — PROPOSED / PENDING REVIEW

These checks are a proposed test specification, not implemented or passing
tests. Product-level invariants already in scope remain required; draft choices
must be approved before feature implementation. Do not mark tasks DONE because
the following scenarios or schema tables exist.

| Task | Acceptance scenarios and required evidence |
| --- | --- |
| C019 | Reuse existing Profile/MatchPreference/QuestionnaireAnswer relations/indexes; Prisma validate/generate, reviewed migration only for confirmed gaps, FK/unique checks and no drift/loss of auth data in an isolated test database. Do not recreate the initial migration. |
| C020 | Own-profile GET/PATCH against actual DB; approved absent/default and omission/null/array rules; server timestamps; reject unknown/privileged fields, invalid values and cross-user access. No implicit User.displayName/auth-state change. Success followed by GET/reload returns approved persisted values. |
| C021 | Save three approved keys/texts for one supported version and reload identically under the approved normalization; reject duplicates/unknown keys, invalid version, missing answers and oversized text. Failed multi-answer write leaves no partial changes; another member's answers stay inaccessible; verify agreed version retention/conflict behavior. |
| C022 | Validate effective persisted + PATCH age bounds; reject inverted/out-of-policy/noninteger ranges and invalid JSON/catalog entries. Verify approved null/one-sided rules, arrays, persistence and ownership. Preference save cannot grant consent or enable visibility. |
| C023 | Fresh member GET projects all five purposes OFF; each purpose can be independently granted/withdrawn. Validate boolean/purpose/policy input under D9. Commit state and approved audit event atomically; audit failure rolls back the state change. Verify repeated requests and concurrent grant/revoke under D11, policy-version evidence, no unauthorized actor/timestamp injection, and withdrawn data/access excluded under D10. |
| C024 | Actual UI -> API -> DB save, browser refresh and withdrawal flow for profile, questionnaire, preferences and five separate consents. Cover loading/empty/error/success, field errors, keyboard/mobile/axe, failed-save input retention, 401 versus 403/outage, and approved conflict recovery. No opt-in defaults or page-local preview presented as account persistence. |

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
