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

Worker observability uses fixed codes only: `VIDEO_CLEANUP_SCAN_FAILED` for an
unexpected failed scan, `VIDEO_CLEANUP_SCAN_RECOVERED` for a subsequent successful
scan, and `VIDEO_CLEANUP_RETRY_SCHEDULED` after a per-object retry is persisted.
No exception message/stack, task/owner identifiers, keys, URLs or media are logged.
The timer consumes already-reported rejections and keeps polling; shutdown waits
for the active scan without forwarding its raw driver exception. Scan recovery
does not mean every queued object has been erased. Operators must monitor these
codes and the protected durable task backlog; no external alerting service is
introduced here.

Mapped withdrawals are prioritized ahead of unresolved subject mappings so an
older orphaned batch cannot starve live cleanup. Missing mappings emit
`VIDEO_CLEANUP_WITHDRAWAL_MAPPING_UNAVAILABLE` once per affected scan and remain
pending for explicit operator reconciliation. No owner is guessed and no receipt
or erasure acknowledgement is fabricated for them. This does not implement the
separate account-deletion locator handoff.

PostgreSQL failure before claim leaves the task untouched. A database failure
after provider deletion leaves a recoverable lease and does not stamp erasure;
after lease expiry, retry repeats provider removal/HEAD verification before
committing completion. MinIO failure preserves PENDING/backoff and no completion
timestamp. Connection-outage tests use unreachable loopback endpoints and
disposable schemas; they do not stop the developer's PostgreSQL/MinIO services.
Requeuing a completed owner deletion clears its previous completion timestamp in
the same transaction as the durable task update. Metadata stays pending until a
fresh provider-verified pass commits; a lost requeue transaction changes neither.

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

On Windows, `node scripts/start-local-private-storage.cjs` starts the installed
native executable hidden, with explicit local app/test CORS origins and secrets
passed only through the child environment. It does not install an auto-start
service. Default installation: `C:/DevTools/MinIO`; `MINIO_NATIVE_HOME` can select
another existing installation. Keep the data directory outside the repository.

Local installation was compiled from official MinIO release
`RELEASE.2025-10-15T17-29-55Z` (commit
`9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`). MinIO Community is source-only and
its upstream repository is archived. This is a local test dependency, not a
production storage recommendation. Review provider maintenance before release.

## Verification

Run `npm run prisma:validate`, `npm run prisma:generate`, `npm test`,
`npm run test:integration --workspace apps/api`, `npm run lint`, `npm run build`,
`npm run test:ui --workspace apps/web` and `node scripts/run-video-e2e.cjs`.
The video browser suite uses real API/Consent/Prisma/MinIO with synthetic camera
input and a test-only policy provider, on desktop and mobile. It records no
credential-bearing traces. Each run owns a UUID database schema and bucket;
cleanup rejects unknown metadata. Unit tests do not establish storage privacy.

The integration suite verifies the real 60-second provider expiry, MIME/length
signatures, anonymous denial, source replacement races, consent/issuance and
confirmation/deletion ordering, durable failures/lost acknowledgements, retry
after worker restart, re-consent generations and redacted atomic audits.
CI builds pinned official native MinIO and preserves the existing native
PostgreSQL/Mailpit, shared UI, auth and member regression jobs. Passing owner
tests do not complete the blocked expert assignment/review acceptance checks.

## Explicit dependencies and release gates

### Ordinary-user consent publication is not configured

`ConsentPolicyRegistry.current()` on develop and this branch returns undefined;
there is no `.env` flag that enables grants. The actual consent page also passes
no `publishedPolicies`, so its grant actions stay disabled. Tests override the
provider only in isolated test modules/scripts, with `testOnly: true`; access and
grant checks reject that evidence in both development and production.

Before ordinary members can grant a purpose, the policy owners must approve its
exact content, purpose, immutable version and locale. A separately reviewed
publication change must supply that snapshot from the controlled API registry
with `testOnly: false`, and publish the identical version/locale/content to the
member page's `publishedPolicies`. No current values are approved by this PR.
Changing any accepted bytes requires a new version, not rewriting old evidence.
On explicit grant the API verifies the current version, preserves the UTF-8
SHA-256 snapshot/evidence and records the consent event under existing CAS and
idempotency rules. Direct row seeding or setting NODE_ENV=test is not a rollout
procedure. Publishing frontend text alone cannot authorize a backend grant.

Only VIDEO_STORAGE is needed for owner uploads/confirmation/playback. Future
expert access additionally requires EXPERT_VIDEO_REVIEW and the full expert
authorization contract. Other purposes remain independent and can stay OFF.
Own safe metadata reads and deletion intentionally do not require consent again.

### Recommended integration decision: B

Scope the existing PR #11 as the independently verified owner-media/cleanup
deliverable. Keep it Draft until Huong and Phuc explicitly agree that scope; do
not call the entire Private Video feature complete or create a duplicate PR.

The following remain tracked follow-up work after reviewed C031-C036 integration:

- [ ] C050: current-consent, eligibility, assignment and MFA checks on expert
      video/review read, renewal and edit/submit routes.
- [ ] C051: cancellation of active assignments under CAS, with exact immutable
      AssignmentEvent/retained actor evidence in the same transaction. No blind bulk
      status updates; preserve valid terminal states and deletion history.
- [ ] C053: redacted denied-assignment and expert privacy audit events.
- [ ] C054: revoke/delete racing expert read/edit/submit, cancellation/reassignment
      and signed-URL issuance, using the actual merged Phuc workflow.

PR #12 at c5fa452 is unmerged and supplies C031 only, not C032-C036 APIs. Its
additive identity-reservation/mapping-guard migration addresses the prior review
findings and still requires formal C031 review. Combined Prisma validation and
both migration application orders with all eight migrations passed in isolated
review schemas; this is not merged runtime/E2E acceptance. None of the three video migrations, existing migrations
or shared consent/assignment contracts is changed by this readiness fix.

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
