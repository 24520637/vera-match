# C023 consent implementation boundary

This implements the C012 MVP technical contract, not production policy approval.
Only `/api/consents/me` GET/PATCH is added. Existing `Consent` remains the current
state store; Huong's Auth, AuditLog, account and media code are unchanged.

## Policies and transaction semantics

The runtime `ConsentPolicyRegistry` is empty: grants fail closed with HTTP 400
at `consents.<index>.policyVersion`. There are no real policy IDs, seeded policy
texts or production enable flags. Synthetic policies are injected only by tests;
test-only snapshots are also rejected outside NODE_ENV=test, including by
authoritative access checks if a synthetic database is accidentally reused. Approved policies
and their purpose/locale/version/content must undergo a separate rollout review.
Revocations never consult the current registry and require no new policy.

Consent state, separate aggregate CAS version, append-only events, idempotency
result and each withdrawal task commit in one transaction. The account row is
locked first, consistent with existing feature lock ordering. No automatic retry
is performed. Explicit OFF advances the version and emits OFF_REAFFIRMED even
when already OFF. Mixed grant/withdraw batches fail 400 at `_form`.

Keys are stored as SHA-256 hashes, scoped by opaque consent subject; fingerprints
include expectedVersion and purpose-sorted choices, including any supplied policy
ID. JSON object field order and consent array order do not change the fingerprint.
Matching unexpired keys replay the historical committed response, with
Idempotency-Replayed=true, without consulting a changed current policy. Different
payloads conflict. After the 24-hour technical deduplication window, old versions
still conflict; no events/versions are recreated. This is not approval of real-user
data retention. No production purge/retention worker is implemented.

Immutable evidence retains exact UTF-8 policy content, locale, version and a
verified SHA-256 digest. Unchanged IDs cannot acquire changed content. Grants
bind events/state to that evidence; legacy withdrawals explicitly mark evidence
gaps without fabricating old policy acceptance. No profile/questionnaire/
preferences projection is read during withdrawal.

## Identity, deletion and retained evidence

ConsentLedger maps the live User to a random ConsentSubject and aggregate version.
User deletion removes that mapping and current Consent state through existing
cascades, but not ConsentSubject, events, policy snapshots, idempotency results or
withdrawal obligations. Events identify the own-member actor by the same opaque
subject, not raw User ID, email or session. This de-identifies the live mapping;
pseudonymous evidence is not claimed anonymous or legally compliant.

Ordinary UPDATE/DELETE/TRUNCATE of events/policy evidence is rejected by DB
triggers. FK restrictions protect referenced subjects/evidence. Production
least-privilege DB roles, approved retention/expiry/holds, privileged purging,
backup/restore suppression and identity-mapping policy remain open. DB owners
can alter triggers; this is not a guarantee against a privileged administrator.
No existing account-deletion or shared AuditLog behavior is changed.

## Authoritative access and durable withdrawal handoff

ConsentAccessService.isAllowed checks current account eligibility, current state
and verifiable accepted evidence. Missing state/evidence denies access; DB failure
does not become success. It does not infer policy approval for legacy grants.
withAuthorizedConsent serializes an authorization-sensitive consumer callback
against consent mutations using the same account lock. Consumers must complete
the protected action inside that callback; checking a flag and issuing access
afterwards is insufficient. Consumers still enforce role/assignment/ownership,
video status, block and other feature-specific requirements.

Every successful explicit withdrawal stores a PENDING ConsentWithdrawalTask
linked uniquely to its immutable event/version/purpose, even for already-OFF.
The task has attempts/nextAttemptAt/status/error-code/completion metadata for a
later worker. C023 does not run a worker, close assignments, purge objects, remove
cached matching contributions or integrate live consumers. Retry/escalation
ownership and safe domain-specific locators must be coordinated with Huong
before account deletion can erase metadata needed for physical cleanup.

The authoritative state changes before response success and the access interface
denies new checks after withdrawal. **Media/matching end-to-end enforcement is NOT
VERIFIED** until all consumers adopt it and test races/cache exclusion. No claim
is made that previously issued signed URLs or in-flight streams are immediately
revoked. The agreed 60-second playback target still needs provider verification.
Real-user retention, storage/backup policy and provider enforcement remain
PRE-PRODUCTION requirements; use synthetic data for validation.

## Migration and verification

`20261116020000_add_consent_evidence_and_handoff` adds nullable policy references
to Consent and six consent-specific tables. It does not rewrite initial/C019
migrations, transform legacy rows or modify shared AuditLog. Consent versions are
BIGINT constrained to JavaScript safe integers, independently of resource revisions.
Migration upgrades, fresh deployment, legacy preservation, immutability, CAS,
replay, atomic rollback and account-deletion survival are tested only in isolated
synthetic PostgreSQL schemas. Test execution results are reported separately.
