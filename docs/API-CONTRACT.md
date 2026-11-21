# API contract — VERA Match

**T14 implementation:** [Matching API](#implemented-t14-matching-api) documents
member recommendations, decision creation and caller-scoped history. See
[Reciprocal matching](MATCHING-DESIGN.md) for the design and release dependencies.

**T10 implementation:** [Expert review](EXPERT-REVIEW-WORKFLOW.md#6-t10-implementation) defines
versioned submit and independent QA decisions, the submitted QA queue, and the
current video owner's approved-report response.

**C051 implementation:** [Assignment cancellation](ASSIGNMENT-CANCELLATION.md) adds
transactional cancellation to owner video deletion and a durable, source-bound
consumer for storage/review withdrawals. It grants no new access or account deletion.

**T11 implementation:** Block/report and scoped moderator endpoints are described
in [Safety and privacy](SAFETY-PRIVACY.md). Moderator access requires MODERATOR
plus real session-bound staff assurance; its production source is not configured.
ADMIN does not inherit these permissions. Account closure/deletion remains deferred. T14 applies reciprocal blocking to matching.

**C035 / PA2 implementation (partial).** The [assignment queue contract](ASSIGNMENT-QUEUES-API.md)
requires server-derived identity and session-bound staff assurance. Moderator
queue reads filter by current, unrevoked, unexpired assignment-specific grants
before pagination and require a successful read audit. Grant/revoke is an internal ADMIN service requiring
trusted provisioning and MFA. Production gates remain in place and external
grant administration is pending.

**T08 / C043–C048 implementation.** The [private draft contract](T08-DELIVERY.md#contract)
uses the C034 assignment authorization transaction for playback and draft access.
An active, verified assigned EXPERT needs current storage and review consent with
matching generations, valid qualification and session-bound assurance. Withdrawal,
cancellation, expiry or qualification loss denies access. Draft writes and their
minimal audits commit atomically. T10 extends the workspace with submission,
QA return and resubmission, and an approved review receipt.

**C033 implementation:** [Assignment API](ASSIGNMENT-API.md) defines
`POST /expert-admin/assignments`, review-consent generation binding and durable
idempotency. It is synthetic-test-only until real staff assurance is integrated.

**C032 implementation:** The moderator-only expert approval endpoint and its
fail-closed evidence-source boundary are documented in
[Expert approval](EXPERT-APPROVAL.md). It introduces no member video access or MFA
mechanism and does not change the existing authentication responses below.

**Status:** Health/readiness and `/auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/logout-all`, `/auth/forgot-password` and `/auth/reset-password` are implemented. Implemented business scope and release gates are defined by the feature notes above and their linked documents; remaining proposed routes are DESIGN ONLY. See `EMAIL-AUTH-SESSIONS.md` and [Authentication recovery](AUTH-RECOVERY.md) for tested details.

API prefix: `/api`. The browser uses a server-issued HttpOnly session cookie.
Mutating cookie-authenticated endpoints require CSRF protection. Framework
errors can have a different shape from `{ code, message, details? }`. Auth DTO
validation uses `400`, and T08 review timecode bounds use `422`. The feature
sections identify implemented conflicts, including `409 MATCH_DECISION_CONFLICT`
in T14. A design-only contract describes planned behavior.

**C012 / T02: MVP TECHNICALLY APPROVED; PRE-PRODUCTION GATES OPEN.**

Huong technically approved reviewed commit
`b25e4d6d93823f560ae3fc8be443313902097abd` as the MVP implementation/testing
contract, with no further technical corrections in this review round.
The [Profile/Consent contract](PROFILE-CONSENT-CONTRACT.md) decision register
records approved D1-D11, concrete catalogs/three prompts/limits, independent
withdrawal quota, CAS/idempotency and 60-second playback URLs. Existing auth
behavior was unchanged by that review. The C012 approval covered the contract
and left implementation and production policy approval to later work.

New routes use resource wrappers, HTTP 400, nested dot/index field errors,
visible `_form` errors, non-provisioning GET defaults and active verified MEMBER
ownership. Null mapping, separate revocation capacity and 429 Retry-After are
approved MVP rules. Real-user retention/legal, storage/backup policy and actual
signed-URL provider enforcement remain PRE-PRODUCTION approval/verification
gates; section B retention periods are still proposals. C019 chooses concrete
schema/migration design using existing migrations, never recreating the initial
migration. C019-C024 are future implementation, not delivered by C012.

Latest technical review adds independent `revision` wrapper fields for Profile,
Preferences and Questionnaire; mutations require `expectedRevision` and stale
writes return 409 `RESOURCE_REVISION_CONFLICT`. `questionnaireVersion` selects a
catalog, not editing concurrency. Consent keeps its separate aggregate
`version`/`expectedVersion` CAS/idempotency contract.

For the C012 profile and preferences resource contract, malformed persisted data returns an actionable `503`
`DATA_SHAPE_UNAVAILABLE` with allowlisted affected paths/current resource revision,
never private values or database internals. Validate the complete resulting
resource before success; no automatic repair of unrelated fields. The contract
defines explicit owner-assisted remediation and separately reviewed operator
escalation. Legacy profile/preferences failures cannot block withdrawal.
Append-only audit binds immutable policy content or a verifiable hash with its
corresponding snapshot; User deletion must not cascade unexpired evidence away.
Schema/storage implementation and retention/legal approvals remain future work,
not changes to current auth.

| Method    | Route                              | Caller                  | Request, response, and authorization requirements                                                         |
| --------- | ---------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| POST      | `/auth/register`                   | Guest                   | `{email,password,declaredAdult,displayName?}`; create PENDING_EMAIL, send activation link; do not log in automatically |
| POST      | `/auth/verify-email`               | Guest                   | `{token}`; single-use atomic verification; status ACTIVE                                                  |
| POST      | `/auth/resend-verification`        | Guest                   | `{email}`; generic response, rate limits and cooldown                                                     |
| POST      | `/auth/login`                      | Guest                   | `{email,password}`; validate account, set opaque-session cookie                                           |
| GET       | `/auth/me`                         | Authenticated           | Return safe `{id,email,displayName,role}` after database session validation                               |
| POST      | `/auth/logout`                     | Cookie holder / guest   | Idempotent 204; revoke current token if present and clear exact cookie scope                              |
| POST      | `/auth/logout-all`                 | Authenticated           | Revoke every active session for the account                                                               |
| POST      | `/auth/forgot-password`            | Guest                   | Generic email response; throttled single-use reset link                                                   |
| POST      | `/auth/reset-password`             | Guest                   | `{token,newPassword}`; atomic consume and revoke all sessions                                             |
| GET/PATCH | `/profile/me`                      | Member                  | Own profile only; validate all fields                                                                     |
| GET/PUT   | `/questionnaire/me`                | Member                  | Three versioned questionnaire answers                                                                     |
| GET/PATCH | `/preferences/me`                  | Member                  | Desired ages, relationship goals, hard exclusions                                                         |
| GET/PATCH | `/consents/me`                     | Member                  | Five separate purposes; default OFF; auditable withdrawal                                                 |
| POST      | `/videos/upload-intent`            | Member                  | Consent, MIME/size validation; short-lived owner-scoped upload URL                                        |
| POST      | `/videos/:id/confirm`              | Owner                   | Verify object metadata and promote before setting READY. Eligible owner reconfirmation can recover duration from the promoted object. |
| GET       | `/videos/me`                       | Owner                   | Private metadata list                                                                                     |
| POST      | `/videos/:id/playback`             | Owner                   | Owner-only playback; expert access uses the assignment-bound route below                                  |
| DELETE    | `/videos/:id`                      | Owner                   | Revoke owner access, atomically cancel active assignments (C051), and enqueue cleanup                   |
| POST      | `/expert-admin/assignments`        | Moderator               | C033: strict DTO, both consents, generation, qualification revision and Idempotency-Key; synthetic only    |
| POST      | `/expert/assignments/:assignmentId/playback` | Expert | C034 assignment-bound playback; synthetic-only until trusted MFA and approved evidence integrations exist; see [contract](EXPERT-PLAYBACK-API.md) |
| GET       | `/expert/assignments/me`           | Expert                  | C035 own metadata only, server identity, assurance and cursor pagination; see [queue contract](ASSIGNMENT-QUEUES-API.md) |
| GET       | `/expert-admin/assignments`        | Moderator               | C035 PA2 grant-filtered metadata/status/cursor reader; production assurance/provisioning gates remain; see [contract](ASSIGNMENT-QUEUES-API.md) |
| GET       | `/expert-admin/assignments/candidate` | Moderator             | C035 known video/expert pair eligibility check; no public directory/search                               |
| GET       | `/expert/assignments/:id/draft`    | Assigned expert         | Audit the private draft read without initializing a draft. Return the draft or null with nullable, server-owned `durationMs`, or the submitted or approved receipt while the editor is locked. |
| POST      | `/expert/assignments/:id/draft`    | Assigned expert         | Empty JSON initializes one DRAFT at version 1 per assignment or returns the existing editable review. A locked submission returns `409`. |
| POST      | `/expert/reviews/:id/observations` | Assigned expert         | T08: append one categorized observation with integer timecodes and context using `expectedVersion` and the verified duration bound. |
| PATCH     | `/expert/reviews/:id/draft`        | Assigned expert         | Versioned DRAFT or RETURNED edit with atomic audit. Omitted observations are preserved, and an empty array clears them. Nonempty observation edits require a verified duration. |
| POST      | `/expert/reviews/:id/submit`       | Assigned expert         | Required summary/limitations; freeze submitted snapshot                                                   |
| GET       | `/qa/reviews`                      | Scoped moderator       | Submitted queue with session-bound MFA, current assignment grants, and optional `after` cursor            |
| GET       | `/qa/reviews/:id`                  | Scoped moderator       | Submitted version, observation IDs, and factual claim catalog                                            |
| POST      | `/qa/reviews/:id/return`           | Scoped moderator       | Independent QA, current assignment grant, and actionable reason                                          |
| POST      | `/qa/reviews/:id/approve`          | Scoped moderator       | Independent QA, current assignment grant, and optional evidence-linked claims                            |
| GET       | `/reviews/me`                      | Owner                   | QA-approved reports, private claim evidence, and recent disputes                                          |
| POST      | `/reviews/:id/disputes`            | Owner                   | Open a report or claim dispute with a private reason                                                      |
| PATCH     | `/reviews/claims/:id`              | Owner                   | Revision-checked individual confirmation, share permission, and withdrawal                                |
| PATCH     | `/reviews/claims/:id/feedback`     | Owner                   | Save a private, revision-checked annotation on approved claim evidence                                    |
| GET       | `/qa/reviews/disputes`             | Scoped moderator       | Open and in-review disputes with optional `after` cursor                                                 |
| GET       | `/qa/reviews/disputes/:id`         | Scoped moderator       | Private dispute status and reason with approved report context or linked claim evidence                   |
| PATCH     | `/qa/reviews/disputes/:id`         | Scoped moderator       | Revision-checked intake and final response                                                               |
| GET | `/matches/recommendations` | Member | [Reciprocal recommendations](#get-apimatchesrecommendations) with an optional `after` cursor |
| POST | `/matches/:pairId/decision` | Member | [Record `ACCEPT` or `DECLINE`](#post-apimatchespairiddecision) using a current recommendation reference |
| GET | `/matches/decisions` | Member | [Own decision history](#get-apimatchesdecisions) with an optional `after` cursor |
| POST      | `/blocks`                          | Member                  | Block another user and immediately exclude both directions                                                |
| POST      | `/reports`                         | Member                  | Validated reason and target; avoid user enumeration                                                       |
| GET/PATCH | `/moderation/reports`              | Moderator               | Audited access limited to authorized scope                                                                |

## Implemented T14 matching API

All three routes require a valid session cookie for an `ACTIVE`, email-verified
account with role `MEMBER`. The server takes the caller identity from the
session and rechecks the account, role and session in the matching transaction.
Responses carry `Cache-Control: private, no-store`, `Vary: Cookie`, and
`Referrer-Policy: no-referrer`.

Rate limits apply per API process in a one-minute window. The two GET routes
share 60 requests per member. POST has a separate limit of 30 per member.
All three routes share a limit of 300 per socket IP. A `429` response includes
`Retry-After`, which CORS exposes, and `{ code: "RATE_LIMITED", message,
retryAfterSeconds }`. `Retry-After` and `retryAfterSeconds` report the same
integer number of seconds.

| Status | Common matching errors |
| --- | --- |
| `401` | `UNAUTHENTICATED` for a missing, invalid, expired or revoked session, or an inactive or unverified account. |
| `403` | `FORBIDDEN` when the authenticated account lacks the `MEMBER` role. |
| `429` | `RATE_LIMITED` when the member or socket-IP quota is exceeded. |
| `503` | `SESSION_STORE_UNAVAILABLE` if the session lookup fails, `AUTH_CAPACITY` if the limiter cannot allocate a counter, or `MATCHING_UNAVAILABLE` for matching storage, transaction, audit or reference-key failures. Production requires a valid `MATCHING_HANDLE_KEY`. |

The GET routes accept only the optional query parameter `after`. Omit it on
the first request. For later pages, pass the `nextCursor` string verbatim as
the `after` value, URL-encoded as a query parameter. Cursors are opaque,
authenticated encrypted references with a 15-minute lifetime. Each cursor
is scoped to its issuing account, session and endpoint. An empty, repeated,
malformed, expired or out-of-scope cursor, or an extra query parameter, returns
`400 INVALID_REQUEST`. A `null` cursor means the current response offers no
continuation. The GET routes take no business input from the request body.

### GET /api/matches/recommendations

Discovery requires two distinct, active, email-verified members. Both must have
declared that they are adults, have visibility enabled, have a valid UTC birth
date yielding a self-reported age of 18–120, and have current evidence-backed
`PROFILE_MATCHING` consent. Both members' age bounds and explicit dealbreakers
apply. An explicit `different-relationship-goal` dealbreaker requires equal,
known profile goals. A desired goal by itself is a ranking priority. Blocks in
either direction, ineligible pairs and pairs on which the caller already decided
are excluded. Invalid stored matching inputs fail eligibility. The GET creates
no pair or decision.

`200 OK` returns the following JSON shape.

```ts
{
  available: boolean;
  recommendations: { key: string; pairId: string; reasons: string[] }[];
  nextCursor: string | null;
}
```

If the caller fails the matching eligibility checks, the response contains
`available: false`, `recommendations: []` and `nextCursor: null`. An eligible
caller can receive an empty list with `available: true`. The server inspects
at most 48 shortlisted candidates and returns at most 16 recommendations.
It issues a cursor only after finding another eligible recommendation in that
window. A `null` cursor can still leave candidates outside the inspected window.

`key` is an opaque per-caller key. `pairId` is the temporary reference for the
decision route. `reasons` contains the common eligibility explanation and can
include canonical T12 factual statements with current permission. The response
contains no peer identity, raw profile or preference values, private review
evidence, or score. This route uses the common errors and GET cursor validation.

### POST /api/matches/:pairId/decision

Use `pairId` from a recommendation issued to the current account and session.
The reference expires after 15 minutes. Send no query parameters and submit a
JSON object containing exactly one field, `choice`, whose value is `ACCEPT` or
`DECLINE`. The guard requires the configured `Origin` and
`Content-Type: application/json`. It rejects `Sec-Fetch-Site: cross-site` when
present.

The transaction rechecks both members' eligibility, blocks in both directions,
the matching consent generations and block creation audit counts captured when
the reference was issued. A new outgoing block by either participant can
invalidate an existing reference even after unblock. Withdrawal for an unrelated
consent purpose leaves the matching generation valid. See
[reference and pair lifetime](MATCHING-DESIGN.md#c081-and-c082-member-api).

`200 OK` returns `{ choice: "ACCEPT" | "DECLINE", mutual: boolean }` for both
the first successful submission and a replay of the same choice with a current
reference. A new decision and its audit entry commit together. A replay returns
the stored choice and current mutual status without another decision or audit
entry. `mutual` is true only if both participants accepted and the pair is still
eligible. A `DECLINE` response always has `mutual: false`.

| Status | Additional decision errors |
| --- | --- |
| `400` | `INVALID_REQUEST` for any query parameter, an invalid or missing `choice`, or a body with extra fields or the wrong shape. Malformed JSON can receive a framework `400` before service validation. |
| `403` | `ORIGIN_DENIED` for missing or foreign `Origin`, or `Sec-Fetch-Site: cross-site`. |
| `404` | `MATCH_UNAVAILABLE` for an invalid, expired, foreign or stale reference, or a pair that no longer passes the eligibility checks. The response uses the same code for these cases. |
| `409` | `MATCH_DECISION_CONFLICT` when a valid request attempts to change the caller's stored choice. |
| `413` | The framework can reject a request that exceeds the JSON parser's body size limit before service validation. |
| `415` | `JSON_REQUIRED` for a request that fails the JSON content-type check. |

### GET /api/matches/decisions

History includes only decisions the caller recorded as a participant. A valid
member can read their own decisions after withdrawing matching consent. Current
authorization and eligibility determine the status fields on each item.

`200 OK` returns the following JSON shape.

```ts
{
  decisions: {
    id: string;
    choice: "ACCEPT" | "DECLINE";
    createdAt: string;
    available: boolean;
    mutual: boolean;
  }[];
  nextCursor: string | null;
}
```

Each page has at most 20 items in descending decision-time order, using the
stored ID as the internal tie-breaker. The exposed `id` is an opaque per-caller
key and `createdAt` is an ISO 8601 UTC timestamp. An unavailable current or
historical pair can still appear with the caller's own choice and flags
`available: false` and `mutual: false`. Entries whose recorded actor is outside
the pair are omitted. History contains no peer identifier, peer choice or recommendation
reason. This route uses the common errors and GET cursor validation. A pair
becoming unavailable is reported in the `200` response.

### C079 and C080 product decisions still open

The implemented ranking uses the viewer's directional priorities within each
discovery window. Canonical factual statements can appear as explanations only
after independent QA, owner confirmation and explicit sharing approval. The
source observation must still match the approved review. Consent withdrawal,
claim revocation and applicable disputes exclude a claim. The API leaves
reciprocal aggregation, global ranking, a
structured lifestyle criterion, field-specific profile disclosure, and claim
contributions to ranking open for product review. See
[matching eligibility and ranking](MATCHING-DESIGN.md#c078-and-c079-eligibility-and-ranking)
and [live claims](MATCHING-DESIGN.md#c080-live-claims).

## Contract checks that must be implemented

### T08 video duration

Upload confirmation records a conservative span between decoded frame starts
when it can probe the exact promoted private MP4/WebM object. The API accepts
no client duration and ignores container and per-frame duration declarations.
Unsupported, incomplete, busy, disabled or timed-out probes can leave a READY
video with `durationMs: null`.

For a READY video with an unmeasured duration and a saved promotion ETag, the
owner can repeat `POST /videos/:id/confirm` with an empty JSON object. The retry
uses the immutable playback key, saved ETag and size, and original storage
consent generation under the owner lock. A busy or disabled probe preserves
eligibility. A completed attempt consumes it, and successful recovery commits
the duration and one `VIDEO_DURATION_VERIFIED` audit together. Withdrawal
invalidates the original generation even after consent is regranted. Earlier
uploads without recorded promotion identity have no automatic backfill. See
[Private video](PRIVATE-VIDEO.md#owner-api).

Observation append and nonempty replacement require a positive integer server
measurement. Missing duration returns `503 REVIEW_DURATION_UNAVAILABLE`, and
out-of-range timecodes return `422`. A stale `expectedVersion` returns `409`.
Denied edits make no draft or success audit change.

### C009 browser transport

`apps/web/src/lib/api.ts` provides same-origin `/api` requests with
`credentials: "same-origin"`, redirects rejected, and `cache: "no-store"` by
default. Callers pass paths without the `/api` prefix. External URLs, fragments,
and traversal paths are rejected. `apiFetch` returns a `Response`;
`apiJson<T>` parses JSON, supports a `json` request option, and returns
`undefined` for empty/204/205/HEAD responses. Generic types do not validate
response schemas at runtime. Multipart requests retain browser-generated
content types. Caller headers and abort signals pass through.

`ApiError.kind` distinguishes `http`, `network`, `aborted`, `invalid-response`,
and `invalid-request`. HTTP errors retain `status` and supported
`code`, `message`, and `details` envelope fields; NestJS message arrays are
supported. Non-JSON error bodies retain their HTTP status with fallback text.
Treat server messages and details as untrusted data, never HTML.

The client never redirects to login, clears session state, stores tokens, or
automatically retries requests. Consumers distinguish actual `401` from `403`
and outages. CSRF headers can be supplied by the caller; session and CSRF
protocols remain Huong's responsibility. Same-origin credentials alone are not
CSRF protection. Relative browser URLs do not provide SSR cookie forwarding;
server consumers require explicit server-side integration rather than importing
this transport as an authenticated server client.

Next.js proxies `/api/:path*` to server-only `API_INTERNAL_ORIGIN` (default
`http://localhost:4000`). Configure it at build time. Shared tests exercise
simulated transport responses. The separate real-auth suite covers the health
rewrite and implemented auth flows. The member browser suite exercises the
implemented T14 routes through the real API and same-origin proxy. See the
[T14 matching API](#implemented-t14-matching-api) and
[T14 acceptance tests](TEST-PLAN.md#t14-reciprocal-matching-acceptance).

1. Authenticate the cookie and authorize **resource ownership** at the API, never only in the UI or based on a caller-supplied user ID.
2. `/auth/me` network/`5xx` failures should offer retry, not redirect to login. Only an actual invalid session (`401`) implies reauthentication; `403` means insufficient privileges.
3. Keep transitions atomic and reject stale writes. Profile/preferences/questionnaire require separate `expectedRevision` checks with 409 on conflict. Consent separately uses aggregate `expectedVersion` CAS; explicit OFF advances that version and idempotent replays cannot duplicate events. No revision mechanism is implemented by this documentation update.
4. Keep stored videos private, use short-lived signed URLs, and revoke access when consent or assignments become invalid.
5. Never expose private video, raw reviewer notes, biometric-like observations, or unapproved assessments in matching explanations.
6. Only the routes identified as implemented above exist; remaining routes are a **plan**.

## Implemented auth response contract

The following is an inspection of existing code, not a new implementation or a
fresh test result. Sources: `apps/api/src/auth/{registration,email,login,verification}.dto.ts`,
`auth.controller.ts`, `auth-validation.ts`, the auth services and
`apps/web/src/lib/{auth-types,api,auth-form}.ts`.

### Requests and validation already implemented

| Request DTO / operation | Accepted fields and behavior |
| --- | --- |
| `RegistrationDto` | `email: string` is trimmed/lowercased, must pass email validation, max 254 characters. `password: string` is 12-128 characters; no trimming/normalization. `declaredAdult: boolean` must be exactly `true`, not a string/number. `displayName?: string` is trimmed, 1-80 characters when supplied as a string. Current `@IsOptional()` also skips explicit `null`; the draft does not silently tighten this behavior. |
| `EmailDto` (resend) | `email: string`, same normalization/email/max-length rules. |
| `LoginDto` | Extends `EmailDto`; `password: string`, 1-128 characters. Login does not impose registration's 12-character minimum. |
| `VerificationDto` | `token: string` matching 43 base64url characters; the service additionally requires canonical encoding and an unused, unexpired token for a pending account. |
| GET `/auth/me` | No body DTO; caller identified by the validated cookie. |
| POST logout / logout-all | No body DTO is declared. Browser callers send JSON `{}`; the body cannot select which user/session to revoke. Do not claim these methods validate arbitrary body fields through a DTO. |

The global validation pipe transforms declared DTOs, rejects unknown fields
(`whitelist` + `forbidNonWhitelisted`), and omits submitted values/targets from
validation errors. This applies to DTO-bound inputs, not every possible route
body. Registration always creates MEMBER/PENDING_EMAIL, never a role/status
supplied by the caller. An adult declaration is not age or identity verification.

All auth POSTs require the exact configured browser `Origin` and
`application/json` through `AuthRequestGuard`, including logout. Browser
same-origin credentials and SameSite cookies do not replace that check.

### Success responses already implemented

```ts
// Documentation notation; existing backend CurrentUser / frontend AuthUser.
type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: "MEMBER" | "EXPERT" | "MODERATOR" | "ADMIN";
};
type MessageResponse = { message: string };
type ResendResponse = MessageResponse & { retryAfterSeconds: number };
```

| Route | Success | Side effects / limits |
| --- | --- | --- |
| POST `/auth/register` | `202 MessageResponse` | Same generic message for new/duplicate registration on successful handling; no session cookie. New users remain pending and receive an activation attempt. This is not a promise that DB/SMTP outages return 202. |
| POST `/auth/verify-email` | `200 MessageResponse` | Atomic activation, no automatic login; replay/expired/invalid link fails. |
| POST `/auth/resend-verification` | `202 ResendResponse` | Generic for unknown/ineligible addresses and account cooldown; wait comes from configured cooldown. Request-level rate limiting can still return 429. |
| POST `/auth/login` | `200 AuthUser` | Flat projection plus persistent HttpOnly session cookie. Raw token is not in JSON. |
| GET `/auth/me` | `200 AuthUser` | Same projection after current DB session/account validation. |
| POST `/auth/logout` | `204`, empty body | Idempotent current-session revoke when a valid token is present; clears matching cookie scope after success. Does not require an authenticated account. |
| POST `/auth/logout-all` | `204`, empty body | Requires current valid session; revokes caller's sessions, then clears matching cookie scope. |

Do not introduce a new `{data: ...}` wrapper around existing auth responses.
Backend safe projection and frontend `isAuthUser` are the integration points;
Prisma `User`, password hashes, token hashes and session metadata are not DTOs.

### Errors and headers already implemented

| HTTP status | Existing behavior |
| --- | --- |
| `400` | DTO failure: `VALIDATION_FAILED`, generic message, `details: {field: string, messages: string[]}[]`. Invalid/expired/used activation: `INVALID_VERIFICATION_LINK`. Current field mapping is top-level; nested field-path semantics are not yet defined. |
| `401` | `INVALID_CREDENTIALS` for login/account rejection; `UNAUTHENTICATED` for absent/invalid/expired/revoked sessions. |
| `403` | `ORIGIN_DENIED` for missing/foreign Origin; role denials use `FORBIDDEN`. Do not clear auth merely for a forbidden operation. |
| `415` | `JSON_REQUIRED` for auth POSTs without the required JSON content type. |
| `429` | `RATE_LIMITED`, `message`, `retryAfterSeconds`, with matching integer `Retry-After` header. CORS exposes that header. No client auto-retry. |
| `503` | Sanitized service failures, e.g. `REGISTRATION_UNAVAILABLE`, `VERIFICATION_UNAVAILABLE`, `EMAIL_DELIVERY_UNAVAILABLE`, `LOGIN_UNAVAILABLE`, `LOGOUT_UNAVAILABLE`, `SESSION_STORE_UNAVAILABLE`; limiter capacity can return `AUTH_CAPACITY`. |

An example of the existing DTO validation envelope (synthetic field error):

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Check the submitted fields.",
  "details": [{ "field": "email", "messages": ["email must be an email"] }]
}
```

Validation message strings are library-generated feedback, not stable machine
codes. Use HTTP status, `code` where present and validated `details`; render all
server text as untrusted text. Unhandled/framework errors are not universally
normalized by a global business-error filter; transport consumers must tolerate
missing fields or non-JSON bodies. Do not document 409/422 as implemented auth
outcomes. An outage is not proof that login/logout did or did not complete;
provide recovery/revalidation rather than asserting session success.

Configured auth responses use `Cache-Control: no-store`, `Referrer-Policy:
no-referrer` and `Vary: Cookie`. Cookies are HttpOnly, Path=/, host-only, with
Secure/SameSite/lifetime from validated configuration. The browser never stores
session tokens/passwords in localStorage/sessionStorage. `ApiError.kind`
(`http`, `network`, `aborted`, `invalid-response`, `invalid-request`) describes
client transport failures; it is not a server JSON field. A login
`401 INVALID_CREDENTIALS` rejects that credential attempt; it does not by itself
invalidate an existing session. A `401 UNAUTHENTICATED` from `/auth/me` or a
session-protected request means that request has no valid authenticated session
and needs sign-in recovery as appropriate. Do not treat every 401 as a global
logout or proof that all sessions were revoked. Transport code does not clear
auth state or redirect; cancellation/network/5xx remain distinct.

## Integrated session owner and C009/C010

The browser API client is the C009 same-origin transport. `apiRequest` and `postAuth` delegate to `apiJson`; they do not select a second API base. ApiError uses kind/message/status/code/details and optional retryAfterSeconds. HTTP status stays authoritative; network/abort failures do not invent 401. `Retry-After` and matching JSON timing are retained for 429, with no automatic retry. Unknown details are validated by form consumers.

AuthLoadingBoundary is C010 presentation; SessionBoundary supplies state from AuthProvider and owns redirects. The protected/member server layout validates its cookie before rendering protected pages. Server session lookup forwards the cookie only to validated server-only API_INTERNAL_ORIGIN. Same-origin proxy requests still require the exact browser Origin and JSON for auth mutations; the proxy does not remove CSRF checks.
