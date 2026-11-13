# Email authentication and browser sessions

## Implemented scope

Registration, SMTP email activation, resend, login, current-user restoration, protected account access, current-session logout and logout on all devices are implemented. Password reset, profiles, consent, matching and private video review remain separate features. The existing T01 Prisma schema and migration are unchanged.

## Local operation

Use native PostgreSQL 18 on localhost:5433 and native Mailpit SMTP on localhost:1025, with its inbox API on localhost:8025. No Docker is required. Start Mailpit before registration or integration tests. Keep machine credentials in ignored local environment files. Use the same hostname for web and API (localhost for both); host-only cookies are shared across ports, not across localhost and 127.0.0.1.

The web defaults to http://localhost:4000/api. Set NEXT_PUBLIC_API_BASE_URL at build time for a different public API. Set API_INTERNAL_BASE_URL to a trusted absolute API base for server rendering; it must identify the same session backend. APP_BASE_URL controls activation links and CORS_ORIGIN is the exact allowed browser origin. Production requires HTTPS, Secure cookies and authenticated TLS SMTP. Do not enable cross-site cookies without reviewing deployment CSRF and browser restrictions.

VERIFICATION_TTL_SECONDS defaults to 1800. VERIFICATION_RESEND_COOLDOWN_SECONDS defaults to 60. Session TTL defaults to 604800 seconds. Environment validation rejects unsafe production cookie settings and malformed values.

## Account and token contracts

- Registration normalizes email, validates an adult declaration and hashes passwords with the T01 Argon2id helper. It forces MEMBER/PENDING_EMAIL with no verified timestamp or session. The declaration is not identity or age verification.
- A new account and duplicate registration return the same generic 202 response. Duplicates never overwrite credentials or resend automatically. SMTP failure returns sanitized 503; a pending account remains recoverable through resend.
- Activation uses 32 random bytes, with only SHA-256 stored. The email URL uses a fragment, removed immediately into component memory. A confirmation button POSTs the token; opening a link alone does not activate an account. Refresh requires reopening the email. Invalid, expired, superseded and consumed tokens receive the same 400 guidance.
- User-row locking and conditional token consumption serialize verification/resend. Activation changes only pending, unverified accounts. It never issues a session. Resend invalidates prior links and is limited to one per configured cooldown and three issued tokens per account per 15 minutes, including initial issuance. Unknown, active and suspended accounts receive generic resend responses.
- Login requires a correct password and an ACTIVE, verified account. Unknown accounts use a dummy Argon2id comparison. Opaque session tokens are hash-only in PostgreSQL and appear solely in an HttpOnly, host-only, Path=/ persistent cookie. Login returns only id, email, displayName and role.
- Every session check reads current expiry, revocation, email verification and account status from the server. The browser cannot supply its own user ID or role. Logout-all derives ownership exclusively from the validated session, and serializes against concurrent login on the User row.

## Browser behavior and design review

/register, /verify-email, /resend-verification and /login reuse the merged design-system tokens, form controls, buttons, notices and cards. /account is protected in the server layout and client boundary. The editorial heading sits beside one focused form on desktop and stacks above it on mobile. No additional palette, typeface or theme is introduced. See UI-DESIGN-SYSTEM.md for shared component rules.

User details stay in React memory. Only an explicitly selected remembered email is written to localStorage; passwords, role and tokens are never persisted there. Unchecking removes the remembered email immediately. Safe post-login next targets are restricted to the implemented /account route. Cross-tab changes broadcast only a change signal and trigger server revalidation.

401 prompts sign-in; 403 displays denied access; network/5xx offers retry without manufacturing logout. Session boundaries hide account details while access cannot be confirmed. Sign-out changes the browser state only after server confirmation or a real 401. Logout-all requires confirmation, initially focuses the safe action and prevents dismissal during submission.

Web Interface Guidelines review covered all auth components, routes, the shared modal change and auth CSS. Sentence case follows the existing product direction. The resend submit cooldown is an intentional server-enforced exception to keeping submit enabled. Tokens and passwords intentionally never synchronize to the URL. Field labels/autocomplete, first-error focus, keyboard actions, live feedback, reduced motion, focus rings and 320px overflow are checked. Automated axe checks cover public auth pages and the real account confirmation dialog on desktop/mobile; screenshots are reviewed locally. This is not a claim of a complete manual assistive-technology audit.

## Security and deployment limits

All auth POST routes require JSON and exact Origin validation; browser requests include credentials. Auth responses are no-store and no-referrer. Per-process rate limits hash identities and IPs, cap memory, and return 429. Registration is limited to 20 attempts/IP/15 minutes, resend to 10/IP/15 minutes, login to 10/normalized identity/15 minutes, and remaining auth actions to 60/IP/15 minutes. Deploying multiple API processes requires an agreed shared limiter and trusted proxy configuration before production; this implementation does not claim distributed throttling. Duplicate registration and resend responses reduce account enumeration but cannot remove all timing/SMTP side channels.

Native Mailpit proves local SMTP acceptance and message content, not external inbox delivery, spam placement or production mail-provider configuration. No MinIO access, private media or real user fixtures are needed. Existing dependency audit findings require separate reviewed upgrades; passing these feature checks does not clear the inherited dependency tree.

## Verification

Run npm run prisma:validate, npm run prisma:generate, npm run test, npm run build, npm run test:integration --workspace apps/api, npm run test:ui --workspace apps/web and npm run test:auth --workspace apps/web.

Integration/browser tests create UUID-scoped schemas using the unchanged committed migration and drop only their own schemas. T01 tests retain rollback fixtures. Mailpit fixtures use unique example.invalid recipients, fetch only their own messages and delete only those IDs. Browser tests run the real API/database/SMTP stack on API 4100 and web 3100. Failure interception is used only to simulate outages/denials, never to prove successful authentication. Browser traces are disabled to avoid retaining credentials. CI starts its own native PostgreSQL and pinned checksum-verified Mailpit binaries.

## Review record

Web Interface Guidelines source: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md (reviewed 2026-11-14).

- apps/web/src/components/auth/register-form.tsx: ✓ pass — labels, autocomplete, first-error focus and focused success.
- apps/web/src/components/auth/login-form.tsx: ✓ pass — explicit email persistence, password-manager support and actionable failure.
- apps/web/src/components/auth/resend-form.tsx: ✓ pass — generic feedback and explained cooldown.
- apps/web/src/components/auth/verify-email-panel.tsx: ✓ pass — explicit confirmation, accessible feedback and recovery link.
- apps/web/src/components/auth/logout-controls.tsx: ✓ pass — confirmation, safe initial focus and contextual errors.
- apps/web/src/app/(auth)/auth.css: ✓ pass — shared tokens and responsive grid without horizontal overflow.

Executed locally: PASS 75 unit tests; PASS 22 PostgreSQL/SMTP integration tests; PASS 24 shared-UI/contract checks; PASS 12 real authentication browser checks on desktop/mobile, including axe scans. PASS Prisma validate/generate and existing migration status; PASS root build and TypeScript checks. npm audit: FAIL (11 low, 12 moderate, 15 high; 0 critical; 38 total inherited entries). Existing locked dependency versions are unchanged and Nodemailer is absent from the reported advisories. Feature verification is not production security approval.
