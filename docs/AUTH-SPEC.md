# Authentication, session management, and authorization specification

**Implementation status:** PLANNED. The starter does not yet contain a working registration, login, or session implementation.

## 1. Account state and roles

`GUEST` (no authenticated session) → `PENDING_EMAIL` (registered, email not confirmed) → `ACTIVE` (eligible to log in), with `SUSPENDED` or `DELETED` disabling access.

Roles `MEMBER`, `EXPERT`, `MODERATOR`, and `ADMIN` are **authorization roles**, not authentication assurance levels. Email verification proves control of an inbox at that moment; it is **not** identity verification or MFA.

## 2. Registration and activation

1. Provide a responsive email/password form with optional display name and mandatory adult-age declaration. Validate on both frontend and backend.
2. Normalize the email address, hash the password with **Argon2id**, and create `User.status=PENDING_EMAIL` with `emailVerifiedAt=null`.
3. Generate a cryptographically random single-use email token, store **only its hash** and expiration, and send an activation link through SMTP (Mailpit in development).
4. Atomically validate token hash, expiration, and unused status; mark the token consumed; set `emailVerifiedAt` and account status `ACTIVE`.
5. Resend activation with a generic response, per-identity and per-IP rate limits, cooldown, and invalidation rules for previous links.
6. A pending, suspended, or deleted account cannot receive an authenticated member session. Do not automatically log in a pending account.

## 3. Login and secure browser session

1. On `/login` or a protected page, request `GET /api/auth/me` using the appropriate cookie credentials policy.
2. If `200`, retrieve the safe user projection and route an already-authenticated user to the dashboard (or validated internal `next` path). If `401`, display the login page.
3. `POST /api/auth/login` validates input, applies throttling, compares the Argon2id hash, and checks `ACTIVE` plus verified email.
4. On success, generate a high-entropy **opaque session token**. Store only the token hash in PostgreSQL `Session`, with account reference, expiry, revocation, and optional activity data.
5. Set an `HttpOnly` cookie, `Secure` under production HTTPS, suitable `SameSite` settings, a clear lifetime, and `Path=/`. Use `__Host-` only when host-only/Secure/Path requirements are met. Rotate session identifiers when privileges change and according to the session threat model.
6. `/auth/me` hashes and checks the cookie token against the database, including expiry, revocation, and current user state. Return a minimal safe projection such as `{id,email,displayName,role}`.
7. Keep the user projection in memory/React Auth Context. On reload or browser restart, restore it by calling `/auth/me` again. **Never store the session token in browser localStorage or sessionStorage.**
8. Expired/revoked/missing sessions return `401` → clear in-memory auth state and redirect to `/login`. Network failure or `5xx` → show an error and retry option; **do not treat an outage as logout**. Authenticated-but-forbidden requests return `403`, not automatic logout.
9. An optional "Remember email" preference may save **only the email address**, with explicit user choice; never save passwords or authentication tokens. Validate `next` to prevent open redirects.
10. Protect SSR/server-rendered routes and data endpoints too; client-side route guards alone are not sufficient.

## 4. Logout, session revocation, and password recovery

- **Logout:** revoke the current session in PostgreSQL and clear the browser cookie using consistent name/path/domain settings.
- **Logout all:** atomically revoke all active sessions for that user, with appropriate user confirmation on sensitive actions.
- **Forgot password:** use a non-enumerating response; create an expiring, single-use, random token stored as a hash, with throttling and email notification.
- **Reset password:** atomically consume the reset token, hash the new password, revoke existing sessions, and write a redacted audit event.
- **Suspension/deletion:** deny future API requests even when an unexpired cookie remains in the browser.

## 5. Authentication for every protected request

```text
Browser request
  → HttpOnly session cookie
  → Session guard (hash token; look up PostgreSQL record)
  → Check expiry, revocation, account status, and verified email
  → Populate server-side current user context
  → Role guard
  → Ownership / reviewer assignment / current-consent checks
  → Execute controller only when authorized
```

- Return **401 Unauthorized** for missing or invalid authentication.
- Return **403 Forbidden** when an authenticated caller lacks access to the requested operation.
- Prevent direct-object-reference attacks; never trust `userId` or a claimed role from browser state.

## 6. Resource access policies

| Resource/action | Required rules |
| --- | --- |
| Own profile or video | Authenticated MEMBER and `ownerId === currentUser.id` |
| Assigned private video | Active EXPERT, eligible reviewer, active assignment, ready video, current owner consent |
| Approve submitted review | MODERATOR/QA with appropriate access; must not be the review author |
| Read review report | The owning member; review must be QA-approved |
| Generate matches | Active adult MEMBER, current matching consent, no block, only appropriately shared facts |
| Moderate reports | Authorized MODERATOR/ADMIN within assigned scope; record audited access |

## 7. Required safeguards and acceptance criteria

- Use Argon2id, secure randomness, token hashing, session expiry/revocation, and session rotation as required.
- Add CSRF defenses for cookie-authenticated state changes (e.g., explicit anti-CSRF tokens and/or strict Origin/Referer validation), not `SameSite` alone.
- Use restrictive CORS; never combine wildcard origins with credentialed requests. Apply XSS protections and safe cookie settings.
- Limit registration/login/reset/resend requests without permitting straightforward account enumeration.
- Require real MFA before EXPERT, MODERATOR, or ADMIN accounts access actual private member data. A role flag alone does not satisfy MFA.
- Audit privileged actions without logging secrets, passwords, raw video, or sensitive review statements.
- Test duplicate registration; invalid, used, and expired email tokens; pending login; browser refresh/reopen; invalid cookies; simultaneous logout-all; token reuse; reset; `401` vs `403` vs network outage; cross-user video access; CSRF; and open redirect attempts.

**Acceptance:** Browser register → activation email → verify → login → `/auth/me` → refresh restore → logout works against actual UI/API/database, including negative cases, before labeling Auth done.
