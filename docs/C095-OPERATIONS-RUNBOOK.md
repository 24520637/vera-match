# C095 — Operations and synthetic recovery rehearsal

Status: **PARTIAL**, T17 / Huong. Baseline refreshed to develop `8383d65` (15 migrations), including merged C035 and T08 draft APIs.
This is an operational preparation deliverable, not production acceptance or full Release QA.

## Executed evidence and limits

`npm run test:ops` performs a real PostgreSQL 18 custom-format backup and restore.
It accepts only loopback port 5433, requires CREATE DATABASE permission and matching
PostgreSQL 18 tools, and creates two fresh nonce-owned databases. It never dumps,
migrates, restores or drops the database named by the configured DATABASE_URL.
That connection is used only to inspect prerequisites and create/drop the owned fixtures.
Use the existing ignored local environment; do not put credentials in command arguments.

```powershell
npm run prisma:validate
npm run prisma:generate
npm run test:ops
```

On Windows the default tools directory is `C:/Program Files/PostgreSQL/18/bin`;
Linux uses `/usr/lib/postgresql/18/bin`. `C095_PG_BIN` can select an existing directory.
The script deploys the existing migration chain into the synthetic source, seeds
one unusable-login account/profile and a protected SAFETY audit canary, runs
pg_dump/pg_restore, and checks data, all completed migrations, every public FK and
non-internal trigger, an invalid FK insert, and rejection of deleting that SAFETY audit.
This does not imply that every AuditLog action is database-immutable.

PASS locally: two successive successful rehearsals, each with 12 migrations,
42 FKs and 41 triggers restored; source, target and archive removed after each run.
An initial rehearsal incorrectly assumed an arbitrary audit action had the SAFETY
immutability guarantee; the fixture was corrected to exercise the actual contract.
No application or migration change was needed. CI repeats the real rehearsal.

Optional `C095_EVIDENCE_DIR` must be an existing restricted directory outside the
repository. Evidence includes technical schema definitions/counts, not record contents
or connection strings. The archive contains synthetic data only and is removed.
A failed cleanup leaves an owned-resources.json manifest in its temporary directory;
verify its nonce and exact database names before a separately authorized retry.
Never replace an unknown resource or use DROP DATABASE FORCE to make cleanup pass.

Not verified here: production backups, encryption/ACL/key recovery, role ownership,
point-in-time recovery, off-site copies, real SMTP delivery, provider disaster recovery,
monitoring delivery, deployed TLS, capacity, or recovery objectives. The rehearsal
uses --no-owner/--no-acl and therefore cannot certify production role restoration.

## Backup and restore procedure — production requires a separate approved drill

1. The incident owner confirms the exact cluster/database, data classification,
   approved retention/holds, encrypted backup destination, access policy and key custody.
   Record application revision and migration checksums; never include credentials,
   personal rows, private storage keys or bearer URLs in the incident record.
2. Use a matching supported pg_dump with custom format and a restricted temporary
   credential mechanism. Never paste a password-bearing URL into shell history.
   Verify exit status and archive integrity; archive listing alone is not restore proof.
3. Restore into a newly provisioned, isolated target with no public app/storage access.
   Verify the target identity independently. Do not restore over the live database.
   Restore roles/ACLs through an approved procedure; they are excluded by our rehearsal.
4. Verify migration history/checksums, FK/trigger/index definitions, synthetic integrity
   probes, retained evidence and application readiness using restricted access.
   The pg_dump database snapshot does not atomically snapshot MinIO object contents.
5. Reconcile withdrawals, deletions, credential revocations and cleanup completed
   after the backup. Restoring old rows must not reactivate sessions, consent,
   assignments or media. A trusted post-backup restriction journal and a tested
   reconciliation procedure are **not implemented**. Keep public/private access closed
   until that gate is resolved and verified; restarting workers alone cannot reconstruct
   restriction evidence absent from the backup.
6. Compare object/DB consistency without granting public bucket access. Do not report
   erasure merely because a restored task is COMPLETE. Verify current provider state,
   in-flight capability expiry and applicable backup/hold obligations.
7. Cutover only after the designated owners accept evidence and the rollback decision.
   Measure actual recovery time/data loss in that drill; no RPO/RTO is approved here.

## Migration preflight and rollback decision

Run `npx prisma migrate status --schema apps/api/prisma/schema.prisma` with the
approved target secret loaded privately. Compare the reviewed migration chain and
deployed app revision; inspect drift and permissions without resetting data.
Rehearse upgrade/restore against disposable fixtures first. A successful empty-db
deploy does not prove compatibility with arbitrary legacy production rows.

Use `prisma migrate deploy` only against an explicitly authorized deployment target.
Do not run migrate reset/db push, rewrite successful migration history, or resolve a
failed migration as applied without proving the actual DDL state. If preflight fails,
stop rollout. Determine whether the old application can safely run against the applied
additive schema; prefer a reviewed forward correction. Backup restoration is a separate
incident decision with the restriction-resurrection gate above, never a routine down migration.

## Service health and restart — documented procedures, not an outage drill

API liveness is `GET /api/health`; `GET /api/health/ready` checks PostgreSQL and returns
503 on failure. Neither proves SMTP, storage, staff assurance, policy publication or
worker reconciliation. Mailpit local health: `http://127.0.0.1:8025/livez`;
native MinIO liveness: `http://127.0.0.1:9000/minio/health/live`.
Do not expose consoles or diagnostic data publicly.

Check the expected native process and port before restarting; do not kill an unknown
PID or start two writers on one data directory. Use the reviewed deployment supervisor
when selected. Local MinIO can be started by `node scripts/start-local-private-storage.cjs`
with ignored credentials; Mailpit uses its installed native executable, SMTP 1025,
inbox 8025. Local manual processes are not a production supervisor.
Stop gracefully so Nest disconnects Prisma and awaits worker scans; restore the same
reviewed storage configuration and migration-compatible app, then check readiness
and restricted synthetic flows. Do not change NODE_ENV to test to open production gates.

## SMTP / Mailpit outage

Check reachability and provider status without logging recipients, message bodies,
reset links or raw SMTP errors. Distinguish SMTP rejection from accepted delivery
followed by uncertain database confirmation; do not consume/revoke emailed tokens
manually or resend/reset rows blindly. Existing recovery transaction tests cover that
boundary, not real provider recovery. Public reset responses remain generic.
After recovery use a synthetic inbox/account with actual SMTP to verify delivery,
single-use reset and session revocation. Real provider TLS, sender-domain verification
and Gmail/Outlook delivery still require a deployment drill; Mailpit is not that proof.

## MinIO outage and private cleanup

Keep buckets private and authorizers fail-closed; do not bypass storage verification
or mark a video READY/erased by hand. Check native process, configured endpoint/bucket,
disk capacity and restricted credentials. Existing cleanup retries remain durable.
Provider remove/absence verification and any outstanding PUT expiry must precede
completion. Versioned storage is unsupported and must not be enabled as a quick fix.

Restricted aggregate inspection (read-only; run in the approved target context):

```sql
SELECT status, count(*) AS tasks, min("nextAttemptAt") AS earliest_attempt,
       max(attempts) AS maximum_attempts
FROM "VideoCleanupTask" WHERE status IN ('PENDING','RUNNING') GROUP BY status;
```

Do not select/export objectKey, uploadKey, bucket, private content or user identifiers.
Investigate VIDEO_CLEANUP_SCAN_FAILED, VIDEO_CLEANUP_RETRY_SCHEDULED and
VIDEO_CLEANUP_WITHDRAWAL_MAPPING_UNAVAILABLE; SCAN_RECOVERED is not erasure proof.
After storage/DB recovery verify pending work actually reconciles through normal
workers and provider checks. No public worker endpoint exists. Do not insert receipts,
reset attempts/revisions, drop tasks or fabricate COMPLETE. Full deployed outage/alert
routing and video-worker fairness under permanent unrelated failures are not certified here.

## C051 cancellation backlog

Use the existing aggregate ASSIGNMENT_CANCELLATION_HEARTBEAT lane counts/ages and
BACKLOG_OVERDUE, SCAN_FAILED, SCAN_RECOVERED, RETRY_SCHEDULED, MAPPING_UNAVAILABLE codes.
[The cancellation contract](ASSIGNMENT-CANCELLATION.md) defines eligibility and initial
engineering alert rules: 900-second backlog age, 3 scan failures/10 minutes, and
10-minute per-process missing heartbeat. These are existing proposed operational
defaults, not an approved SLA or evidence of alert delivery. A heartbeat can coexist
with overdue work; a receipt is consumer completion, not object erasure.

Restore DB availability/schema compatibility, let durable scan laps retry, and check
counts/ages plus actual terminal transitions and evidence in a restricted synthetic
case. Missing lineage requires an approved reconciliation decision; never infer an
owner or clear the shared task. Re-consent cannot revive an old binding. Preserve
User → Video → Assignment locking/CAS/events; don't bypass the service with bulk SQL.

## Authentication incident and secret rotation

Contain affected access through an approved incident response; retain minimal evidence.
The existing authenticated logout-all flow revokes that account's sessions; there is
no privileged bulk incident/session endpoint or C065 closure API to invent here.
Do not reset passwords or impersonate users to revoke accounts. Session rows use token
hashes; rotating SMTP/MinIO/DB credentials does not invalidate sessions automatically.
An emergency administrative revocation needs an explicitly reviewed procedure.

Inventory DB, SMTP, storage and deployment TLS credentials and their owners. Prepare
replacement credentials in the secret manager, check least privilege and downstream
dependencies, coordinate the cutover, verify synthetic operations, revoke old credentials,
and record only version/status evidence. Provider support for overlapping credentials,
URL invalidation and key rotation is not assumed. Previously issued signed capabilities
may survive to expiry; don't claim rotation recalls downloaded bytes. Never commit .env,
print environment dumps, log bearer material or attach dumps/private test traces to a PR.

## Escalation and release decisions

Huong owns Auth/Consent/Video/Safety restriction semantics; Phuc must review shared
assignment/review compatibility and migration/evidence implications. An actual on-call
incident commander, backup operator and monitoring destination remain unassigned.
During a privacy incident, keep restriction processing running and public sensitive
access closed; communicate sanitized impact, current containment and next verification.

Before production, both owners must agree deployment topology/process supervision,
supported storage provider, least-privilege roles, backup retention/encryption/holds,
post-backup restriction reconciliation, RPO/RTO/SLO, monitoring routing, escalation
ownership and drill evidence. Also require real session-bound staff MFA/provisioning,
approved consent snapshots, deployed HTTPS/cookie/proxy acceptance, outstanding
dependency remediation and downstream Expert Review/QA/Matching security acceptance.
This runbook approves none of those policies or production gates.
