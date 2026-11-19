# T08 expert review workspace delivery

Status: **PARTIAL**. The original requirements and six commit subjects are
preserved in `5deaf06:docs/COMMIT-PLAN.csv`. The workspace follows
[the expert review workflow](EXPERT-REVIEW-WORKFLOW.md).

Implementation and verification commit for C043–C048:
`bc61b28e9fde2d700879ba2d556954e0121340bb`. Base:
`0c8d86e9acf26d82a7cc7cd03af5b4b526432ec3`. This traceability update records the
implementation SHA without changing its code or tests.

| Step | Scope and actual delivery | Status |
| --- | --- | --- |
| C043 | Reuse the initial migration's ExpertReview and ExpertObservation entities. Add database checks for positive versions and nonnegative, ordered evidence timestamps. | DONE for database foundation |
| C044 | Private assignment route, playback through C034, expiring video source, timestamps and keyboard-accessible jumps. CI #75 verified signed access and denied anonymous access using native MinIO on desktop and mobile. | DONE for assignment playback acceptance in isolated CI. Production authorization remains blocked. |
| C045 | Persist EYE, FACIAL, BODY, SPEECH and CROSS_MODAL observations with explicit evidence and context. Text-only autosave now omits observations, preserving existing notes even when duration is absent. | PARTIAL because uploaded video currently has no verified duration producer |
| C046 | Validate integer milliseconds, order and stored duration. Out-of-range timecodes return 422. Unknown or nonpositive duration blocks new timecoded notes with 503. | DONE for validation contract; verified-duration ingest remains a dependency |
| C047 | Versioned PATCH autosave; a stale version returns 409. A transaction includes the matching write and audit. | DONE for private draft behavior in the verified test environment |
| C048 | CI #75 verified real browser/API/PostgreSQL/MinIO reload, reviewer isolation and withdrawal on desktop and mobile. The isolated scenarios seed duration for observation edits. | DONE for isolated draft persistence and reviewer isolation. The upload duration gap is tracked under C045. |

## Contract

- Workspace: `/expert/assignments/:assignmentId/review`. Navigate using an
  assigned reference. Queue links and discovery remain dependent on separate queue
  work. No unmerged PR #18 code is included.
- API GET `/api/expert/assignments/:assignmentId/draft` returns
  `{ draft: null, durationMs }` when none exists. It records a minimal read
  audit without creating a draft. POST to the same path with `{}` initializes
  one private DRAFT at version 1 or returns the existing DRAFT.
- PATCH `/api/expert/reviews/:reviewId/draft` requires `expectedVersion` and
  at least one of `summary`, `limitations`, or `observations`. Omission
  preserves a field. Null clears summary/limitations. The observations array
  replaces the draft list atomically. An empty array clears it. POST
  `/api/expert/reviews/:reviewId/observations` appends one observation using
  `{ expectedVersion, observation }`. Each observation contains category,
  startMs, endMs, observation and context. Every successful write advances version.
- Draft responses project only draft ID, version, summary, limitations,
  observations and server duration. Private/no-store, Vary Cookie and
  no-referrer protect success and errors. Both routes rely on active verified
  EXPERT sessions and the assignment authorization transaction from C034.
  No client identity, evidence, media locator or claimed duration is accepted.
- ASSIGNED and IN_PROGRESS use the existing C034 rules. Withdrawal, generation
  mismatch, cancellation, loss of qualification, and expiry deny further access.
  Draft writes run under the same ordered locks with a fresh time check after
  the audit. Scope is drafts only. There is no submit, QA, public draft access,
  owner report or matching consumption in this change.
- External assurance/evidence failures are sanitized at the shared access
  boundary before it is reused for drafts. This touches the same shared area
  under review in PR #21. Reconcile that small overlap when integrating; T08
  does not import its unmerged implementation or claim T15 acceptance.

## Files and verification

- Data: `apps/api/prisma/migrations/20261119100000_review_draft_invariants/migration.sql`.
  Constraints are additive and initially NOT VALID to preserve historical rows.
- API: `apps/api/src/configure-app.ts` and `apps/api/src/expert-admin/`
  (assignment-access service, expert-approval module and review-draft
  controller/service/validation). API evidence lives in the draft validation
  unit suite and `apps/api/test/assignment-access.integration-spec.ts`.
- Web: expert assignment review page, expert review workspace component,
  `apps/web/tests/expert-review.spec.ts` and its isolated fixture.
- Documentation: API contract, review workflow, test plan and this report.

### Local evidence

Commands were run with synthetic configuration and short-lived PostgreSQL
schemas. The browser fixture server was started separately to avoid Windows
Playwright server teardown hangs.

| Command | Result |
| --- | --- |
| `npm run prisma:validate --workspace apps/api` and `npm run prisma:generate --workspace apps/api` | PASS |
| `npm test --workspace apps/api -- --runInBand` | 257/257 PASS across 24 suites |
| `npm run test:integration --workspace apps/api -- --runTestsByPath test/assignment-access.integration-spec.ts test/consent-api.integration-spec.ts` (shown subset of the three-suite invocation) | 82/82 PASS across the two suites, including six T08 cases |
| `npm run test:integration --workspace apps/api -- --runTestsByPath test/assignment-api.integration-spec.ts test/assignment-races.integration-spec.ts test/assignment-cancellation.integration-spec.ts test/assignment-cancellation-migration.integration-spec.ts` (shown subset of the five-suite invocation) | 65/65 PASS across the four suites |
| `node node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma` followed by `npm run test:integration --workspace apps/api -- --runTestsByPath test/auth-foundation.integration-spec.ts` in the same disposable schema | All 13 migrations deployed, 11/11 Auth PASS |
| `npm run test:ui --workspace apps/web -- --config=playwright.t08-local.config.ts tests/expert-review.spec.ts` | 6/6 PASS. Temporary config reused desktop/mobile projects with the separately started fixture server |
| `npm run lint --workspace apps/api`, `npx tsc --noEmit -p apps/api/tsconfig.test.json`, `npm run lint --workspace apps/web`, `npm run build --workspace apps/api`, `npm run build --workspace apps/web`, `git diff --check` | PASS |

The first access integration run stopped at a TypeScript fixture error. The
corrected suite passed. Early Auth attempts targeted an unmigrated schema or
lacked synthetic MinIO configuration. The configured disposable rerun passed.
Native MinIO and full-stack browser playback were NOT RUN because loopback
port 9000 refused connections. Deployment and production checks were NOT RUN.
GitHub Actions results are tracked separately on the Draft PR.

## Release gates

Production remains blocked on trusted session-bound MFA and approved qualification,
consent and evidence sources already required by C034. The Video upload path
must produce a trusted duration before ordinary uploaded videos can accept
timecoded notes. Never substitute browser media metadata. Production storage
enforcement and retention also remain unverified. C051 is integrated upstream.
This change covers real draft endpoints and withdrawal denial but does not
complete all C050/C053/C054 races or publish a production review policy.

### Follow-up for Draft PR #22

The local PostgreSQL test endpoint on port 5433 was available. Native MinIO on
port 9000 was unavailable. The existing repository runner builds Nest and
Next, then starts them on ports 4100 and 3100. In CI it uses native MinIO and
PostgreSQL with a disposable schema and private bucket. The new desktop/mobile
test is picked up by that runner without a CI workflow change.

The current upload confirmation code only validates size, MIME, a container
signature, and object identity before promotion. It does not parse playback
duration. An approved server-side media inspection path needs to derive duration
from the promoted object within a bounded and isolated process and coordinate
its write with deletion and consent. The browser suite explicitly seeds duration
only inside its disposable schema, after checking the ordinary upload behavior.
No production code trusts client duration or changes the upload boundary.

| Follow-up check | Result |
| --- | --- |
| Prisma validation and generation, API/web TypeScript and production builds | PASS |
| API unit tests | 257/257 PASS |
| `npm run test:integration --workspace apps/api -- --runTestsByPath test/assignment-access.integration-spec.ts test/assignment-api.integration-spec.ts test/assignment-races.integration-spec.ts test/assignment-cancellation.integration-spec.ts test/assignment-cancellation-migration.integration-spec.ts test/consent-api.integration-spec.ts` | 145/145 PASS across six suites |
| `npm run test:ui --workspace apps/web -- --config=playwright.t08-local.config.ts tests/expert-review.spec.ts` | 8/8 PASS with mocked HTTP. The temporary config attached to the existing fixture server |
| `node --check scripts/video-e2e-server.cjs` and `npm run test:ui --workspace apps/web -- --config=playwright.video.config.ts --list` | PASS. Two T08 cases discovered, one per project, alongside two existing owner-video cases |
| `node scripts/run-video-e2e.cjs expert-review.video-e2e.ts` | NOT RUN locally. Port 9000 was unavailable. Track execution separately on the updated PR head |

[CI #74](https://github.com/24520637/vera-match/actions/runs/44368423038) passed
on the previous PR head `f2dc78e`. Check GitHub Actions on the follow-up head
for execution of the new reviewer scenarios.

### Native CI evidence and duration boundary

[CI #75](https://github.com/24520637/vera-match/actions/runs/44371280981) passed
on `1a3e5a893ddfbbe31c5d98dbffb95e110bbc1bef`: API unit **257/257**,
PostgreSQL integration **332/332**, UI **126/126**, and native MinIO browser
**4/4**, including both T08 reviewer cases. The native runner exercised the
actual upload, C032/C033 qualification/assignment APIs, signed media request,
anonymous denial, draft reload, foreign reviewer denial, and consent withdrawal.
Its MFA, evidence and duration fixtures are restricted to the disposable test
runtime. The evidence does not validate duration extraction or production release.

C045 still needs a trusted probe for MP4 and WebM, including browser recordings
without a declared container duration. Inspect the exact immutable promoted object
with resource limits and isolated parsing. Bind the result to object identity and
current consent before writing it, and reject stale results after deletion,
withdrawal, or generation change. Do not derive the bound from client input,
content length, or the existing file signature check. No bounded media probing
runtime is available in the current upload implementation.

The new regression assertions cover forged duration, text edits that preserve
existing observation rows, actual playback progression, and no draft or success
audit changes after an unauthorized edit. Their native execution is **NOT RUN**
locally because loopback port 9000 is unavailable. CI #75 predates these extra
assertions.

| Latest local check | Result |
| --- | --- |
| Prisma validate/generate, API and web TypeScript checks including API test sources, production builds, and Git diff checks | PASS |
| API unit tests | 257/257 PASS |
| Six PostgreSQL suites listed in the preceding follow-up table | 146/146 PASS, including the new duration-boundary regression |
| Playwright workspace tests with HTTP mocks | 8/8 PASS |
| Updated native MinIO browser assertions | NOT RUN locally. Both reviewer projects discovered by Playwright |
