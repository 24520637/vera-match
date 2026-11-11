# Feature ownership — Huong and Phuc

**Both developers are full-stack.** Each owns the UI, API, database changes, and tests for assigned features; this is not a frontend/backend split.

| Feature area | Primary owner | Backend / database | Web / user experience | Critical tests |
| --- | --- | --- | --- | --- |
| Registration, email verification, login, sessions, password recovery | **Huong** | DTOs, tokens, password hashes, sessions, guards | Register/login/verify/reset forms; auto-login | Token replay, 401/403, CSRF, connectivity failure |
| Private video and revocation/deletion | **Huong** | MinIO, signed URLs, metadata, permissions | Camera/upload, playback, account privacy | IDOR, MIME/size, revoked/expired access |
| Block, report, audit, and account privacy | **Huong** | Report/moderation endpoints, block checks, audit | Report/block/deletion screens | Unauthorized reports, deletion, withdrawal |
| Web shell, API client, and CI | **Phuc** | API contract coordination | Public/member/expert/moderation routing | Build, route, error and API smoke |
| Profile, questionnaire, preferences, consent | **Phuc** | Prisma models, CRUD, validation | Profile forms, questionnaire, privacy settings | Ownership, consent default/revoke |
| Expert eligibility, assignment and task queues | **Phuc** | Assignment states, eligibility, assignment guards | Moderator queue and expert dashboard | Unauthorized review, conflicting assignments |
| Review workspace, QA, disputes and claims | **Phuc** | Observations, timestamps, versions, QA, claims | Private player, editor, QA, owner report | State transitions, self-approval denial, dispute |
| Reciprocal matching and decisions | **Phuc** | Hard constraints, directional scores, allowed claims, decisions | Recommendations and explanations | Two-way rules, block, revoke, concurrency |
| Release, security, E2E | **Both** | Huong leads security; Phuc leads end-to-end journeys | Both review and fix regressions | No open P0 blocker |

## Shared boundaries

- Huong primarily owns `Session`, `EmailVerificationToken`, `PasswordResetToken`, `Video`, `Block`, and `Report`.
- Phuc primarily owns `Profile`, `QuestionnaireAnswer`, `Consent`, `MatchPreference`, `ExpertAssignment`, `ExpertReview`, `ExpertObservation`, `ReviewClaim`, `ReviewDispute`, `MatchPair`, and `MatchDecision`.
- Both review changes to `User`, shared environment configuration, API contracts, and Prisma migrations. Do not overwrite concurrent schema changes.
- Coordinate video READY/revoke versus reviewer assignment, and session-provider behavior versus frontend 401/403 handling, starting on Day 1.
