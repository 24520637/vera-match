# VERA Match — two-week development plan

**Team:** Huong and Phuc (both full-stack) · **Duration:** ten working days · **Tickets:** T01–T20 · **Planned commits:** C001–C104.

The historical plan CSV uses **November 2–13, 2026** as example dates. Those dates are not a future deadline. Set the actual kickoff date with the team and follow the D1–D10 order and dependencies below.

| Day | Huong — UI/API/DB/tests | Phuc — UI/API/DB/tests | Day-end acceptance evidence |
| --- | --- | --- | --- |
| D1 | T01: Auth environment, API and DB foundation (C001–C006) | T02: Web layouts, API client and CI (C007–C012) | API health, web shell, agreed DTOs, schema validation |
| D2 | T03: Register → verify email → login session (C013–C018) | T04: Profile, questionnaire, preferences and five consents (C019–C024) | Mailpit activation link, owner-protected profile CRUD |
| D3 | T05: `/auth/me`, reload restore, auth UI, logout (C025–C030) | T06: Expert eligibility, assignment and queues (C031–C036) | Refresh keeps valid session; unassigned expert denied |
| D4 | T07: Private video upload and playback (C037–C042) | T08: Reviewer workspace and timestamped observation categories (C043–C048) | Private playback; reviewer draft autosave |
| D5 | T09: Video deletion, revocation, assignment cancellation (C049–C054) | T10: Review submission, independent QA, owner report (C055–C060) | Revocation denies access; unpublished review stays private |
| D6 | T11: Block/report, moderator queue, account privacy (C061–C066) | T12: Factual claims, owner approval, dispute and revocation (C067–C072) | Unconfirmed claims cannot appear in matching |
| D7 | T13: Password recovery, CSRF, rate limiting (C073–C077) | T14: Reciprocal matching and decisions (C078–C082) | Two-way filters, block/consent checks, accept/decline |
| D8 | T15: Security regression and fixes (C083–C087) | T16: E2E and accessibility regression (C088–C092) | Auth/IDOR/CSRF checks and full demo tests |
| D9 | T17: Release security, data and migration QA (C093–C095) | T18: Reviewer/matching QA and reproducible fixtures (C096–C098) | Cut release branch from green `develop` if criteria pass |
| D10 | T19: Final privacy/security sign-off (C099–C101) | T20: Demo, README and release evidence (C102–C104) | Tag only if P0 acceptance gates pass |

## Non-negotiable checkpoints

1. Implement authentication, consent, and owner/assignment permissions **before** exposing sensitive workflows.
2. Experts may read only assigned videos; independent QA may not approve its own review; owners can comment and withdraw permissions.
3. Do not add an AI personality model. Matching may use self-declared profile fields and **factual claims** that passed QA, owner confirmation, and explicit sharing consent.
4. If behind schedule, drop P1 chat, notifications, photo albums, and advanced analytics—not core security, consent, or QA.
5. **Go/no-go:** documented E2E evidence; no private media/PII leakage; correct 401/403; safe revoke/delete; tested migrations and backup/restore process. Unmet gates mean internal-demo-only, not public production.
