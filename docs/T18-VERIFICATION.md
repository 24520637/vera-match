# T18 release verification

The T18 worktree was clean at the start of implementation on historical T16 baseline `3507d21`. On 2026-11-23, `phuc/fix/t18-release-preparation` and `origin/develop` both pointed at squash commit `d5151e3`. The committed trees at `3507d21` and `d5151e3` are identical. The acceptance criteria come from D9 in `5deaf06:docs/COMMIT-PLAN.md`. [Backlog](BACKLOG.md) · [Feature ownership](FEATURE-OWNERSHIP.md) · [Test plan](TEST-PLAN.md).

## Execution checklist

- [x] Verify the T16 baseline and inspect upstream PR status and ownership.
- [x] Run the existing review, claim, and matching gates before application changes. Fix reproducible defects and add regression coverage for each fix.
- [x] Run one joined registration-to-revocation journey twice with fresh PostgreSQL, Mailpit, and MinIO fixtures. Record commands, results, and cleanup.
- [x] Run the ordered release checks and record suite counts and outstanding gates.
- [x] Draft v0.1.0 notes for Hương’s cross-review.

| Acceptance | Evidence |
| --- | --- |
| C096 | The existing assignment-access, review-claims and matching API suites passed. They cover role and scope enforcement, stale versions, concurrent decisions, audit rollback, consent withdrawal, blocks and revocation. |
| C097 | Two clean invocations passed, each with a desktop and mobile joined journey. The same member registered and verified their email before the video, review, claims and matching steps. |
| C098 | The release notes are drafted for internal-demo scope. Hương’s cross-review is pending. [Release notes](RELEASE-NOTES-v0.1.0.md). |

## Upstream status

- PR #38 was squash-merged into `develop` at `d5151e3`. The original PR head was `3507d21`, and upstream CI run 45037118321 tested that head. [PR #38](https://github.com/24520637/vera-match/pull/38) · [CI run 45037118321](https://github.com/24520637/vera-match/actions/runs/45037118321).
- PRs #32 and #33 are open and carry the broader withdrawal/deletion race and bilateral block suites. Recheck those suites when the underlying changes are approved and integrated. [PR #32](https://github.com/24520637/vera-match/pull/32) · [PR #33](https://github.com/24520637/vera-match/pull/33).
- PR #34 is open for lifecycle owner decisions. The closure foundation, its UI, and the restore negative control are open drafts. PRs #36 and #37 are stacked on #35. The demo uses the existing paths on the T16 baseline. Lifecycle release acceptance depends on draft review and the remaining reconciliation, policy and restore gates. [PR #34](https://github.com/24520637/vera-match/pull/34) · [PR #35](https://github.com/24520637/vera-match/pull/35) · [PR #36](https://github.com/24520637/vera-match/pull/36) · [PR #37](https://github.com/24520637/vera-match/pull/37).
- T17 release sign-off remains with Hương. PR #27 supplied the baseline runbook and synthetic recovery rehearsal. The C093–C095 release sign-offs and production restore runbook review are still outstanding. [PR #27](https://github.com/24520637/vera-match/pull/27) · [C095 runbook](C095-OPERATIONS-RUNBOOK.md).

## Local environment

Windows, Node.js 24.21.0, npm 11.19.0, Prisma 6.19.3, Chromium 158.0.8127.18, PostgreSQL 18.7 from the standalone Windows distribution in `@embedded-postgres/windows-x64@18.7.0-beta.19`, Mailpit 1.33.1, a locally available native MinIO development build, and FFmpeg/FFprobe 9.0.2. For this run Docker had no reachable daemon. An initial `npm ci --offline --no-audit --no-fund` could not find a cached tarball. The lockfile matched the installed T16 dependency cache byte-for-byte, and its dependency files were copied into the T18 worktree. The first Prisma validation attempt exited 1 because PowerShell blocked the environment setup script and left `DATABASE_URL` unset. Validation and client generation passed after supplying the explicit disposable database URL.

Run services in new private data directories under the worktree. Each demo invocation uses a fresh local PostgreSQL database cluster, Mailpit store, and MinIO store. The runner creates a nonce-scoped migrated schema and a private bucket. The browser test removes only its synthetic recipient’s email and checks that none remain. The post-run checks query PostgreSQL for residual fixture schemas, list MinIO buckets, count Mailpit messages, and check for T18 runtime manifests.

The native services ran with the following commands from the worktree. Substitute local paths for the binaries and each new fixture directory. The password file contains a disposable synthetic password and is removed after initialization.

```powershell
& "$pg/initdb.exe" -D "$run/pg" -U vera_t18 -A scram-sha-256 --pwfile=$pass --no-locale -E UTF8
& "$pg/postgres.exe" -D "$run/pg" -h 127.0.0.1 -p 5433
& "$fixture/mailpit/mailpit.exe" --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --database "$run/mailpit.db"
& "$fixture/minio.exe" server "$run/minio" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 --quiet
```

Set `NODE_ENV=test`, `DATABASE_URL` to the fresh cluster’s `postgres` database on port 5433, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `MAILPIT_BASE_URL=http://127.0.0.1:8025`, and `MINIO_ENDPOINT=http://127.0.0.1:9000`. Use matching synthetic MinIO credentials in `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`. Set `MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:3100,http://127.0.0.1:3100`, `VIDEO_DURATION_FFPROBE` to the native binary, and `PLAYWRIGHT_BROWSERS_PATH` to the installed Chromium bundle. The web and API fixtures use ports 3100 and 4100.

The owner signs up and verifies a real Mailpit activation link in Chromium. The existing HTTP helpers upload a generated sample to MinIO and approve and assign the reviewer. The reviewer, independent moderator and owner complete their actions in separate browser contexts. Test-only staff credentials and policies stay in the existing isolated harness. Matching checks cover claim projection and redaction, blocking, stale references after unblock, consent withdrawal/regrant, explicit claim revocation, reciprocal decisions and withdrawal of profile matching.

## Observed results

The local runs took place on 2026-11-22 (UTC+07). The 2026-11-23 review checked the existing console results and retained logs. Cases excluded by a filter are outside that invocation. The two clean demo runs were separate invocations, each covering desktop and mobile.

| Check | Actual command | Pass | Fail | Skip |
| --- | --- | ---: | ---: | ---: |
| Whitespace, Prisma validation and client generation, type checks and script syntax | `git diff --check`, `npm.cmd run prisma:validate`, `npm.cmd run prisma:generate`, `npm.cmd run lint`, and `node --check` on both video runner scripts | All commands exited 0 | 0 | 0 |
| Baseline targeted API unit | `npm.cmd test --workspace apps/api -- --runInBand review matching assignment-grants` | 61 | 0 | 0 |
| Baseline PostgreSQL reviewer, claims and matching | `npm.cmd run test:integration --workspace apps/api -- assignment-access review-claims.integration matching-api` | 122 | 0 | 0 |
| Full API unit with native FFprobe | `npm.cmd test --workspace apps/api -- --runInBand` | 336 | 0 | 0 |
| Demo run 1 and full video/review browser suite | `node scripts/run-video-e2e.cjs` | 10, including desktop and mobile joined scenarios | 0 | 0 |
| Demo run 2, focused | `node .venv/t18/browser.cjs video --grep "T18 demo"` | 2 | 0 | 0 |
| Shared UI and accessibility | `node .venv/t18/browser.cjs ui` | 218 | 0 | 0 |
| Auth browser | `node .venv/t18/browser.cjs auth` | 36 | 0 | 0 |
| Member browser | `node .venv/t18/browser.cjs member` | 4 | 0 | 0 |
| Safety browser, first attempt | `node .venv/t18/browser.cjs safety` | 0 | 4 | 0 |
| Clean migration deploy | `node node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma` | 23 migrations applied | 0 | 0 |
| Full PostgreSQL integration | `npm.cmd run test:integration --workspace apps/api` | 578 | 0 | 0 |
| Safety browser, on fresh fixtures with corrected runner IDs | `node .venv/t18/browser.cjs safety` | 4 | 0 | 0 |

The first video invocation also built both workspaces successfully. Its test cases finished before the Windows runner released all three owned Node server processes. After the schema, bucket and mailbox cleanup check returned zero, those processes were stopped by PID and Playwright exited 0 with 10 passes. The focused repeat used a worktree-local launcher to start and stop the same Nest test host and Next build as directly owned processes. It imported the repo’s video Playwright config and kept its test selection, projects and global teardown while disabling Playwright’s server process management. Both runs started and finished with zero fixture schemas, MinIO buckets and Mailpit messages and no runtime manifest. Reported Playwright durations were 3.4 minutes for the full video invocation, including the teardown wait, and 20.3 seconds for the focused repeat.

The existing case matrix covers draft/QA authorization and stale writes, concurrent edit/submit and approval/return, claim and matching audit rollback, consent withdrawal, claim revocation, block/unblock, and rejection of stale matching capabilities. The initial targeted runs reproduced no application defect. The joined demo increases regression coverage without changing application code.

The first Safety run stopped at the existing runner’s isolation guard. The temporary Windows launcher omitted `VERA_SAFETY_E2E_RUN_ID`, which must match the auth fixture’s run ID for that suite. The local launcher now supplies both IDs as the normal Safety runner does. The first restart checked MinIO before it was listening and exited before browser tests started.

Full PostgreSQL integration passed 38 suites in 596.7 seconds with the default test timeouts. The Safety repeat passed in 14.5 seconds. Post-run checks found zero fixture schemas, buckets and messages and no runtime manifest. The isolated integration cluster retained the deployed migration history in its public schema. All owned fixture processes exited and the associated loopback listeners were absent. The sandbox rejected recursive removal of the stopped fixture directories. Those directories and the actual runner logs remain under the ignored `.venv/t18` path.

The Windows HTTPS runner imports its disposable CA into the user Root certificate store outside the authorized worktree. The synthetic HTTPS job passed in T16 CI at `3507d21`. Fresh HTTPS and proxy evidence remains a release-candidate check. [T16 CI run](https://github.com/24520637/vera-match/actions/runs/45037118321).
