# Verification and acceptance test matrix

Each feature needs valid inputs, invalid inputs, unauthorized access, state/race tests, UI feedback states, and audit/revoke behavior when relevant.

| Suite | Required scenarios | Passing evidence |
| --- | --- | --- |
| Auth | Duplicate registration; expired/replayed verification; pending login; refresh restore; logout-all; replayed reset token | Correct `401`/`403`; no token exposure or account enumeration |
| Browser auth | Auto-login, protected routes, offline vs 401, remember-email opt-in, open redirects | Outage/5xx does not silently log out; understandable UI |
| Private media | Another user's video, unsupported MIME/oversized file, revoked playback, expired signed URL | Unauthorized video cannot be downloaded |
| Reviewer workflow | Missing assignment, revoked consent, invalid timestamps, optimistic version conflict, self-QA attempt | Correct `403`/`400`/`409`; unpublished draft stays private |
| Member controls | Unapproved report, disputed claim, revoked approved claim | Withdrawn claim never contributes to matching |
| Matching | Reciprocal filters, either-direction block, consent withdrawal, pair duplicates, concurrent decisions | Consistent explanations; no sensitive data exposure |
| Security | CSRF, cookie flags, throttling, redacted audit logs, signed URL TTL | Reproducible security evidence; no open critical/high issues |
| E2E | Register → verify → login → profile/consent → upload → expert → QA → owner → matching | Browser journey passes with synthetic or explicitly licensed test media only |

## Release gate

- [ ] Prisma validation and migration apply plus a tested rollback/recovery procedure in a test database.
- [ ] Actual `npm` build/tests and end-to-end checks pass; no PASS claims based on docs alone.
- [ ] No known private media/PII leakage. Session, `401`/`403`, withdrawal, and independent QA checks pass.
- [ ] Cross-reviewed release PR, changelog, and known limitations are documented.
- [ ] If any critical gate is not met: label the build **internal demonstration only**, not public production.
