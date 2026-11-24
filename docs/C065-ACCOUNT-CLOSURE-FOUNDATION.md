# C065 — Account closure restriction foundation

Huong / T11. Implements the owner decisions in [PR #34](https://github.com/24520637/vera-match/pull/34), decision commit 553ea7a. **PARTIAL — external consumer needed**; final erasure is not implemented. Production is explicitly blocked by CLOSURE_RELEASE_PENDING, with no enabling environment flag. Development/test execution uses real session/password/consent/SQL and native services.

## Delivered protocol

POST /api/account-closure: authenticated verified ACTIVE MEMBER, exact Origin/JSON, UUID Idempotency-Key, confirmation CLOSE MY ACCOUNT, current password, expectedRevision 0. No submitted identity or ADMIN inheritance. Historical expert/moderator duties require separate staff deprovisioning. Password hashing/proof is outside locks; the locked transaction rechecks the actual hash and session. Sorted User then Session locks precede the authoritative consent transaction core. No SMTP/MinIO inside the closure transaction.

202 returns an opaque receiptId, RESTRICTED, revision 1 and cleanupPending true. Atomically create the durable unique ledger, immutable event and five PENDING consumer rows; write genuine OFF events/withdrawal handoffs for every actual consent purpose; revoke sessions, reset and verification tokens; set AccountStatus CLOSED and write minimal opaque receipt audit. Clear the browser cookie after commit. No User.delete, SUSPENDED overload or reopening route. Concurrent pre-authorized same-key requests replay one receipt; ordinary post-closure cookies are rejected.

C051 and video cleanup consume the actual generation-bound withdrawal tasks, cancel eligible owner assignments with real CAS/events, tombstone videos and reconcile staging/final objects. The media worker rechecks the closure under the owner lock and acknowledges MEDIA only after the current-generation cancellation and storage receipts exist, all videos have verified cleanup after upload expiry, and no active assignment remains. REVIEW_CLAIMS, MATCHING, SAFETY and RECOVERY remain pending. The account stays restricted.

Existing active-account/source/generation checks deny new login, recovery consumption, member/media authorization and Review/QA/Claims/Matching access after restriction. Queue readers additionally exclude assignments whose owner is CLOSED; immutable assignment evidence remains retained in the DB. This is the minimal C035 shared read barrier, not a queue redesign or grant revocation receipt.

## Restricted status

POST /api/account-closure/status-email accepts only an address to request generic 202 delivery, never a status lookup. The previously verified address receives a 256-bit random hash-only token via existing EmailService/native SMTP; /closure-status#token=… has 15-minute expiry, one-time use and 30-day renewal window. At most three unexpired capabilities, three deliveries per 15 minutes, 60-second minimum interval, plus per-IP/token quotas.

POST /api/account-closure/status accepts the capability only and atomically consumes all current tokens under the User lock. It returns sanitized state/revision/pending booleans, no identity or private evidence, and creates no ordinary session. Invalid/expired/replayed links share one error. Tokens are durable before SMTP; an ambiguous send never revokes an already mailed capability. Previous mailed links remain valid until consumption/expiry.

Email dispatch is a bounded in-process MVP queue: a process loss can lose an unsent email request; the owner may explicitly request another. It cannot reopen access or claim delivery. SMTP failure leaves closure restricted. Production SMTP and lost-mailbox support recovery are NOT verified/implemented here. Auth/closure rate limits are per-process; multi-instance quotas require a separate deployment design.

## Migration and precautions

One additive migration 20261122133000_account_closure adds CLOSED, four ledger/status tables, restrictive User FK, immutable identity/events/audit, monotonic token consumption and deferred User/ledger access-barrier checks. Pending consumer rows cannot be removed to bypass retention prerequisites. Do not edit successful history or reset a developer DB. Deploy only through the reviewed normal migration procedure after approval; disposable fixture deploy/legacy-upgrade tests do not authorize a shared DB migration.

The old baseline was 23 migrations / 50 FKs / 65 non-internal triggers. The new catalog is verified through disposable C095 evidence, not inferred from model counts. No physical evidence purge or trigger bypass is allowed.

## Remaining gates and domain obligations

- Phuc: real closure-bound minimization/receipts for Assignment/Queue grants, Review/QA, Claims/Disputes and Matching, preserving immutable history/CAS and no resurrection.
- Huong: genuine Safety retention acknowledgement and total closure reconciliation; current receipts stay PENDING.
- Operations: independently durable restriction journal/fence, backup replay and measured recovery. An older backup can restore pre-closure state; production restore remains fail-closed.
- Authorized owner/compliance: exact policy publication, release copy, retention/purge/hold authority. No real policies/MFA/legal evidence are created.

C066 UI is a separate deliverable. Restricted status is not proof of erasure.

Verification evidence: full integrated baseline 620/620 PASS; final boundary checks cover historical C032 duty, real in-transaction session expiry, real status-token 429 and private response headers. Native Mailpit and MinIO are exercised. A real isolated native PostgreSQL backup/restore confirmed 24 migrations / 54 foreign keys / 76 non-internal triggers, including immutable evidence rejection. No shared database was migrated. UI/browser acceptance is delivered separately in C066; production delivery and total erasure remain unverified.

Status delivery remains bound to the pre-closure verified channel: SQL guards prevent CLOSED accounts from silently rebinding email/verification/password/role. A separately reviewed support workflow is required for channel recovery. The internal ClosureReconciliationV1 type documents versioned consumer input and genuine receipt requirements; defining it acknowledges no consumer.

Final C065 acceptance: 50/50 PostgreSQL/native-service tests PASS, including 28 deterministic workflow/C033/upload-issuance orderings and the legacy upgrade. Final native backup/catalog rehearsal PASS at 24/54/76. Existing Consent and Queue companion suites passed; a historical-staff fixture initially read the snapshot wrapper incorrectly and was corrected to parse its actual content before a successful rerun.
