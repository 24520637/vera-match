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

## Release gate

- [ ] Prisma validation and migration apply plus a tested rollback/recovery procedure in a test database.
- [ ] Actual `npm` build/tests and end-to-end checks pass; no PASS claims based on docs alone.
- [ ] No known private media/PII leakage. Session, `401`/`403`, withdrawal, and independent QA checks pass.
- [ ] Cross-reviewed release PR, changelog, and known limitations are documented.
- [ ] If any critical gate is not met: label the build **internal demonstration only**, not public production.
