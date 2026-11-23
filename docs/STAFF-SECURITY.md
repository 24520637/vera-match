# Staff security integration

Status: C064 PARTIAL. Cryptographic primitives, signed authority instructions and transactional provisioning persistence are implemented. Real HTTP MFA enrollment/recovery and the Safety assurance adapter are implemented and tested. Expert qualification/queue adapters and independent recovery fencing remain incomplete. Privileged access still requires genuine identity, keys, MFA and each existing business authorization. This document does not assert production readiness.

## Cryptographic contract

TOTP uses RFC 6238 with HMAC-SHA-1, a random 160-bit secret, six digits, a 30-second step and at most one adjacent step. RFC 4226 and RFC 6238 published vectors are checked. A matching counter is only a candidate: a database transaction must lock the device, consume its strictly increasing counter, rotate the authenticated session and record an expiring proof atomically. Computing a code never grants assurance. TOTP is not phishing-resistant and does not attest physical devices.

Secrets use AES-256-GCM with independent random nonces and authenticated key ID plus subject/device/epoch binding. The external wrapping-key ring accepts at most eight 256-bit keys. Rotation explicitly decrypts with a retained old key and re-encrypts with the current key; removing an old key before rewrapping denies access. No wrapping keys are generated or installed in ordinary runtime.

Eight independent 256-bit recovery codes have domain-separated SHA-256 hashes. Only hashes may be stored. A code must be consumed once under lock and authorize restricted re-enrollment, not private-data access or a successful MFA proof. Codes and setup secrets must never enter logs, browser storage, URLs or audit JSON.

## Staff authority contract

A separate Ed25519 authority signs the exact domain-separated StaffDirective payload. The public-key ring is distinct from consent approval and MFA wrapping keys. Directives bind an opaque subject, exact account ID, normalized-email digest, role, state, sequential revision, MFA epoch, explicit permissions and validity interval (at most 90 days). ADMIN does not inherit moderation permissions; assignment grant administration needs the explicit ASSIGNMENT_GRANT_ADMIN permission. Revocation cannot carry permissions.

The verifier does not mutate roles, create identities or establish MFA. Persistence must verify the actual account binding, enforce revision and epoch transitions, append immutable evidence and revoke existing sessions atomically. Replaying an older directive must not renew authority. Losing factors must not silently reset the enrollment epoch; only an explicit, independently authorized recovery operation may do so. Root key custody, staff qualification evidence and rollback fencing remain separate required integrations.

## Required operational controls

Keep signing keys offline/outside the application, wrapping keys outside the database/repository, and both outside ordinary database backups. Use restrictive host ACLs and reviewed key rotation. Test with ephemeral synthetic authorities only. Production qualification, legal policy approval, provisioning authority and deployment acceptance must be supplied genuinely before privileged access can open.

## Provisioning persistence (implemented)

The additive staff-trust migration adds StaffIdentity and append-only StaffTrustEvent. It does not provision existing staff, change their roles or enable privileged access. User deletion is restricted for retained staff identities until a separate approved retention/account-deletion contract exists. DELETE/recreate and TRUNCATE cannot reset identity or evidence.

StaffIdentityService accepts only a current valid authority signature bound to an ACTIVE, email-verified account and normalized email digest. User then sorted Session rows are locked before the identity. Every new sequential directive creates immutable evidence, changes identity by CAS, changes the role only for an explicit ACTIVE instruction, revokes every existing session and records audit in one transaction. Audit failure rolls back everything. Concurrent exact-byte replays return the committed directive without duplicate events. Replaying an older revision or replacing the opaque subject is rejected. Reactivation or role change requires exactly the next MFA epoch; ordinary renewal does not silently reset devices.

External public-key file format: JSON with schemaVersion 1 and keys array, each containing id and publicKeyPem (Ed25519 SPKI PEM). It must be an absolute path in STAFF_AUTHORITY_KEYS_PATH. Missing configuration denies authority; partial/invalid configuration fails initialization with code-only diagnostics. Root rotations explicitly retain reviewed public keys during transition. Removing a root denies identities still signed by it; reissue their directives first.

The operator-only command is npm run staff:provision -- --directive ABSOLUTE_SIGNED_FILE --database-fingerprint SHA256 --apply. It starts no HTTP listener or background workers. The target fingerprint is SHA-256 of JSON.stringify([URL.protocol, URL.hostname, URL.port, URL.pathname, URL.searchParams.get("schema") ?? "public"]); credentials are excluded. Review the target independently. The command is not run automatically and has not been applied to the developer database. No root private keys or successful real identities are supplied by this repository.

At the authority-foundation boundary MFA HTTP/UI were still pending. The real MFA implementation and remaining integration gates are detailed below. Expert qualification/queue adapters remain closed until genuinely connected. Qualification evidence and independent restriction recovery are not provided by a provisioning signature alone.

Initial MFA enrollment also requires an independent 256-bit activation capability delivered through the trusted operator channel. The ACTIVE signed directive binds only its domain-separated enrollmentKeyHash; the API never receives that capability through provisioning evidence. Revoked directives carry null. Changing that hash without an explicit new MFA epoch is rejected, and confirmed device history must prevent reusing it after factor revocation. This requirement is part of the pending enrollment implementation; provisioning itself does not produce MFA assurance.

## Verified foundation checks

Local native PostgreSQL: 156 integration tests in 10 suites PASS, including concurrent directives, rollback, immutable evidence and additive migration upgrade. API unit: 367 PASS (31 cryptography/authority tests). Prisma validate/generate, TypeScript, lint and API/web production builds PASS. No UI changes are included, so new browser MFA acceptance is NOT RUN. Local Node is 26.8.2; repository CI uses Node 24. Developer/shared database migrations and real staff provisioning are NOT RUN.

## Real MFA HTTP contract

All routes use /api/auth/staff-mfa and the existing HttpOnly session cookie. Every mutation requires the configured Origin, same-origin JSON and the existing IP limiter. A durable per-staff PostgreSQL window permits at most five failed factor attempts per 15 minutes across processes/restarts. Success resets the failed-factor window; status reads do not. HTTP 429 uses the existing RATE_LIMITED body and Retry-After header.

| Route | Request | Result |
| --- | --- | --- |
| GET / | none | Active-device metadata, expiring verification status, own pending setup reference (never its secret), restricted recovery availability. |
| POST /enrollment | password; activationKey for first enrollment | 201; one-time Base32 setup key and five-minute session-bound setup reference. Further devices require current MFA or a restricted recovery permit. |
| POST /enrollment/confirm | deviceId, code | 200; consumes the OTP counter, confirms the device and rotates to a NEW session ID/token with at most five minutes of assurance. New recovery codes are shown once if needed. |
| POST /verify | password, deviceId, code | 200; consumes a new counter and rotates to a NEW session with bounded assurance. |
| POST /recover | password, recoveryCode | 200; consumes all old recovery codes, revokes old devices and sessions, and issues a NEW session with only a five-minute re-enrollment permit. No MFA assurance. |
| POST /recovery-codes | password; current MFA required | 200; consumes old codes and returns eight replacements once. |
| POST /devices/:deviceId/revoke | password; current MFA required | 204; permanently revokes the device and all user sessions; clears the cookie. |

Setup, devices, proof, expiry and recovery are bound to the exact staff subject, signed identity revision/enrollment epoch and current Session. Revoked device history cannot be deleted/recreated or truncated to regain initial enrollment. Missing/revoked/expired factors, consumed counters, foreign devices, another setup session and invalid credentials deny generically. ADMIN does not inherit MODERATOR report access. Session and proof expiry cannot extend the original authenticated session or staff authority expiry. TOTP verification and audit commit atomically; audit failure consumes neither the factor nor the session.

The SafetyModule now injects the genuine StaffMfaService into StaffAssuranceSource. A standalone source with no integration denies; production never reads a role, request header, environment success flag or testOnly fixture as MFA evidence. Existing test overrides remain limited to their isolated test harnesses. Shared Expert providers still require a separate genuine qualification/eligibility integration and are not silently opened by this change.

## Wrapping keys and rotation

STAFF_MFA_KEYRING_PATH points outside the repository/database backups to JSON with schemaVersion 1, activeKeyId and keys (each has id and canonical keyBase64url for a separately generated 32-byte wrapping key). It is loaded once at startup. Missing keys deny MFA; invalid configuration fails initialization without printing material or paths.

Load the new active key together with retained old keys in the API first. The operator-only npm run staff:mfa-rewrap -- --database-fingerprint SHA256 --apply then locks each User, Identity and sorted devices and transactionally rewraps the same secret with the new key. Counters, device history, identity, sessions and proof lifetimes do not reset. Immutable KEY_REWRAPPED events and audit commit with the ciphertext update. Failed identities roll back and are counted, while later identities continue; rerun safely before retiring any old key. Only a zero-failure result plus verified current-key coverage permits retirement. Restart with the reviewed key ring after deployment changes. This command has only been tested on disposable synthetic schemas, never the developer database.

Actual PostgreSQL/HTTP tests cover signed identities, real TOTP and role authorization, session/cookie rotation, concurrent replay, restart-persistent quotas, restricted recovery, deprovision/reprovision epochs, audit rollback, expiry clamping, permanent factor history and actual key rewrapping/retirement. Browser acceptance is tracked separately until it completes. Independent restore fencing remains required before claiming production recovery safety.

Standards: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), [RFC 4226](https://www.rfc-editor.org/rfc/rfc4226).

Browser acceptance: 4/4 real API desktop/mobile tests PASS, including setup visibility handling, actual TOTP, recovery, role authorization, session/cookie changes, revocation, Retry-After and scoped accessibility. No mock assurance provider is used. Setup/recovery values are memory-only; no MFA secret is placed in browser storage or page URLs.
