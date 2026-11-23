# T20 C104 release verification evidence

**Draft for Hương and Phúc’s cross-review. Internal demonstration only, using synthetic adults and recordings.** The historical T20 baseline is `07e0d23a84046d55f36d15ee558de8f3e9124ab3`. PR #40’s published head is `a2b16323b32793a6d63146d151a869ac605ab2d1`. The local review uses merge commit `18ec228e3e05831d394e5a1103076fd7e570533a`, with `a2b1632` and integrated `develop` `e23a4d9` as parents, plus the uncommitted review fixes. A detached compatibility check applied the proposed files to `3c0f813`, which includes PRs #33, #36 and #37. The review branch has yet to integrate that revision. [Historical baseline](https://github.com/24520637/vera-match/commit/07e0d23a84046d55f36d15ee558de8f3e9124ab3) · [Integrated develop commit](https://github.com/24520637/vera-match/commit/e23a4d9732b7d031e263461a5220956ac8a87d02) · [Compatibility baseline](https://github.com/24520637/vera-match/commit/3c0f8139dcea081844c3db6f72dd9300c76bfa39) · [PR #40](https://github.com/24520637/vera-match/pull/40)

The historical D10 plan gives C104 the scope “Document CI results, migration evidence and residual limitations before tag” and the verification “Release evidence committed; tag separately only after approval.” This draft can be cross-reviewed. Commit and tag acceptance remain open. [Historical D10 plan](https://github.com/24520637/vera-match/blob/5deaf06/docs/COMMIT-PLAN.md#d10)

## Verification status

**PASS** means the scoped check ran and met its expectation. **FAIL** means the observed result missed its expectation. **NOT RUN** means the specific check was not executed. **BLOCKED** identifies a missing prerequisite or approval.

| Check | Status | Evidence or remaining requirement |
| --- | --- | --- |
| Integrated CI at `07e0d23` | **PASS** | Develop push run `45108417225`. The checkout log prints the full tested SHA. |
| C102 guided synthetic demo at historical baseline | **PASS** | Two independent scoped runs. Both desktop and mobile passed in each run, and both runners exited 0 after manual process cleanup. [Run results](T20-C102-RESULTS.md) |
| C102 earlier demo attempts on local merge `18ec228` | **FAIL** | Both projects reached the MinIO upload and failed. The diagnostic retry recorded HTTP 507 `XMinioStorageFull`. [Final review results](T20-C102-RESULTS.md#final-review-on-current-develop) |
| C102 storage preflight and early cleanup | **PASS** | Direct S3 reproduced the 507 on C:. The new runner probe failed before API readiness or Chromium and cleaned the owned fixture automatically. [Storage refusal follow-up](T20-C102-RESULTS.md#storage-refusal-follow-up) |
| C102 full post-fix replay | **PASS** | Direct S3 PUT 200 on C:. Desktop and mobile passed 2/2, runner exited 0 and cleanup was automatic. [Successful replay](T20-C102-RESULTS.md#successful-integrated-replay) |
| C102 compatibility check on `3c0f813` with the proposed T20 files | **PASS** | S3 PUT 200 on C:, Playwright 2/2, automatic cleanup, 24 disposable fixture migrations and fixture regression tests 4/4. This check used a detached working tree. [Compatibility check](T20-C102-RESULTS.md#compatibility-check-on-updated-develop) |
| C102 fixture on D: | **NOT RUN** | The directory was visible. File and MinIO writes there are outside the session’s writable scope. |
| C102 fixture cleanup | **PASS** | Before and after each run there were zero fixture schemas, buckets and messages, and no runtime manifest. All demo service listeners closed after cleanup. |
| Automatic Windows web-server shutdown at baseline | **FAIL** | Three run-owned Node processes remained after both cases passed in each baseline run. PID-specific intervention was required. [Cleanup procedure](T20-DEMO-RUNBOOK.md#4-verify-cleanup-and-handle-a-windows-teardown-stall) |
| Automatic Windows web-server shutdown with the T20 fix | **PASS** | The earlier local focused run exited 0 and both owned servers stopped. The integrated review also verified automated shutdown and zero fixture counts on both failed demo runs. [Fix verification](T20-C102-RESULTS.md#windows-teardown-fix-verification) · [Final review results](T20-C102-RESULTS.md#final-review-on-current-develop) |
| CI on published PR #40 head `a2b1632` | **PASS** | Run `45135510851` passed on the prior PR revision. [PR CI](https://github.com/24520637/vera-match/actions/runs/45135510851) |
| CI on integrated develop `e23a4d9` | **PASS** | Push run `45199967366` completed successfully. Its SHA predates the local review fixes. [Develop CI](https://github.com/24520637/vera-match/actions/runs/45199967366) |
| CI on upstream develop `3c0f813` | **PASS** | Push run `45210618676` completed successfully on the upstream SHA. The CI run covers upstream code. [Develop CI](https://github.com/24520637/vera-match/actions/runs/45210618676) |
| CI on the local merge and review fixes | **NOT RUN** | Neither the local merge nor the uncommitted follow-up fixes have CI. Verify the exact updated PR SHA. |
| Local integrated schema migration | **PASS** | The runner applied 24 migrations to its disposable schema, including C065. The retained base T20 database was not migrated. |
| Local integrated API and web verification | **PASS** | The follow-up lint (TypeScript) and build passed for both workspaces, along with Prisma validation. The combined C065 legacy migration and Matching API suites passed 26/26. Fixture cleanup and storage preflight tests passed 4/4. |
| C103 documentation checks | **PASS** | Links, PowerShell syntax, fixture service commands and Git diff were checked. The runbook includes historical screenshots and records their source. [Runbook](T20-DEMO-RUNBOOK.md) |
| C103 independent clean checkout and command paths | **PASS** | Detached clean clone of `07e0d23`. The documented runner, config, lockfile and Prisma schema were present. No dependencies were installed in that clone. |
| C103 fresh-developer setup and full replay | **NOT RUN** | Local demo runs used existing binaries and dependency junctions. A developer unfamiliar with the setup still needs to install independent dependencies and follow the README through the full run. |
| Local Prisma migration and SQL verification | **PASS** | Prisma validation, initial deploy, subsequent status and SQL verification passed. All 23 completed names and checksums match the committed history. |
| C095 synthetic backup and isolated restore in exact-SHA CI | **PASS** | The CI job restored 23 migrations and verified the canaries and catalog. See the recovery evidence below. |
| C095 local Windows backup and restore | **BLOCKED** | Matching PostgreSQL 18 `pg_dump` and `pg_restore` are absent from the available local bundle and PATH. No local T20 recovery rehearsal was executed. |
| Deployed HTTPS/proxy, production restore and operational recovery drill | **NOT RUN** | CI checked a disposable HTTPS topology and a synthetic database restore. A deployed-path test and approved recovery drill remain outstanding. |
| C104 evidence commit and public release | **BLOCKED** | Evidence is awaiting cross-review and explicit commit authorization. T17/T19 and production gates remain open. A tag requires separate approval. |

## CI provenance and results

Develop push run `45108417225` (CI #144), job `137474946123`, succeeded. Run metadata identifies event `push`, branch `develop` and full head SHA `07e0d23a84046d55f36d15ee558de8f3e9124ab3`. The checkout step independently printed that SHA. PR #39 runs `45047743675` at `f918b69` and `45102992238` at `2d1d83b` are earlier evidence. Git tree `5077ef03eb5c78933eb44995f47421a89f3ea655` is identical at `2d1d83b` and `07e0d23`. [Integrated CI run](https://github.com/24520637/vera-match/actions/runs/45108417225) · [Integrated CI job and logs](https://github.com/24520637/vera-match/actions/runs/45108417225/job/137474946123) · [Earlier PR CI](https://github.com/24520637/vera-match/actions/runs/45047743675) · [Final PR CI](https://github.com/24520637/vera-match/actions/runs/45102992238)

| Verified CI step | Result in the job log |
| --- | --- |
| Dependency install, Prisma validate/generate and API/web build | All succeeded. |
| API unit | 33 suites passed. 332 tests passed and 4 were skipped in the default unit step. |
| API integration | 38 suites and 578 tests passed. |
| Shared UI, auth, member and safety | 218 UI, 36 auth, 4 member and 4 safety tests passed. |
| Private video and native media | 13 focused video-duration unit tests and 10 video browser tests passed. |
| Disposable HTTPS and proxy | 10 browser tests passed. |
| Migrations and synthetic recovery | All 23 migrations deployed and C095 restore passed. |
| CI fixture cleanup and reports | Mailpit, MinIO and PostgreSQL stop steps passed. The run lists a `ui-test-report` artifact with seven-day retention. |

See the [CI workflow](../.github/workflows/ci.yml) for the executed commands and artifact configuration.

## PostgreSQL migration evidence

The dedicated local `vera_match_t20` database on PostgreSQL 18.7 used schema `public`. The initial `prisma migrate deploy` completed with exit 0. C104 rechecked database and cluster identity with a read-only SQL probe, and reran `prisma validate` and `prisma migrate status` with the committed schema. Both exited 0, and status reported “Database schema is up to date!” The SQL audit found 23 completed, zero incomplete or rolled back, and all 23 migration names and SHA-256 checksums matched files at `HEAD`, accounting for Windows checkout line endings. No migration was reapplied during the recheck. [Committed migrations](../apps/api/prisma/migrations) · [Prisma schema](../apps/api/prisma/schema.prisma)

<details>
<summary>23 applied migrations at the historical baseline</summary>

```text
20261111110738_init
20261115160000_add_member_resource_revisions
20261116020000_add_consent_evidence_and_handoff
20261116120000_add_expert_credentials_and_assignment_revision
20261116170000_private_video_upload
20261116180000_private_video_cleanup
20261116190000_video_withdrawal_generation
20261117010000_prevent_expert_identity_reuse
20261117150000_add_safety_relations
20261118010000_assignment_consent_and_idempotency
20261118050000_assignment_cancellation_evidence
20261118120000_assignment_cancellation_scan
20261118120000_assignment_moderator_grants
20261119100000_review_draft_invariants
20261120010000_video_duration_retry_identity
20261120100000_private_review_decisions
20261120111000_review_claim_provenance
20261120112000_review_dispute_workflow
20261120113000_review_claim_feedback
20261120114000_review_dispute_source_closure
20261121100000_durable_review_decision_evidence
20261121101000_protect_t12_review_audit
20261121110000_match_decision_invariants
```

</details>

The updated tree adds [`20261122133000_account_closure`](../apps/api/prisma/migrations/20261122133000_account_closure/migration.sql). On local merge `18ec228` with review fixes, a read-only probe during API readiness confirmed 24 completed migrations in the runner-owned fixture schema, including the new C065 migration. The base `public` schema still held its historical 23 migration records.

## C095 recovery evidence and gaps

- The C095 runbook is marked `PARTIAL`. Its historical local rehearsal at `69603c2` restored 22 migrations, 50 foreign keys and 61 triggers. The runbook and rehearsals are present through PR #27. [C095 operations runbook](C095-OPERATIONS-RUNBOOK.md) · [PR #27](https://github.com/24520637/vera-match/pull/27)
- On `07e0d23`, the CI job ran `npm run test:ops` using disposable PostgreSQL 18 databases. The log records a successful restore of **23 migrations, 50 foreign keys and 65 triggers** and removal of the owned databases and archive. The script checks restored synthetic data, FK/trigger definitions, invalid FK rejection and the protected SAFETY audit canary. [Integrated CI job](https://github.com/24520637/vera-match/actions/runs/45108417225/job/137474946123) · [Recovery script](../scripts/verify-synthetic-backup.cjs)
- The C065 foundation records a native PostgreSQL rehearsal at **24 migrations, 54 foreign keys and 76 triggers**. The exact `e23a4d9` develop CI job also reported its C095 restore step successful during this review. Local T20 recovery remains blocked on missing Windows PostgreSQL backup tools. [C065 evidence](C065-ACCOUNT-CLOSURE-FOUNDATION.md) · [Develop CI job](https://github.com/24520637/vera-match/actions/runs/45199967366/job/137780510139)
- CI sets `C095_EVIDENCE_DIR` to runner temp. The workflow uploads the UI report, and the run lists no separate C095 JSON artifact. The CI job log is the verified record for this rehearsal. No local T20 `c095-*.json` was available.
- Missing recovery verification includes rollback and cutover on the final candidate, restore of deployed ownership/ACLs and encryption keys, point-in-time and off-site recovery, database/object reconciliation and measured RPO/RTO. The synthetic restore uses `--no-owner --no-acl`. A trusted post-backup restriction journal, replay and cutover fence are needed to prevent restoration of revoked sessions, consent, assignments or media. PR #37 merged upstream as a restriction-loss negative control. Its test is outside the locally tested tree and the recovery fence remains open. [C095 recovery procedure](C095-OPERATIONS-RUNBOOK.md#backup-and-restore-procedure--production-requires-a-separate-approved-drill) · [Recovery PR #37](https://github.com/24520637/vera-match/pull/37)

## Integration state and Hương’s review gates

Integrated `develop` at `e23a4d9` contains the C054 workflow revocation tests (#32, `56c0c68`), the lifecycle engineering decisions (#34, `d4255f4`) and partial C065 closure API and migration (#35, `e23a4d9`). The seven commits since `07e0d23` are the four topic commits `dec6d1d`, `553ea7a`, `818153f`, `3b03632` and those three merges. C065 adds the CLOSED access barrier and restricted status, with production blocked by `CLOSURE_RELEASE_PENDING`. Domain consumer receipts, final erasure and production approval remain open. The cross-workflow bilateral block suite (#33) has since merged upstream at `a0f9fb7` and is outside the locally tested tree. Closure UI (#36) and the restriction-loss negative control (#37) are also outside this local tree. [C065 foundation](C065-ACCOUNT-CLOSURE-FOUNDATION.md) · [PR #32](https://github.com/24520637/vera-match/pull/32) · [PR #33](https://github.com/24520637/vera-match/pull/33) · [PR #34](https://github.com/24520637/vera-match/pull/34) · [PR #35](https://github.com/24520637/vera-match/pull/35) · [PR #36](https://github.com/24520637/vera-match/pull/36) · [PR #37](https://github.com/24520637/vera-match/pull/37)

| Gate | Required review |
| --- | --- |
| T17 C093 | Approve build/migration evidence and rollback or recovery procedure on the release candidate. Empty-database deploy and a synthetic restore cover only part of this gate. |
| T17 C094 | Review the AUTH/MEDIA/REVIEW negative matrix and confirm no unresolved critical/high security findings. |
| T17 C095 | Sign the operational checklist for cookies, mail, MinIO, secrets and staff access, and record ownership and recovery approval. |
| T19 C099 | Attach reset/session, media, owner IDOR, deletion and revoke regression evidence to the release PR. Confirm the disposition of the outstanding workflow suites. |
| T19 C100 | Approve access, consent, disclosure and retention constraints and the internal-demo wording. Confirm lifecycle and reconciliation requirements. |
| T19 C101 | Reconcile the list of approved fixes, merged PR/SHA mapping, changelog and any separately approved backmerge. |

Before public or real-user use, Hương and Phúc must cross-review the candidate, with no open P0 blocker. Required deployment checks include trusted staff identity and session-bound MFA, approved consent and retention/deletion policies, private storage ACL/TLS and signed media expiry, Secure cookies and trusted-proxy attribution, TLS SMTP and real delivery, multi-instance rate limiting, key rotation, monitoring and recovery. Existing media capabilities can remain valid until expiry, and downloaded bytes cannot be recalled. The joined test uses test-only staff and policy fixtures. [Release notes](RELEASE-NOTES-v0.1.0.md) · [Release gate](TEST-PLAN.md#release-gate) · [Ownership](FEATURE-OWNERSHIP.md)

C103 awaits the full clean-checkout developer walkthrough. C104 remains a draft for Hương’s cross-review. Updated PR CI, the evidence commit, release approvals and separate tag approval remain open.
