# C095 — Restriction recovery evidence and closed-fence procedure

Status: **PARTIAL — rehearsal verified; lifecycle-safe production recovery BLOCKED**. Huong / T17. Stacked on C065 [PR #35](https://github.com/24520637/vera-match/pull/35), commit 3b03632; owner decisions C1–C6 are [PR #34](https://github.com/24520637/vera-match/pull/34). No production restriction journal, recovery fence service or erasure mechanism is implemented by this PR.

## Actual evidence

The unchanged native test:ops script has successfully dumped/restored the complete disposable database and compared all FK/trigger definitions, data and immutable SAFETY audit enforcement at **24 migrations / 54 foreign keys / 76 non-internal triggers**. It never dumps the configured developer database. This supplements historical 12/15/22/23-migration rehearsals, not retroactive edits to them.

The new recovery-restrictions PostgreSQL integration test uses only a nonce-owned synthetic schema for its source and a separately created nonce-owned target database. pg_dump is explicitly restricted to that source schema; no public/developer records are included. Both source and target identities are checked as loopback PostgreSQL 18 on port 5433. Native pg_dump/pg_restore, archive SHA-256 recheck/listing, single-transaction restore and migrate deploy are executed, with credentials only in child environment variables. The temporary archive and registered target/schema are removed; no shared reset, forced DB drop or real-user media.

| Check | Actual result |
| --- | --- |
| Real integrated fixtures | Actual native measured video upload, expert draft/submit, QA, owner claim confirmation/sharing and matching; synthetic policy/MFA evidence only in guarded test fixtures. |
| Pre-closure backup | Real custom-format dump; archive integrity rechecked before restore. |
| Source restriction | Real C065 HTTP closure, session revocation and authoritative OFF tasks; old matching ACCEPT returns 404. |
| C051/media source reconciliation | Active assignment cancelled once with immutable event; real MinIO HEAD verifies final-object absence. Cleanup remains pending while genuine PUT capability lifetime remains. |
| Isolated restoration and migration | PASS. Actual source/target migration/FK/trigger counts match; immutable ReviewDecisionEvidence rejects deletion. |
| Old session after restore | **Reproduced negative control:** actual SessionService resolves the old token again. |
| Old consent and closure | **Reproduced negative control:** five pre-closure grants return and closure ledger is absent. No real policy publication is implied. |
| Old assignment/video state | **Reproduced negative control:** exact pre-backup assignment snapshot and READY video metadata return; the original source remains restricted/cleaned. No assignment state is fabricated. |
| Stale matching authority | **Reproduced negative control:** actual restored MatchingService accepts the pre-closure opaque reference with the same synthetic handle key. Target has no HTTP listener. |
| Lifecycle-safe recovery | **BLOCKED:** no independent post-backup restriction journal or authenticated high-watermark exists. A successful SQL restore is not a safe service cutover. |

The first added assertion guessed IN_PROGRESS for a draft fixture; the actual contract retained ASSIGNED. It was corrected to compare the entire real pre-backup snapshot, then the rehearsal passed. No business lifecycle changed. The expected negative-control result is a passing regression that demonstrates the missing recovery guarantee, never a production readiness claim.

## Reconciliation, outage and acknowledgement evidence

C054 [PR #32](https://github.com/24520637/vera-match/pull/32), commit dec6d1d, independently executed 75 native workflow cases, including a real storage refusal, new worker processes, repeated deletion, late PUT after tombstoning, genuine capability expiry and provider-verified cleanup. C065 executed actual closed-owner worker handoff and 50 integration cases. Existing C051 tests cover concurrent scans, durable receipts, audit rollback, fair retry scheduling and lost acknowledgement. These linked results are reused as evidence; this PR does not pretend to rerun every browser/process race or to reconstruct restrictions absent from a backup.

Post-restore cancellation/cleanup/matching/closure reconciliation remains BLOCKED until the independent restriction replay exists. Do not restart ordinary traffic and assume workers will infer missing closure/withdrawal evidence. No worker may fabricate COMPLETE, rewrite terminal assignment evidence or resurrect a generation to repair an old snapshot. Current-key HEAD absence does not prove backup/version-history erasure.

## Operator procedure — keep traffic closed

1. Huong leads the recovery/security decision; Phuc verifies domain reconciliation. Before production, assign an authorized deployment operator and real on-call delivery channel. Keep the restored service isolated: no application listener, public routing or capability issuance.
2. Verify encrypted backup provenance/integrity, exact target identity, key custody, deployment/migration revisions and approved backup/hold scope. Never pass password-bearing URLs as command arguments or restore over the live/shared developer DB. Our synthetic temporary archive is not evidence of production encryption/ACL/PITR.
3. Restore into a fresh authorized isolated target. Run migrate status/deploy only for that approved target, verify migration checksums and complete FK/trigger definitions, immutable evidence probes and retained subject mappings. Rehearse before cutover; do not disable triggers or reset a database.
4. Obtain the independently durable restriction journal through a verified signed current high-watermark. Replay PREPARED and confirmed restrictions conservatively before exposing APIs. A same-database outbox is insufficient when an older backup loses unexported restrictions. Journal authenticity, monotonic sequencing, independent credentials and missing/stale-checkpoint rejection are mandatory. **This step is currently unavailable: STOP here for production.**
5. Once a real replay implementation is reviewed, reconcile CLOSED barriers/revoked credentials/OFF generations, C051 CAS/events/receipts, video tombstones and late incoming PUTs, Review/QA/Claims source loss, and Matching invalidations. Do not restore objects or rebind old permissions automatically. Every consumer supplies its own genuine receipt; missing consumers remain pending.
6. Verify provider state, outstanding capability expiry, cleanup retries and restored immutable history independently. Failed DB/provider acknowledgement remains unknown/pending until checked. Regrant/unblock/reapproval does not reopen old restricted work.
7. Open a production fence only after authorized owners verify all required evidence and sign off the measured cutover. The existing application has no independently verified production fence/journal; this document does not supply one.

## Alerting and recovery objectives

Use code-only aggregate heartbeat/backlog/oldest-age/retry metrics and service readiness; no account IDs, object keys, signed URLs, report contents or raw DB/provider errors. Huong owns incident triage, Phuc owns domain reconciliation corrections, and the designated operator owns deployment execution.

Selected engineering objectives from C5: RPO 24 hours and RTO 4 hours, unmeasured in deployment. Warn after 15 minutes of worker failure/backlog; page after one hour of cleanup overdue beyond actual capability expiry; declare an incident after 24 hours unresolved. Escalate immediately for unauthorized access, integrity failure or a missing/unverifiable restriction checkpoint. Preserve restricted evidence and keep traffic closed. Do not mark failed tasks complete merely to meet an objective.

**NOT RUN:** production encrypted/off-site backup, actual ACL/role/key recovery, PITR, MinIO disaster/version-history recovery, deployed supervisor/paging delivery, measured RPO/RTO, real SMTP-provider delivery and legal retention/purge acceptance. No real on-call/provider approval is invented.

## Reproduce safely

Run the existing npm run test:ops for the fresh full-catalog restore. Run the API Jest integration suite filtered to recovery-restrictions under the established test environment, native PostgreSQL/MinIO/Mailpit and absolute native FFprobe/FFmpeg configuration. The disposable fixture guards are mandatory; never copy this test into an operator script targeting shared data.

Branch quality checks executed: Prisma validate/generate PASS; API unit 336/336 PASS; API/web production builds and TypeScript/lint PASS. The new native PostgreSQL/MinIO/Mailpit restore negative control PASS (one scenario with the subchecks above). No new test is skipped. Browser E2E for this documentation/test-only delta is NOT RUN locally; unchanged C065 backend CI passed, and fresh CI runs this branch separately.
