# VERA Match backlog — 20 tickets / 104 proposed micro-tasks

**Status:** All tickets start as **PLANNED**. A ticket becomes DONE only after its frontend, API, persistence, permissions, and tests actually work—not merely because a document or commit exists.

| Ticket | Owner | Day | Branch | Outcome | Planned tasks |
| --- | --- | --- | --- | --- | --- |
| T01 | Huong | D1 | `huong/chore/auth-foundation` | Auth/API/DB foundation | C001–C006 |
| T02 | Phuc | D1 | `phuc/chore/web-foundation` | Web foundation and CI | C007–C012 |
| T03 | Huong | D2 | `huong/feat/email-auth-session` | Register, email verification, login | C013–C018 |
| T04 | Phuc | D2 | `phuc/feat/profile-consent` | Profile, questionnaire, consent | C019–C024 |
| T05 | Huong | D3 | `huong/feat/email-auth-session` | Session restoration, logout, auth UI | C025–C030 |
| T06 | Phuc | D3 | `phuc/feat/expert-assignment` | Reviewer eligibility and assignment | C031–C036 |
| T07 | Huong | D4 | `huong/feat/private-video` | Video recording, upload, private playback | C037–C042 |
| T08 | Phuc | D4 | `phuc/feat/expert-review-workspace` | Expert video review workspace | C043–C048 |
| T09 | Huong | D5 | `huong/feat/private-video` | Video revocation and deletion | C049–C054 |
| T10 | Phuc | D5 | `phuc/feat/review-approval` | Review submission, independent QA, owner report | C055–C060 |
| T11 | Huong | D6 | `huong/feat/safety-privacy` | Blocking, reporting, account privacy | C061–C066 |
| T12 | Phuc | D6 | `phuc/feat/review-approval` | Claims, owner confirmation and disputes | C067–C072 |
| T13 | Huong | D7 | `huong/feat/auth-recovery-security` | Password recovery, CSRF, throttling | C073–C077 |
| T14 | Phuc | D7 | `phuc/feat/reciprocal-matching` | Reciprocal matching and decisions | C078–C082 |
| T15 | Huong | D8 | `huong/test/security-regression` | Security regression tests and fixes | C083–C087 |
| T16 | Phuc | D8 | `phuc/test/e2e-regression` | E2E and accessibility regression | C088–C092 |
| T17 | Huong | D9 | `release/v0.1.0` | Release authentication, database, security QA | C093–C095 |
| T18 | Phuc | D9 | `release/v0.1.0` | Reviewer workflow/matching release QA | C096–C098 |
| T19 | Huong | D10 | `release/v0.1.0` | Final privacy/security sign-off | C099–C101 |
| T20 | Phuc | D10 | `release/v0.1.0` | Demo acceptance and release notes | C102–C104 |

## Ticket Definition of Done

- [ ] Real API behavior, schema/migration if required, complete UI states, and success/failure tests.
- [ ] Server-side ownership, role, current-consent and assignment checks where applicable.
- [ ] Cross-review by the other developer; relevant CI checks pass and any remaining limitations are recorded.
- [ ] Video/review/matching changes include withdrawal and IDOR/unauthorized-access checks.
- [ ] No secret, private user video, or real sensitive evidence is committed.
- [ ] No ticket is marked DONE merely to reach a target commit count.
