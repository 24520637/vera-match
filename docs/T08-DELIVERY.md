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
| C045 | Persist all five observation categories. Recording confirmation can now store server-measured duration from decoded frames of the exact promoted MP4/WebM object. Text-only edits preserve existing observations when measurement is unavailable. | PARTIAL pending full upload integration on the new head and release validation |
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
consent and evidence sources already required by C034. Uploads without a
measured server duration cannot accept timecoded notes. Production storage
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

The original C045 gap at that revision was a missing trusted MP4/WebM probe.
The follow-up below records the implementation and its separate verification.

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

### C045 duration measurement after the T15 merge

The T08 branch integrates `develop` at `b58f770`. The shared assignment
access service uses T15's upstream provider error sanitization and retains the
T08 duration projection and runtime expert gate.

Set `VIDEO_DURATION_FFPROBE` to the absolute path of a patched native
ffprobe executable. Confirmation reads only the promoted server-owned object,
using the copy's ETag and checked byte size. It measures decoded video frame
start timestamps instead of user input or the container's declared duration.
The ending bound is the last decoded frame start. Container and per-frame
duration declarations cannot extend it. Missing, unordered, identical-only
or malformed timestamps leave duration unavailable. The
same transaction holds the existing consent/owner lock through promotion,
measurement and the READY/audit write. The probe has a 100 MiB input cap,
two-second download/decoder deadline, restricted formats/codecs, one decoder
thread and bounded output. It does not inherit application environment
variables. Disabled, busy, unsupported or failed probes leave the duration
null. No preexisting uploads are backfilled, and there is no retry worker.

Before enabling this in a deployment with private uploads, verify the patched
binary, OS isolation and resource limits, private temp-file storage/cleanup,
and acceptable probe completion under expected load. Staff MFA and approved
evidence remain separate release gates.

| Current local verification | Result |
| --- | --- |
| Prisma validate/generate, API/web TypeScript including API tests, API/web production builds | PASS |
| API Jest with portable FFmpeg 9.0.2 | 265/265 PASS, including real generated MP4 and WebM decoding |
| Nine PostgreSQL integration suites covering assignment, consent, cancellation, migration and T15 regressions | 156 PASS, 9 FAIL. Eight MinIO-backed security cases failed at bucket setup because port 9000 was unavailable. One Mailpit-backed session case failed with `fetch failed`. All six T08/assignment/C051/Consent suites passed |
| Playwright reviewer UI with mocked HTTP | 8/8 PASS |
| Updated MP4/WebM upload and private playback browser E2E, plus native security-media suite | NOT RUN locally. MinIO port 9000 was unavailable and the pinned Windows download returned HTTP 410. CI provides native MinIO and Mailpit |

CI runs the native decoder tests and both browser projects with ffprobe
enabled. That run must verify real uploads and the newer T15 integration before
closing the remaining C045 integration checks. The previous CI #75 pass does
not include these changes.

### C045 duration trust boundary verification

| Check | Result |
| --- | --- |
| API unit with portable FFmpeg 9.0.2 | 275/275 PASS. Includes ordinary MP4, streaming WebM, malformed media, inflated frame/container duration and invalid review bounds |
| Six assignment, consent, cancellation and migration PostgreSQL suites listed above | 148/148 PASS. Two new HTTP cases exercise persistence and exact timecode boundaries with controlled storage responses |
| Playwright workspace with HTTP mocks | 8/8 PASS |
| Prisma validation and generation, API/web TypeScript, API/web builds and Git diff checks | PASS |
| Updated browser/MinIO suite | NOT RUN locally. Four cases discovered across desktop and mobile, including two reviewer cases. Local MinIO was unavailable |

The earlier nine local integration failures were eight MinIO fixture setup
failures at bucket creation (loopback port 9000) and one Mailpit password-reset
test failing to fetch mail (loopback port 8025). PostgreSQL responded on 5433.
The full PostgreSQL step in
[CI #77](https://github.com/24520637/vera-match/actions/runs/44460305954)
passed 357/357 PostgreSQL cases on `de49921` with native MinIO and Mailpit.
No code change was made to bypass those checks. Its native decoder tests also
passed 8/8. The workflow nevertheless failed: the two reviewer browser cases
observed `durationMs: null` after confirming a Chromium recording. Both
owner-video cases passed. This is separate from the nine local service failures.

The follow-up implementation is `9da7b76de11feda3e8b0b88e031477ae974b3d98`.
An additional local probe of a real VP8/Opus WebM made by Chromium's fake camera
and microphone produced 1441 ms using portable FFmpeg 9.0.2. This exercise did
not involve MinIO or database persistence. The exact cause of the CI null result
is not yet confirmed. The full upload-to-playback check, including a timecode
one millisecond beyond the stored bound, is still required on the follow-up SHA.
[CI #78](https://github.com/24520637/vera-match/actions/runs/44461856792) tracks
that verification. It passed 359/359 PostgreSQL cases and 11/11 native decoder
cases, then failed the same two reviewer browser cases at `durationMs: null`
after confirmation. Both owner-video cases passed. Keep C045 PARTIAL. The next
E2E revision compares a direct decode of the exact synthetic Chromium preview
with the persisted result to distinguish decoder failure from upload-path
failure.

After building native MinIO from the same pinned source as CI and starting
Mailpit v1.33.1 on loopback, the Windows test environment returned:

- **PASS 2/2** for reviewer native E2E (desktop/mobile), with PostgreSQL,
  real API, Chromium, FFmpeg 9.0.2 and native MinIO. The direct Chromium
  recording probe matched the stored result. Both projects measured the
  generated MP4, rejected a timecode one millisecond past the measured limit,
  and verified signed playback and post-withdrawal denial.
- **PASS 19/19** on the three T15 suites that previously reported nine
  failures. The same bucket-creation and Mailpit cases now pass with the
  native services available.
- **PASS 2/2** for owner-video native E2E (desktop/mobile), including upload,
  playback, deletion, and consent withdrawal with the decoder enabled.
- **PASS 23/23** in `security-media.integration-spec.ts` and
  `video-api.integration-spec.ts` using native MinIO and disposable PostgreSQL.
- **PASS 11/11** for the focused native decoder tests. An earlier rerun
  timed out during MP4 fixture setup under load. The test now separates
  fixture time from the production probe's unchanged deadline.

The Windows success does not resolve the Linux CI discrepancy. Keep the
browser/MinIO check open for the updated PR head.

### Chromium recording finalization

[CI #79](https://github.com/24520637/vera-match/actions/runs/44466552848)
failed on `2f4a16607fafe971cf5a5cddc6fc8025b0c99155`, based on
`b58f770a93c95b89e7af2de25ed678c214bdf7ef`. PostgreSQL passed 359/359, the
native decoder suite passed 11/11, and the two owner-video cases passed.
Both reviewer cases failed before upload because direct decoding of the
Chromium preview returned null. The failure occurs before MinIO or database
persistence.

A local reproduction used the application's timed-chunk capture
(`MediaRecorder.start(1000)`) with Chromium's fake camera and microphone.
The old stop handler called `MediaRecorder.stop()` and immediately ended
both input tracks before the final `dataavailable` event. The WebM still
contained nonempty chunks, but one real VP8/Opus recording returned null.
Leaving the tracks live until the recorder's stop event returned 1446 ms
for the comparable desktop capture. Other early-stop captures decoded,
so byte count and MIME alone did not detect the race. Standalone MP4/WebM
decoder fixtures do not exercise this Chromium finalization order.

The upload UI now waits for final data and the stop event before releasing
tracks and offering the preview. A five-second watchdog discards a recording
if finalization does not finish. Errors, size overflow and unmount cannot
publish a partial recording. The reviewer E2E still independently decodes
the actual blob and compares its measured duration with the persisted value.
C045 remains PARTIAL until the native Linux check passes on the updated SHA.

Local verification of this fix, without Docker:

- **275/275 PASS** in API Jest with native ffprobe, including all 11 decoder cases.
- **91/91 PASS** across `assignment-access.integration-spec.ts`,
  `video-api.integration-spec.ts` and `security-media.integration-spec.ts`
  with native MinIO and disposable PostgreSQL.
- **4/4 PASS** with `node scripts/run-video-e2e.cjs --reporter=line`: reviewer
  and owner cases on desktop and mobile, using native MinIO and FFmpeg.
- Prisma validation, API/test and web TypeScript, both production builds,
  and Git diff checks **PASS**.
