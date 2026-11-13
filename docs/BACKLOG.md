# VERA Match backlog — 20 tickets

**Status:** All tickets start as **PLANNED**. A ticket becomes DONE only after its frontend, API, persistence, permissions, and tests actually work—not merely because a document or commit exists.

| Ticket | Owner | Day | Branch | Outcome |
| --- | --- | --- | --- | --- |
| T01 | Huong | D1 | `huong/chore/auth-foundation` | Auth/API/DB foundation |
| T02 | Phuc | D1 | `phuc/chore/web-foundation` | Web foundation and CI |
| T03 | Huong | D2 | `huong/feat/email-auth-session` | Register, email verification, login |
| T04 | Phuc | D2 | `phuc/feat/profile-consent` | Profile, questionnaire, consent |
| T05 | Huong | D3 | `huong/feat/email-auth-session` | Session restoration, logout, auth UI |
| T06 | Phuc | D3 | `phuc/feat/expert-assignment` | Reviewer eligibility and assignment |
| T07 | Huong | D4 | `huong/feat/private-video` | Video recording, upload, private playback |
| T08 | Phuc | D4 | `phuc/feat/expert-review-workspace` | Expert video review workspace |
| T09 | Huong | D5 | `huong/feat/private-video` | Video revocation and deletion |
| T10 | Phuc | D5 | `phuc/feat/review-approval` | Review submission, independent QA, owner report |
| T11 | Huong | D6 | `huong/feat/safety-privacy` | Blocking, reporting, account privacy |
| T12 | Phuc | D6 | `phuc/feat/review-approval` | Claims, owner confirmation and disputes |
| T13 | Huong | D7 | `huong/feat/auth-recovery-security` | Password recovery, CSRF, throttling |
| T14 | Phuc | D7 | `phuc/feat/reciprocal-matching` | Reciprocal matching and decisions |
| T15 | Huong | D8 | `huong/test/security-regression` | Security regression tests and fixes |
| T16 | Phuc | D8 | `phuc/test/e2e-regression` | E2E and accessibility regression |
| T17 | Huong | D9 | `release/v0.1.0` | Release authentication, database, security QA |
| T18 | Phuc | D9 | `release/v0.1.0` | Reviewer workflow/matching release QA |
| T19 | Huong | D10 | `release/v0.1.0` | Final privacy/security sign-off |
| T20 | Phuc | D10 | `release/v0.1.0` | Demo acceptance and release notes |

## Ticket Definition of Done

- [ ] Real API behavior, schema/migration if required, complete UI states, and success/failure tests.
- [ ] Server-side ownership, role, current-consent and assignment checks where applicable.
- [ ] Cross-review by the other developer; relevant CI checks pass and any remaining limitations are recorded.
- [ ] Video/review/matching changes include withdrawal and IDOR/unauthorized-access checks.
- [ ] No secret, private user video, or real sensitive evidence is committed.
- [ ] No ticket is marked DONE merely to reach a target commit count.
