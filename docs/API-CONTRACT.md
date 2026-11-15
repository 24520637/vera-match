# API contract — VERA Match

**Status:** Health/readiness and `/auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/logout-all` are implemented. All other business routes below remain DESIGN ONLY. See `EMAIL-AUTH-SESSIONS.md` for tested details.

API prefix: `/api`. The browser uses a server-issued HttpOnly session cookie. Mutating cookie-authenticated endpoints require CSRF protection. Implemented auth behavior is described below; `{code, message, details?}` is not a guarantee that every framework error has this shape. Auth DTO validation uses `400`, not `422`. Future feature `409` rules are approved MVP contracts, not implemented routes;
`422` is not introduced by this contract.

**C012 / T02: MVP TECHNICALLY APPROVED; PRE-PRODUCTION GATES OPEN.**

Huong technically approved reviewed commit
`b25e4d6d93823f560ae3fc8be443313902097abd` as the MVP implementation/testing
contract, with no further technical corrections in this review round.
The [Profile/Consent contract](PROFILE-CONSENT-CONTRACT.md) decision register
records approved D1-D11, concrete catalogs/three prompts/limits, independent
withdrawal quota, CAS/idempotency and 60-second playback URLs. Existing auth
behavior is unchanged. Feature routes remain unimplemented; PR #8 is not
represented as merged and production policies are not approved.

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

Malformed persisted feature data returns safe actionable 503
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
| POST      | `/videos/:id/confirm`              | Owner                   | Check actual object metadata; set READY only after verification                                           |
| GET       | `/videos/me`                       | Owner                   | Private metadata list                                                                                     |
| POST      | `/videos/:id/playback`             | Owner / assigned expert | Current authorization and consent → short-lived signed URL                                                |
| DELETE    | `/videos/:id`                      | Owner                   | Revoke access, cancel dependent assignments, begin deletion workflow                                      |
| POST      | `/expert/assignments`              | Moderator               | `{videoId,expertId,dueAt}`; verify eligibility, video status, owner consent                               |
| GET       | `/expert/assignments/me`           | Expert                  | Only caller's currently assigned tasks                                                                    |
| POST      | `/expert/reviews/:id/observations` | Assigned expert         | Time range, category, evidence/context, optimistic version                                                |
| PATCH     | `/expert/reviews/:id/draft`        | Assigned expert         | Draft-only edit; version check and audit                                                                  |
| POST      | `/expert/reviews/:id/submit`       | Assigned expert         | Required summary/limitations; freeze submitted snapshot                                                   |
| POST      | `/qa/reviews/:id/return`           | Moderator               | Not original author; actionable reason required                                                           |
| POST      | `/qa/reviews/:id/approve`          | Moderator               | Not original author; enforce independent QA and valid transition                                          |
| GET       | `/reviews/me`                      | Owner                   | Only QA-approved reports for the caller                                                                   |
| POST      | `/reviews/:id/disputes`            | Owner                   | Reason, dispute status and audit                                                                          |
| PATCH     | `/reviews/claims/:id`              | Owner                   | Granular confirmation, share permission, withdrawal                                                       |
| GET       | `/matches/recommendations`         | Member                  | Reciprocal constraints; current consents; permitted claims only                                           |
| POST      | `/matches/:pairId/decision`        | Member                  | `ACCEPT`/`DECLINE`; actor must belong to the pair                                                         |
| POST      | `/blocks`                          | Member                  | Block another user and immediately exclude both directions                                                |
| POST      | `/reports`                         | Member                  | Validated reason and target; avoid user enumeration                                                       |
| GET/PATCH | `/moderation/reports`              | Moderator               | Audited access limited to authorized scope                                                                |

## Contract checks that must be implemented

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
simulated transport responses; the separate real-auth suite covers the health
rewrite and implemented auth flows. Neither suite implements the planned
profile, consent, media or matching endpoints.

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
