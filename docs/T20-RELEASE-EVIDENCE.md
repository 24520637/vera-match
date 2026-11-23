# T20 C104 release verification evidence

**Draft for Hương and Phúc’s cross-review. Internal demonstration only, using synthetic adults and recordings.** Evidence was checked on 2026-11-23 (UTC+07). The tested baseline is `07e0d23a84046d55f36d15ee558de8f3e9124ab3`, the integrated `develop` commit from PR #39 and the HEAD of `phuc/test/t20-demo-release-evidence` during local verification. The T20 documentation changes are under review in the worktree. [Baseline commit](https://github.com/24520637/vera-match/commit/07e0d23a84046d55f36d15ee558de8f3e9124ab3) · [PR #39](https://github.com/24520637/vera-match/pull/39)

The historical D10 plan gives C104 the scope “Document CI results, migration evidence and residual limitations before tag” and the verification “Release evidence committed; tag separately only after approval.” This draft can be cross-reviewed. Commit and tag acceptance remain open. [Historical D10 plan](https://github.com/24520637/vera-match/blob/5deaf06/docs/COMMIT-PLAN.md#d10)

## Verification status

**PASS** means the scoped check ran and met its expectation. **FAIL** means the observed result missed its expectation. **NOT RUN** means the specific check was not executed. **BLOCKED** identifies a missing prerequisite or approval.

| Check | Status | Evidence or remaining requirement |
| --- | --- | --- |
| Integrated CI at `07e0d23` | **PASS** | Develop push run `45108417225`. The checkout log prints the full tested SHA. |
| C102 guided synthetic demo | **PASS** | Two independent scoped runs. Both desktop and mobile passed in each run, and both runners exited 0 after manual process cleanup. [Run results](T20-C102-RESULTS.md) |
| C102 fixture cleanup | **PASS** | Before and after each run there were zero fixture schemas, buckets and messages, and no runtime manifest. All demo service listeners closed after cleanup. |
| Automatic Windows web-server shutdown at baseline | **FAIL** | Three run-owned Node processes remained after both cases passed in each baseline run. PID-specific intervention was required. [Cleanup procedure](T20-DEMO-RUNBOOK.md#4-verify-cleanup-and-handle-a-windows-teardown-stall) |
| Automatic Windows web-server shutdown with the T20 fix | **PASS** | Local worktree run of the official command passed desktop/mobile and exited 0. Both owned server PIDs exited automatically. Occupied-port and API startup-failure probes passed. [Fix verification](T20-C102-RESULTS.md#windows-teardown-fix-verification) |
| CI on the T20 teardown fix | **NOT RUN** | The verified integrated run is for the committed baseline. The worktree fix requires CI on the eventual PR revision. |
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
<summary>23 applied migrations at the tested SHA</summary>

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

## C095 recovery evidence and gaps

- The C095 runbook is marked `PARTIAL`. Its historical local rehearsal at `69603c2` restored 22 migrations, 50 foreign keys and 61 triggers. The runbook and rehearsals are present through PR #27. [C095 operations runbook](C095-OPERATIONS-RUNBOOK.md) · [PR #27](https://github.com/24520637/vera-match/pull/27)
- On `07e0d23`, the CI job ran `npm run test:ops` using disposable PostgreSQL 18 databases. The log records a successful restore of **23 migrations, 50 foreign keys and 65 triggers** and removal of the owned databases and archive. The script checks restored synthetic data, FK/trigger definitions, invalid FK rejection and the protected SAFETY audit canary. [Integrated CI job](https://github.com/24520637/vera-match/actions/runs/45108417225/job/137474946123) · [Recovery script](../scripts/verify-synthetic-backup.cjs)
- CI sets `C095_EVIDENCE_DIR` to runner temp. The workflow uploads the UI report, and the run lists no separate C095 JSON artifact. The CI job log is the verified record for this rehearsal. No local T20 `c095-*.json` was available.
- Missing recovery verification includes rollback and cutover on the final candidate, restore of deployed ownership/ACLs and encryption keys, point-in-time and off-site recovery, database/object reconciliation and measured RPO/RTO. The synthetic restore uses `--no-owner --no-acl`. A trusted post-backup restriction journal, replay and cutover fence are needed to prevent restoration of revoked sessions, consent, assignments or media. Draft PR #37 is a negative control for restriction loss. Its test is outside this baseline and the recovery fence remains open. [C095 recovery procedure](C095-OPERATIONS-RUNBOOK.md#backup-and-restore-procedure--production-requires-a-separate-approved-drill) · [Draft recovery PR #37](https://github.com/24520637/vera-match/pull/37)

## Integration state and Hương’s review gates

The baseline includes the C095 runbook and synthetic recovery tooling from PR #27 and the account lifecycle proposal from PR #28. It includes password reset and session regression suites, private media and owner authorization tests, and the C084 HTTPS/proxy suite. The additional workflow revocation races (#32), cross-workflow bilateral block suite (#33) and lifecycle owner decisions (#34) remain open. The closure API and migration (#35), closure UI (#36) and old-backup restriction negative control (#37) remain draft and absent from the baseline. [Lifecycle proposal](C065-ACCOUNT-LIFECYCLE-CONTRACT.md) · [PR #28](https://github.com/24520637/vera-match/pull/28) · [PR #32](https://github.com/24520637/vera-match/pull/32) · [PR #33](https://github.com/24520637/vera-match/pull/33) · [PR #34](https://github.com/24520637/vera-match/pull/34) · [PR #35](https://github.com/24520637/vera-match/pull/35) · [PR #36](https://github.com/24520637/vera-match/pull/36) · [PR #37](https://github.com/24520637/vera-match/pull/37)

| Gate | Required review |
| --- | --- |
| T17 C093 | Approve build/migration evidence and rollback or recovery procedure on the release candidate. Empty-database deploy and a synthetic restore cover only part of this gate. |
| T17 C094 | Review the AUTH/MEDIA/REVIEW negative matrix and confirm no unresolved critical/high security findings. |
| T17 C095 | Sign the operational checklist for cookies, mail, MinIO, secrets and staff access, and record ownership and recovery approval. |
| T19 C099 | Attach reset/session, media, owner IDOR, deletion and revoke regression evidence to the release PR. Confirm the disposition of the outstanding workflow suites. |
| T19 C100 | Approve access, consent, disclosure and retention constraints and the internal-demo wording. Confirm lifecycle and reconciliation requirements. |
| T19 C101 | Reconcile the list of approved fixes, merged PR/SHA mapping, changelog and any separately approved backmerge. |

Before public or real-user use, Hương and Phúc must cross-review the candidate, with no open P0 blocker. Required deployment checks include trusted staff identity and session-bound MFA, approved consent and retention/deletion policies, private storage ACL/TLS and signed media expiry, Secure cookies and trusted-proxy attribution, TLS SMTP and real delivery, multi-instance rate limiting, key rotation, monitoring and recovery. Existing media capabilities can remain valid until expiry, and downloaded bytes cannot be recalled. The joined test uses test-only staff and policy fixtures. [Release notes](RELEASE-NOTES-v0.1.0.md) · [Release gate](TEST-PLAN.md#release-gate) · [Ownership](FEATURE-OWNERSHIP.md)

C102 passed locally with automatic teardown on the T20 worktree fix. C103 awaits the full clean-checkout developer walkthrough. C104 is ready for Hương’s cross-review of this draft and its evidence. CI on the fix, the evidence commit, release approvals and separate tag approval remain open.
