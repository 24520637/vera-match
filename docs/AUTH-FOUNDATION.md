# T01 — authentication and database foundation

Scope: C001–C006 only. Registration, login, mail delivery, media and frontend journeys belong to later features. No frontend or design-system changes are required for this foundation.

## Configuration contract (C001)

The API validates configuration before listening. Configuration errors report variable names and requirements, never supplied values. `EnvironmentService.values` is the typed shared configuration interface.

- Native local PostgreSQL 18 uses `localhost:5433`; use the existing machine-local `.env` / `apps/api/.env`. No Docker is required. `DATABASE_URL` must include database credentials.
- `API_PORT` / `SMTP_PORT`: integer 1–65535. `SESSION_TTL_SECONDS`: 60–2592000, default 604800.
- Cookies always use HttpOnly and Path=/; `COOKIE_SECURE` is a strict boolean. Production, prefixed cookies and SameSite=None require Secure. SameSite defaults to lax. No session signing secret is needed for random opaque tokens stored as hashes.
- Production requires HTTPS app/CORS/MinIO origins, non-placeholder DB and MinIO credentials, SMTP sender/host and SMTP authentication with TLS. Local SMTP may omit authentication only when both user/password are empty.
- MinIO credential names remain compatible with the existing `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` configuration. A future media adapter should use a bucket-scoped service account in production.
- Native Mailpit and MinIO are currently not listening on local ports 1025 and 9000. Their availability is not a T01 dependency; this feature validates their settings without pretending to deliver email or upload files.

`AGENTS.md`, `CODEX_CONTEXT.md` and `docs/COMMIT-PLAN.md` were removed in merged PR #3. This feature follows the live specifications and the user-provided C001–C006 scope; it does not recreate those removed files.

## Database lifecycle (C002)

`DatabaseModule` exports one injectable `PrismaService`. Startup explicitly connects; connection failures stop startup with a redacted message. Nest shutdown hooks disconnect the client. Explicit connection/pool timeouts in DATABASE_URL are preserved; otherwise both waits default to 3 seconds.

`GET /api/health` is process liveness and does not query PostgreSQL. `GET /api/health/ready` executes a query and returns 503 with a sanitized error if it fails. An initial unavailable database prevents startup; readiness covers loss of a running connection. On Windows use Ctrl+C for shutdown; SIGTERM semantics differ from Unix. Integration smoke also exercises `app.close()` and verifies the disconnect hook.

## Existing account schema (C003 — ALREADY COMPLETE)

The merged initial migration already defines User.status=PENDING_EMAIL, MEMBER role, nullable emailVerifiedAt, unique email and session/token hashes, expiration/revocation/consumption timestamps and user/expiry indexes. Prisma validate/generate and migrate status pass; migrate diff against the live local database reports no difference. A synthetic User created without a status received PENDING_EMAIL; its transaction was rolled back and cleanup verified. No schema or migration history changes were needed. Login/registration endpoints are not part of T01.

## Password helper (C004)

`PasswordService` hashes with Argon2id v19, a random per-password salt and 32-byte output. Defaults: 64 MiB memory, 3 iterations, 1 lane. Configured lower bounds are 19 MiB / 2 iterations / 1 lane; upper bounds prevent accidental resource exhaustion. Input is bounded to 1024 UTF-8 bytes without normalization or truncation. Invalid/non-Argon2id/corrupt/excessive-cost stored hashes fail closed. No password or hash is logged. Minimum password policy belongs to the later registration DTO; this primitive does not pretend to implement registration.

## Session request context (C005)

Compose `@UseGuards(SessionAuthGuard, RolesGuard)` with an explicit `@Roles(...)` declaration, then read `@CurrentUser()`. The context is a safe projection from PostgreSQL, never a role/user ID from request body or frontend state. Without role metadata the role guard denies access. Resource ownership, assignment, current consent and staff MFA remain required domain checks before those later features expose protected data.

Session tokens are exactly 32 random bytes encoded as canonical unpadded base64url (43 characters). The future login issuer must set the configured HttpOnly/Secure/SameSite/Path cookie and store only `SHA-256(token)` as a 64-character hex tokenHash. The guard rejects malformed/duplicate cookies, checks expiration/revocation on every request and requires an ACTIVE, email-verified account. It does not cache auth or create sessions. Missing/invalid/expired/revoked sessions produce 401, insufficient roles 403, DB failures sanitized 503.

T01 adds no public auth or mutation endpoints. Cookie-authenticated mutations in later features must compose CSRF validation and rate limits, not rely on SameSite or this identity guard alone. Public process/readiness health endpoints remain unauthenticated and disclose no account data.

## Shared review contract

Phuc must review configuration, User/session access and any Prisma/API changes before merge. No Phuc GitHub username is recorded in the repository; assign Phuc as reviewer manually if it cannot be resolved. Only the existing Prisma migration is used unless a verified schema gap requires an incremental change.
