# C053: privacy and atomic audit regression on merged APIs

Status: PARTIAL. This delivery verifies existing Auth, Consent, owner media, C032/C033/C034/C051 and Safety boundaries. It does not implement or certify unmerged reviewer edit/submit/QA/claims/matching operations.

## Confirmed defects and corrections

Seven pre-fix PostgreSQL/HTTP probes reproduced raw upstream HttpException bodies reaching callers: training/confidentiality/evidence sources in C032 and C033, plus staff-assurance resolution in moderation. The injected diagnostic canary was synthetic; this is not evidence that production media or credentials were disclosed.

C032 now sanitizes only trusted source calls before applying existing business validation. C033 sanitizes assignment-evidence resolution. Moderation sanitizes only assurance-provider failure as HTTP 503 STAFF_ASSURANCE_UNAVAILABLE. Application-generated validation, missing/invalid MFA, session, role and ownership denials retain their existing semantics. No role, consent, generation, lock order, CAS, immutable event, idempotency or storage-signing contract is relaxed.

C034's merged provider-error wrapper remains unchanged. No real MFA/provisioning provider or policy approval is supplied. Phuc must review the narrow C032/C033 boundary changes before merge; his active branches and PRs are not modified.

## Regression evidence

The new privacy-audit integration suite uses the actual AppModule, real Argon2 login, disposable UUID PostgreSQL schema, native private MinIO bucket and explicitly test-only qualification/consent/MFA fixtures from the merged security harness. It adds no successful mock Auth handler.

- Provider diagnostics are absent from HTTP bodies and failed operations create no success audit, assignment event, idempotency receipt or credential revision.
- A database audit-insert failure rolls back C033 assignment/event/receipt changes. Three concurrent retries with the original key create one assignment, one event, one receipt and one success audit.
- A report audit-insert failure leaves neither private report text nor a successful submission audit.
- Authorized owner/expert playback succeeds; denied playback creates no successful expert-access audit. A foreign owner test explicitly grants that caller storage consent before expecting ownership 404; absent consent correctly remains 403.
- Successful block/report/logout and playback audits exclude actual synthetic bearer values, passwords, storage keys/bucket, signed URLs, report narrative, policy and qualification content. Duplicate block calls create one creation audit.
- Withdrawal followed by re-consent and repeated worker scans preserves cancellation evidence and does not revive the old assignment.

The audit-failure trigger/function lives only in the fixture-owned schema and is removed in finally. Fixtures use container-signature media, not a claim of fully decoded video or completed T08 acceptance. No shared database migration/reset or retention/purge operation is performed.

## Execution and limits

Run the existing API integration command with `--testPathPattern=privacy-audit` after native PostgreSQL 18 and MinIO are reachable. Unit/build and existing C032/C033/C034/C051/Safety suites supply compatibility controls. Actual results and fresh CI are recorded in the task PR; unexecuted checks are not PASS.

BLOCKED: full C053/C054 reviewer edit/submit/QA and downstream claims/matching audit/race acceptance until those actual APIs are merged. Denied-action audit policy beyond the currently implemented events needs agreement; this suite does not fabricate a new denial event or insert evidence outside an agreed transaction boundary. Real production assurance, consent policy approval, monitoring and retention remain separate gates.

Local verification: PASS 11 new cases after seven provider probes reproduced leakage before the fix; PASS 170 related integration cases across eight suites, 250 unit tests, API/web production builds and TypeScript/lint. Auth reset audit rollback is already covered by the merged recovery suite and is not duplicated here. Native PostgreSQL/MinIO used only disposable schemas/buckets. Full fresh CI and production limitations are recorded in the PR.
