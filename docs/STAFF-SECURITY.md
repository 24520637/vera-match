# Staff security integration

Status: C064 PARTIAL. Cryptographic primitives and signed authority instructions are implemented; provisioning persistence, HTTP enrollment/recovery, assurance adapters and browser workflows are not yet connected. Existing privileged endpoints remain fail-closed. This document does not assert production readiness.

## Cryptographic contract

TOTP uses RFC 6238 with HMAC-SHA-1, a random 160-bit secret, six digits, a 30-second step and at most one adjacent step. RFC 4226 and RFC 6238 published vectors are checked. A matching counter is only a candidate: a database transaction must lock the device, consume its strictly increasing counter, rotate the authenticated session and record an expiring proof atomically. Computing a code never grants assurance. TOTP is not phishing-resistant and does not attest physical devices.

Secrets use AES-256-GCM with independent random nonces and authenticated key ID plus subject/device/epoch binding. The external wrapping-key ring accepts at most eight 256-bit keys. Rotation explicitly decrypts with a retained old key and re-encrypts with the current key; removing an old key before rewrapping denies access. No wrapping keys are generated or installed in ordinary runtime.

Eight independent 256-bit recovery codes have domain-separated SHA-256 hashes. Only hashes may be stored. A code must be consumed once under lock and authorize restricted re-enrollment, not private-data access or a successful MFA proof. Codes and setup secrets must never enter logs, browser storage, URLs or audit JSON.

## Staff authority contract

A separate Ed25519 authority signs the exact domain-separated StaffDirective payload. The public-key ring is distinct from consent approval and MFA wrapping keys. Directives bind an opaque subject, exact account ID, normalized-email digest, role, state, sequential revision, MFA epoch, explicit permissions and validity interval (at most 90 days). ADMIN does not inherit moderation permissions; assignment grant administration needs the explicit ASSIGNMENT_GRANT_ADMIN permission. Revocation cannot carry permissions.

The verifier does not mutate roles, create identities or establish MFA. Persistence must verify the actual account binding, enforce revision and epoch transitions, append immutable evidence and revoke existing sessions atomically. Replaying an older directive must not renew authority. Losing factors must not silently reset the enrollment epoch; only an explicit, independently authorized recovery operation may do so. Root key custody, staff qualification evidence and rollback fencing remain separate required integrations.

## Required operational controls

Keep signing keys offline/outside the application, wrapping keys outside the database/repository, and both outside ordinary database backups. Use restrictive host ACLs and reviewed key rotation. Test with ephemeral synthetic authorities only. Production qualification, legal policy approval, provisioning authority and deployment acceptance must be supplied genuinely before privileged access can open.
