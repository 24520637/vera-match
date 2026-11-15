# Authentication recovery

## Requesting a link

`POST /api/auth/forgot-password` accepts `{ "email": "..." }` and returns HTTP 202 with a generic `message` and `retryAfterSeconds`. Unknown, pending, suspended and eligible accounts receive the same response. Acceptance means the request was queued, not that email was delivered. No session is created and no token is returned in JSON.

Account lookup and SMTP run outside the HTTP response path. The bounded, single-worker queue holds at most 32 waiting requests; global saturation returns 503 independently of account existence. Shutdown drains accepted work before closing SMTP. This queue is volatile: a crash can lose accepted requests. Native Mailpit verifies local SMTP only; production SMTP and crash-durable delivery remain deployment gates.

Eligible accounts must already be ACTIVE with verified email. Tokens contain 32 cryptographically random bytes; only SHA-256 hashes are stored in the existing PasswordResetToken table. Links use `/reset-password#token=...` to keep credentials out of HTTP URLs and referrers. Defaults are 30-minute expiry, 60-second per-account cooldown and at most three issued tokens per 15 minutes. New issuance consumes prior unused tokens; failed SMTP invalidates the newly issued token.

The existing in-memory limiter is MVP-only for one API process. Forgot requests additionally allow 10 attempts per socket client IP and three per socket-IP/normalized-email pair in 15 minutes, including unknown addresses. Counters contain hashes, not raw addresses. Restart clears counters; multiple processes do not share them. Reverse-proxy deployments currently share the proxy's socket IP because trust proxy stays disabled. Do not enable arbitrary forwarded-header trust or deploy multiple instances without agreeing on a shared limiter and an explicit trusted-proxy topology.

Machine-local `.env` files remain private. Optional non-secret settings: `PASSWORD_RESET_TTL_SECONDS` (60–3600) and `PASSWORD_RESET_COOLDOWN_SECONDS` (10–3600).

## Consuming a link

`POST /api/auth/reset-password` accepts `{ "token": "...", "newPassword": "..." }`. Passwords contain 12–128 characters and are never trimmed. A successful HTTP 200 response contains only a confirmation message; it does not activate an account or log it in. Invalid, expired, consumed and ineligible links share HTTP 400 `INVALID_RESET_LINK`. Database or hashing failures return sanitized HTTP 503 `RESET_UNAVAILABLE`.

The existing Argon2id helper hashes the password. An account row lock serializes reset with issuance, login and logout-all. Token consumption, password replacement, invalidation of remaining recovery tokens, revocation of every session and a minimal PASSWORD_RESET_COMPLETED audit event commit atomically. The audit contains account IDs and action only; no password, token, email or content. A failure rolls back the entire transaction. Cookies belonging to another account are not blindly cleared. The account must sign in again; old cookies receive 401. No Prisma schema or migration change is required.

## Request security

Both recovery mutations require JSON and the exact configured CORS_ORIGIN; missing/null/foreign Origin receives 403, non-JSON receives 415. Cross-site Fetch Metadata is denied as additional defense. SameSite cookies alone are not the CSRF control. Direct local HTTP and the existing same-origin Next proxy use the same guard and shared API client. Production environment validation still requires HTTPS and Secure cookies. No arbitrary X-Forwarded-For trust is enabled.

Reset attempts allow 20 per socket IP and five per hashed token per 15 minutes. Forgot limits count requests for unknown addresses too. HTTP 429 preserves the shared RATE_LIMITED body and integer Retry-After header; both forms use the existing API client and cooldown feedback. They never automatically retry password or email submissions. Unit tests check the exact window boundary; integration tests cover direct access and browser tests cover the actual Next proxy.

## Client-IP review and production gate

Confirmed: different browser clients behind the current Next rewrite share the API-facing proxy socket IP. The 10-request socket quota therefore caps the combined proxy traffic; changing forwarded headers never bypasses it. Direct-access integration tests bind real clients to 127.0.0.2 and 127.0.0.3; a native forwarding proxy proves these same clients collapse to one API-facing IP. This is a conservative MVP/demo restriction, not a production client-IP solution.

The forgot-password HTTP identity quota now belongs to the socket-IP/email pair. A different direct client cannot spend another client’s pair quota by guessing its email. Login policy is unchanged. Persisted per-account issuance cooldown and the three-attempt/15-minute bound remain global to prevent mail bombing, including requests from multiple IPs. An unauthenticated caller can still trigger that account budget; the eligible inbox owner receives the permitted links, never the requester. This does not provide protection against distributed email flooding or denial behind a shared proxy.

Before a real-user release, agree on the edge/Next/API topology, which hop overwrites untrusted forwarding headers, the exact trusted socket peers/CIDRs, how direct API ingress is blocked, and where client-IP throttling runs. Then implement and test only that restricted trust model, including multiple clients and forged chains in the deployed environment. No trusted topology or stable proxy identity is currently configured; enabling blanket trust proxy or choosing an arbitrary hop count would be unsafe. Production release is blocked on that agreement and verification. No new forwarded-header configuration is introduced here.
