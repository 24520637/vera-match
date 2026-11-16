# Private video implementation and handoff

## Owner API

All paths use `/api`. Session/verified-active-MEMBER, Origin/JSON checks,
bounded process-local quotas and server-derived ownership apply. GET metadata
and DELETE remain usable after withdrawal; no consent is implied by a save.

| Request                      | Contract                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST `/videos/upload-intent` | Exactly `{mimeType,sizeBytes}`. MP4/WebM, 12 bytes–100 MiB. Returns id, 300-second signed PUT and required Content-Type. Content-Length and Content-Type are signed.                                               |
| POST `/videos/:id/confirm`   | Empty JSON object. HEAD verifies declared length/type; range GET checks container signature; conditional copy freezes checked incoming bytes under a different playback key. Only then READY. Retry is idempotent. |
| GET `/videos/me`             | At most 50 newest own metadata rows. No bucket, keys, upload/playback URLs or other owners.                                                                                                                        |
| POST `/videos/:id/playback`  | Empty JSON object. Current storage consent, valid generation, own READY/non-deleted video. Returns a 60-second URL. No staff/expert bypass.                                                                        |
| DELETE `/videos/:id`         | Empty JSON object. Returns 202 DELETED/cleanup PENDING after transactional access denial and durable cleanup enqueue. This is not proof of erasure.                                                                |

Success responses are private/no-store; signed URLs stay in memory and must not
be logged, traced, stored in browser storage or shared. Missing owner resources
return 404 without disclosing whether another member owns them. Storage errors
are sanitized 503. Container signatures are not antivirus, transcoding, full
codec validation or personality analysis.

## Withdrawal and concurrency

Issuance/confirmation hold the same User row lock used by the actual Consent
API. A withdrawal that commits first prevents later issuance. URLs issued first
remain bearer credentials for up to 60 seconds. Already delivered/buffered bytes
and active streams cannot be recalled. Deleting an object prevents subsequent
provider GETs; it does not terminate a response already streaming.

Each intent captures its consent ledger generation. Any later VIDEO_STORAGE
withdrawal permanently invalidates that video, including after re-consent and
before the worker runs. A new explicit upload after re-consent has a new
generation; delayed old withdrawal work cannot delete it.

The native API worker polls every 15 seconds, leases durable VideoCleanupTask
rows, removes objects, confirms HEAD=404 and retries with capped backoff.
Leases expire after a crash. Shutdown waits for current work. Test suites drive
the same worker explicitly. Locators do not cascade with User/Video metadata.
Withdrawal processing records a media-only receipt; it deliberately does not
complete the shared ConsentWithdrawalTask for other domain consumers.

Expired incoming uploads are reaped; a confirmed video's final object is kept.
Incoming keys also require a one-day MinIO lifecycle rule. A PUT authorized
before expiry can finish later: lifecycle is the fallback for a late incoming
object appearing after a cleanup sweep. Lifecycle execution is asynchronous,
not a guaranteed deletion deadline. Cleanup completion describes observed object
absence, not backup erasure or cancellation of all previously accepted PUTs.
Production must separately approve retention, cleanup deadlines, monitoring,
backups/restore suppression and erasure of historical object versions.

## Local native storage

MinIO must be bound to loopback 9000/9001, with credentials only in ignored
machine-local `.env`. `node scripts/setup-local-private-storage.cjs` checks the
local bucket and configures incoming expiry. No public policy or versioning is
supported; API issuance fails closed for an existing bucket policy. Versioned
erasure requires a different reviewed implementation and is refused.

Local installation was compiled from official MinIO release
`RELEASE.2025-10-15T17-29-55Z` (commit
`9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`). MinIO Community is source-only and
its upstream repository is archived. This is a local test dependency, not a
production storage recommendation. Review provider maintenance before release.

## Explicit dependencies and release gates

- The real policy registry currently publishes no approved policies. Runtime
  grants fail closed. Tests inject synthetic test-only policy snapshots into
  the real Consent service; no production grant bypass or pretend policy exists.
- C050 expert access/edit integration and C051 assignment cancellation are
  BLOCKED on Phuc's actual assignment/credential/CAS/history contract and routes.
  Current develop has the starter assignment schema only. This feature exposes
  no expert playback or review editing. It does not claim to cancel assignments,
  implement MFA or complete report/matching withdrawal. Phuc must check active
  assignment, eligibility, owner consent, video state and MFA on every access.
- Before future account hard deletion, enqueue every object locator before
  erasing the consent subject-to-user mapping or cascading Video rows. This
  feature does not implement account deletion.
- Rate limits are bounded, in-memory and process-local for the MVP. No Redis or
  multi-instance protection is claimed. Review real proxy topology before deploy.
- Use synthetic/licensed fixtures only. Real private data requires approved
  policies, retention, maintained storage, MFA and completed expert integration.
