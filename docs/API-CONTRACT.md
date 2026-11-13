# Planned API contract — VERA Match

**Status: DESIGN ONLY.** With the current scaffold, only `GET /api/health` is implemented. Every endpoint below requires actual code, authorization, tests, and acceptance before use.

API prefix: `/api`. The browser uses a server-issued HttpOnly session cookie. Mutating cookie-authenticated endpoints require CSRF protection. Suggested error envelope: `{code, message, details?}`. Use `401` for unauthenticated, `403` for denied access, `409` for state/version conflict, and `400`/`422` for invalid requests.

| Method | Route | Caller | Request, response, and authorization requirements |
| --- | --- | --- | --- |
| POST | `/auth/register` | Guest | `{email,password,declaredAdult}`; create PENDING_EMAIL, send activation link; do not log in automatically |
| POST | `/auth/verify-email` | Guest | `{token}`; single-use atomic verification; status ACTIVE |
| POST | `/auth/resend-verification` | Guest | `{email}`; generic response, rate limits and cooldown |
| POST | `/auth/login` | Guest | `{email,password}`; validate account, set opaque-session cookie |
| GET | `/auth/me` | Authenticated | Return safe `{id,email,displayName,role}` after database session validation |
| POST | `/auth/logout` | Authenticated | Revoke current session; clear cookie |
| POST | `/auth/logout-all` | Authenticated | Revoke every active session for the account |
| POST | `/auth/forgot-password` | Guest | Generic email response; throttled single-use reset link |
| POST | `/auth/reset-password` | Guest | `{token,newPassword}`; atomic consume and revoke all sessions |
| GET/PATCH | `/profile/me` | Member | Own profile only; validate all fields |
| GET/PUT | `/questionnaire/me` | Member | Three versioned questionnaire answers |
| GET/PATCH | `/preferences/me` | Member | Desired ages, relationship goals, hard exclusions |
| GET/PATCH | `/consents/me` | Member | Five separate purposes; default OFF; auditable withdrawal |
| POST | `/videos/upload-intent` | Member | Consent, MIME/size validation; short-lived owner-scoped upload URL |
| POST | `/videos/:id/confirm` | Owner | Check actual object metadata; set READY only after verification |
| GET | `/videos/me` | Owner | Private metadata list |
| POST | `/videos/:id/playback` | Owner / assigned expert | Current authorization and consent → short-lived signed URL |
| DELETE | `/videos/:id` | Owner | Revoke access, cancel dependent assignments, begin deletion workflow |
| POST | `/expert/assignments` | Moderator | `{videoId,expertId,dueAt}`; verify eligibility, video status, owner consent |
| GET | `/expert/assignments/me` | Expert | Only caller's currently assigned tasks |
| POST | `/expert/reviews/:id/observations` | Assigned expert | Time range, category, evidence/context, optimistic version |
| PATCH | `/expert/reviews/:id/draft` | Assigned expert | Draft-only edit; version check and audit |
| POST | `/expert/reviews/:id/submit` | Assigned expert | Required summary/limitations; freeze submitted snapshot |
| POST | `/qa/reviews/:id/return` | Moderator | Not original author; actionable reason required |
| POST | `/qa/reviews/:id/approve` | Moderator | Not original author; enforce independent QA and valid transition |
| GET | `/reviews/me` | Owner | Only QA-approved reports for the caller |
| POST | `/reviews/:id/disputes` | Owner | Reason, dispute status and audit |
| PATCH | `/reviews/claims/:id` | Owner | Granular confirmation, share permission, withdrawal |
| GET | `/matches/recommendations` | Member | Reciprocal constraints; current consents; permitted claims only |
| POST | `/matches/:pairId/decision` | Member | `ACCEPT`/`DECLINE`; actor must belong to the pair |
| POST | `/blocks` | Member | Block another user and immediately exclude both directions |
| POST | `/reports` | Member | Validated reason and target; avoid user enumeration |
| GET/PATCH | `/moderation/reports` | Moderator | Audited access limited to authorized scope |

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
`http://localhost:4000`). Configure it at build time. Tests exercise the real
health rewrite and simulated transport responses; they do not implement or
establish acceptance of the planned authentication or feature endpoints.

1. Authenticate the cookie and authorize **resource ownership** at the API, never only in the UI or based on a caller-supplied user ID.
2. `/auth/me` network/`5xx` failures should offer retry, not redirect to login. Only an actual invalid session (`401`) implies reauthentication; `403` means insufficient privileges.
3. Keep review/QA/consent transitions atomic, prevent race conditions, and reject stale versions.
4. Keep stored videos private, use short-lived signed URLs, and revoke access when consent or assignments become invalid.
5. Never expose private video, raw reviewer notes, biometric-like observations, or unapproved assessments in matching explanations.
6. Do not interpret this table as a list of deployed endpoints; it is a **plan**.
