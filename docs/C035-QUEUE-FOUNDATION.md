# C035 queue UI foundation (partial)

Ticket: T06. Planned subject: `feat(expert-ui): build assignment and moderation queues`.
The original foundation is preserved and extended with real read adapters and a
known-pair creation workflow. PA2 scope persistence/services/queue filtering are
implemented, but real provisioning, production assurance and external grant administration remain unavailable;
this does not claim completion of C035/T06. Current contracts:
[ASSIGNMENT-QUEUES-API.md](ASSIGNMENT-QUEUES-API.md).

PA2 stage 1 adds per-assignment PostgreSQL scope and immutable grant/revoke
history with mandatory expiry and distinct regrant lifecycles. Stage 2 adds the
internal ADMIN grant/revoke service with default-deny trusted sources and atomic
audit. Stage 3 connects the queue to valid per-assignment grants and atomic read
audit. No grant/revoke HTTP endpoint exists. Trusted-provisioned ADMIN and real session-bound
MFA remain required; no new external grant/revoke endpoint is approved by this stage.

## Product routes

- `/expert/assignments`: EXPERT-only presentation boundary.
- `/moderation/assignments`: MODERATOR-only assignment presentation boundary.

Both reuse protected routing, the existing session provider and shared design
components. Product routes use real API adapters; no synthetic jobs are supplied.
The reusable no-loader presentation remains explicit for unconnected consumers.
Wrong-role and unverified session states hide content. There is no new auth system.
The existing Safety Report queue is separate and unchanged.

## Internal presentation interfaces

`AssignmentQueueRow` uses existing assignment id/status/dueAt fields.
`AssignmentQueuePage` and `AssignmentQueueLoader` remain rendering interfaces.
The separate API adapter maps the assignments/nextCursor response documented above,
uses existing apiJson and validates responses. Server identity determines scope.
Never retrieve everyone's assignments and filter ownership in the browser.

The loader receives only an opaque cursor and AbortSignal. Account/role changes
remount the queue; session uncertainty hides/unmounts private rows. Request sequence
and cancellation checks discard late responses. Pagination appends deduplicated
rows and restores heading focus. Loading, confirmed empty, error and rate-limit
states are distinct. Retry-After expiry only enables manual retry.

Assignment status labels match the existing database enum; they are not status
filter defaults or permission to play a video. Due dates are displayed in UTC;
null means no work deadline. No media access is attempted.

AssignmentConfirmation stays disabled without a verified-candidate submit handler.
The live moderator form checks a known pair on the server, displays existing C033
fields and requires explicit confirmation. Unknown outcomes retain the original
key/payload for manual retry. Cancellation and reassignment remain unavailable.

## Dependencies still requiring approval/integration

- Real trusted ADMIN provisioning and session-bound MFA sources, reviewed grant
  provenance and external administration/idempotency. PA2 SQL filtering is tested;
  production remains fail-closed, with no global/creator fallback.
- Candidate discovery/directory contracts beyond the implemented known-pair check.
- Manual cancellation contract/ownership and its C051 coordination boundary.
- Trusted MFA, approved qualification/consent evidence and metadata-access policy.
- C034 is included through the completed origin/develop merge, preserving its
  implementation. Playback remains outside C035; production and C051 integration
  limitations still apply.

No C050/C051 cancellation, playback, review editing, public user search or Safety
Report moderation is implemented. Production authorization remains server-owned.

## Verification boundary

Component tests use the isolated auth-loading app and test-only loader/transport
path. All synthetic assignments remain under tests; no production route imports
the test host. Browser tests cover desktop/mobile rendering, loading/empty/errors,
permission states, pagination, account switching, stale results, session failure,
manual rate-limit retry, confirmation focus and scoped axe accessibility checks.
The browser cases use API contract mocks. Separate disposable PostgreSQL API tests
exercise real own-queue ownership/pagination, PA2 cross-scope/expiry/revocation/read
audit/races, known-pair eligibility and assurance denials. This does not claim
combined browser/database E2E, production MFA/provisioning or C051.
