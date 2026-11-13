# API contract — VERA Match

**Status:** Health/readiness and `/auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/logout-all` are implemented. All other business routes below remain DESIGN ONLY. See `EMAIL-AUTH-SESSIONS.md` for tested details.

API prefix: `/api`. The browser uses a server-issued HttpOnly session cookie. Mutating cookie-authenticated endpoints require CSRF protection. Suggested error envelope: `{code, message, details?}`. Use `401` for unauthenticated, `403` for denied access, `409` for state/version conflict, and `400`/`422` for invalid requests.

| Method    | Route                              | Caller                  | Request, response, and authorization requirements                                                         |
| --------- | ---------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| POST      | `/auth/register`                   | Guest                   | `{email,password,declaredAdult}`; create PENDING_EMAIL, send activation link; do not log in automatically |
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

1. Authenticate the cookie and authorize **resource ownership** at the API, never only in the UI or based on a caller-supplied user ID.
2. `/auth/me` network/`5xx` failures should offer retry, not redirect to login. Only an actual invalid session (`401`) implies reauthentication; `403` means insufficient privileges.
3. Keep review/QA/consent transitions atomic, prevent race conditions, and reject stale versions.
4. Keep stored videos private, use short-lived signed URLs, and revoke access when consent or assignments become invalid.
5. Never expose private video, raw reviewer notes, biometric-like observations, or unapproved assessments in matching explanations.
6. Only the routes identified as implemented above exist; remaining routes are a **plan**.

## Implemented auth response contract

All auth POSTs require exact configured Origin and application/json. Registration accepts optional displayName (1–80 characters), email (max 254), password (12–128 characters) and declaredAdult=true. Unknown/privileged fields are rejected. New/duplicate registration returns the same generic 202, without cookies. Verification takes a canonical 43-character base64url token and returns 200 on one atomic activation; invalid/expired/used tokens return 400. Resend returns generic 202 with retryAfterSeconds, including for unknown addresses and throttled account cooldowns.

Login returns 200 with flat {id,email,displayName,role} and a persistent HttpOnly cookie; invalid credentials/account state returns generic 401. GET /auth/me returns that same safe projection after database validation. Logout and logout-all return 204 and clear matching host-only cookie settings. Logout-all requires a valid current session and ignores caller-supplied ownership: ownership comes from the server context. Mutation guards reject foreign/missing Origin (403), non-JSON (415) and excess attempts (429). Validation returns 400 with sanitized field details. SMTP/database outages return sanitized 503 and never imply an authenticated or logged-out state.
