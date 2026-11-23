# Staff security integration

Status: C064 PARTIAL. Cryptographic primitives, signed authority instructions and transactional provisioning persistence are implemented. HTTP MFA enrollment/recovery, assurance adapters and browser workflows are not yet connected. Existing privileged endpoints remain fail-closed. This document does not assert production readiness.

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

C064 remains PARTIAL until MFA persistence, real HTTP/UI enrollment and genuine assurance adapters are connected and tested. Existing Expert/Safety runtime placeholders remain closed in this commit. Qualification evidence and independent restriction recovery are not provided by a provisioning signature alone.

Initial MFA enrollment also requires an independent 256-bit activation capability delivered through the trusted operator channel. The ACTIVE signed directive binds only its domain-separated enrollmentKeyHash; the API never receives that capability through provisioning evidence. Revoked directives carry null. Changing that hash without an explicit new MFA epoch is rejected, and confirmed device history must prevent reusing it after factor revocation. This requirement is part of the pending enrollment implementation; provisioning itself does not produce MFA assurance.

## Verified foundation checks

Local native PostgreSQL: 156 integration tests in 10 suites PASS, including concurrent directives, rollback, immutable evidence and additive migration upgrade. API unit: 367 PASS (31 cryptography/authority tests). Prisma validate/generate, TypeScript, lint and API/web production builds PASS. No UI changes are included, so new browser MFA acceptance is NOT RUN. Local Node is 26.8.2; repository CI uses Node 24. Developer/shared database migrations and real staff provisioning are NOT RUN.
