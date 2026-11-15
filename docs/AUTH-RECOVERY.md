# Authentication recovery

## Requesting a link

`POST /api/auth/forgot-password` accepts `{ "email": "..." }` and returns HTTP 202 with a generic `message` and `retryAfterSeconds`. Unknown, pending, suspended and eligible accounts receive the same response. Acceptance means the request was queued, not that email was delivered. No session is created and no token is returned in JSON.

Account lookup and SMTP run outside the HTTP response path. The bounded, single-worker queue holds at most 32 waiting requests; global saturation returns 503 independently of account existence. Shutdown drains accepted work before closing SMTP. This queue is volatile: a crash can lose accepted requests. Native Mailpit verifies local SMTP only; production SMTP and crash-durable delivery remain deployment gates.

Eligible accounts must already be ACTIVE with verified email. Tokens contain 32 cryptographically random bytes; only SHA-256 hashes are stored in the existing PasswordResetToken table. Links use `/reset-password#token=...` to keep credentials out of HTTP URLs and referrers. Defaults are 30-minute expiry, 60-second per-account cooldown and at most three issued tokens per 15 minutes. New issuance consumes prior unused tokens; failed SMTP invalidates the newly issued token.

The existing in-memory limiter is MVP-only for one API process. Forgot requests additionally allow 10 attempts per socket client IP and three per normalized email in 15 minutes, including unknown addresses. Counters contain hashes, not raw addresses. Restart clears counters; multiple processes do not share them. Reverse-proxy deployments currently share the proxy's socket IP because trust proxy stays disabled. Do not enable arbitrary forwarded-header trust or deploy multiple instances without agreeing on a shared limiter and an explicit trusted-proxy topology.

Machine-local `.env` files remain private. Optional non-secret settings: `PASSWORD_RESET_TTL_SECONDS` (60–3600) and `PASSWORD_RESET_COOLDOWN_SECONDS` (10–3600).
