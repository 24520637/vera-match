# C034 expert playback

Ticket: T06. Planned commit: `feat(expert-guard): restrict assigned video reads`.
This is not production-ready. C050 and C051 remain Huong-owned.

## API and authorization

`POST /api/expert/assignments/:assignmentId/playback` accepts exactly `{}` as JSON,
with the same-origin session cookie. No TTL, bucket, key, identity, MFA claims or
query parameters are accepted. HTTP 200 returns:

```json
{"id":"video-id","url":"https://private-storage.invalid/opaque-signed-url","expiresAt":"2026-11-18T12:00:30.000Z"}
```

Success and denials use `Cache-Control: private, no-store`, `Vary: Cookie` and
`Referrer-Policy: no-referrer`, including malformed JSON. Never log bearer URLs.
Invalid/missing/expired/revoked sessions return 401. Only ACTIVE, verified EXPERT
sessions qualify: ADMIN/MODERATOR/MEMBER and assurance denials receive 403. Missing
and foreign assignments return identical 404 responses after session/role checks.
Unavailable evidence/storage or insufficient signing time returns 503. Invalid
DTOs return 400; non-JSON returns 415. Separate process-local buckets allow 60
requests/expert/minute and 600/IP/minute, returning 429 with Retry-After. They never
consume consent-withdrawal capacity.

Only ASSIGNED/IN_PROGRESS permit playback; SUBMITTED/COMPLETED/CANCELLED do not.
dueAt is a deadline, not an access expiry. The video must be READY/non-deleted.
The owner must be an ACTIVE, verified MEMBER with current VIDEO_STORAGE and
EXPERT_VIDEO_REVIEW. Storage/review generation checks reject missing/future or
withdrawn bindings; re-consent never revives an old assignment.

The current APPROVED credential must still match the assignment's approval ID
and subject, with valid server-sourced qualification evidence. Revocation and
reapproval never rebind access. Self-review and bilateral blocks are denied.
No assignment status/revision is changed; no workload policy is invented.

## Transaction, audit and TTL

Locator reads authorize nothing. Lock order is sorted User IDs, Session, Video,
ExpertCredential, then sorted ExpertAssignment IDs. Relationships are reread
under lock; current consent and generations use the C033 transaction-aware helpers.
Evidence I/O precedes fresh PostgreSQL UTC time checks. Session, MFA, assignment
and approval/evidence expiry are checked again after storage privacy I/O and
signing. Success audit `EXPERT_PLAYBACK_ISSUED` stores actor/assignment only, inside
the transaction before signing. Audit/signing/commit failure returns no URL.

PrivateStorageService remains the only signer; owner playback retains default
60-second TTL and MEMBER-only authorization. Expert TTL is rounded down to whole
seconds, at most 60, bounded by session/MFA/assignment/qualification expiry. At
least one safe second must remain. Returned expiry equals the exact SigV4 signing
date plus TTL. Bucket privacy protections remain unchanged.

## Release limitations

ExpertMfaSource checks current session-bound TOTP proof through the signed staff identity. The deployed path also requires current signed qualifications and signed owner consent. Synthetic MFA and policy evidence remain scoped to test fixtures. Verify playback and revocation on the target private storage provider before release.

C034 denies new issuance on withdrawal/deletion even before C051 updates assignment
status. It does not cancel, reassign, edit or submit work. C050 beyond this issuance
boundary and C051 durable cancellation remain separate. C051 cancellation is documented in [Assignment cancellation](ASSIGNMENT-CANCELLATION.md).
Its real cancellation/issuance boundary checks do not complete C054 edit/submit
race acceptance; those require the actual review APIs. Synthetic handlers do not count.

Issued URLs may work until expiry; buffered/in-flight bytes cannot be recalled.
Provider expiry enforcement, clock synchronization, caching, storage/backup and
retention still need production verification. Synthetic local signing does not
prove provider enforcement.

## T15 provider failure boundary

MFA and qualification evidence/registry exceptions, including upstream HttpException
bodies, are sanitized to 503 EXPERT_ACCESS_UNAVAILABLE. Private provider payloads
are not part of the public HTTP contract. Application-owned session/permission
401/403 and all existing authorization, transaction and signing bounds remain
unchanged. This does not enable any production source or approve real MFA.
