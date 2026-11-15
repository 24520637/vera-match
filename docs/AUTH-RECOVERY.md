# Authentication recovery

## Requesting a link

`POST /api/auth/forgot-password` accepts `{ "email": "..." }` and returns HTTP 202 with a generic `message` and `retryAfterSeconds`. Unknown, pending, suspended and eligible accounts receive the same response. Acceptance means the request was queued, not that email was delivered. No session is created and no token is returned in JSON.

Account lookup and SMTP run outside the HTTP response path. The bounded, single-worker queue holds at most 32 waiting requests; global saturation returns 503 independently of account existence. Shutdown drains accepted work before closing SMTP. This queue is volatile: a crash can lose accepted requests. Native Mailpit verifies local SMTP only; production SMTP and crash-durable delivery remain deployment gates.

Eligible accounts must already be ACTIVE with verified email. Tokens contain 32 cryptographically random bytes; only SHA-256 hashes are stored in the existing PasswordResetToken table. Links use `/reset-password#token=...` to keep credentials out of HTTP URLs and referrers. Defaults are 30-minute expiry, 60-second per-account cooldown and at most three issued tokens per 15 minutes. SMTP-confirmed replacement consumes older unused tokens; a failed or timed-out delivery invalidates only its newly created token and preserves a previously delivered link.

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

## Delivery reliability and token replacement review

Confirmed bug fixed: a failed replacement delivery previously consumed the last usable link before SMTP acceptance. Reservation now creates a hash-only token without consuming older links. SMTP success is followed by an account-locked transaction that rechecks eligibility, expiry and unused state and consumes only strictly older unused rows. A delayed acknowledgement cannot consume a newer token or reactivate a token consumed by reset. Failure invalidates only the attempted new token.

During an in-flight delivery, older and newly emailed tokens can temporarily both be valid. This is intentional: the existing reset transaction locks the account and atomically consumes all outstanding tokens with the password/session changes. Concurrent old/new resets have exactly one winner. No delivery status, plaintext token, schema field or new migration is introduced; operational success is never inferred from HTTP 202. SMTP acceptance is not proof of final inbox delivery.

Durable delivery remains outside this MVP change. The existing token table has no queue payload, pending/sent state, lease or retry contract; hash-only tokens cannot reconstruct an email link after a crash. Using consumedAt as an outbox state would confuse token consumption and recovery. A reliable outbox requires an agreed schema, secret-handling strategy, worker ownership, retry/deduplication and retention plan with Phuc. No Redis, new queue service or migration is added. A crash can lose queued requests or leave a reservation that counts against cooldown; a crash after SMTP acceptance but before supersession may leave multiple valid links until reset/expiry. These are explicit production release gates, not crash-durability claims.

Native timeout tests use a deliberately silent loopback SMTP socket with the real Nodemailer greeting timeout, and confirm shutdown waits for failure cleanup. Positive and overlapping-delivery tests send actual mail to native Mailpit; only acknowledgement timing is controlled to exercise races. Queue tests cover an active job plus 32 waiting requests, rejection during saturation/shutdown, failure continuation and log redaction. No eligible-account or SMTP timing is awaited in the public request handler.

Issuance cooldown and the three-attempt window include failed or interrupted reservations. They do not disclose per-account state in the public response. A guessed address can spend this bounded account budget, but the caller never receives a token; failed replacement no longer destroys the owner’s prior usable link. This does not guarantee availability under distributed abuse, prolonged SMTP failure or process crashes.
