# Data model — PostgreSQL and Prisma

> `apps/api/prisma/schema.prisma` is a **draft**. Run `prisma validate`, generate a migration, and review foreign keys, indexes, security constraints, and data-lifecycle behavior before using real user data.

| Area | Models | Why they exist |
| --- | --- | --- |
| Identity and sessions | `User`, `Session`, `EmailVerificationToken`, `PasswordResetToken` | Verified email, account status, token hashes, session revocation |
| Member data | `Profile`, `MatchPreference`, `QuestionnaireAnswer`, `Consent` | Member attributes, versioned answers, five privacy purposes |
| Private media | `Video` | Object metadata and authorization state, not video bytes |
| Expert review | `ExpertAssignment`, `ExpertReview`, `ExpertObservation` | Assigned jobs, drafts, timestamps, QA/version tracking |
| Claims and disputes | `ReviewClaim`, `ReviewDispute` | Factual claim approval, owner permission/withdrawal and feedback |
| Connections | `MatchPair`, `MatchDecision` | Canonical pairs and both users' decisions |
| Trust and safety | `Block`, `Report`, `AuditLog` | Blocking, member reports, scoped moderation, redacted audit data |

## Data and security invariants

- Store video **objects** in private object storage; store only metadata and opaque keys in SQL. Signed URLs must expire quickly.
- Store **hashes** of session, activation and password-reset tokens, never raw token strings. Store password hashes using Argon2id.
- Canonicalize each pair as `(userLowId, userHighId)` to prevent duplicate reversed pairs.
- Check current consent at **query/access time**, not solely from stale cached flags.
- Subjective reviewer conclusions do not become scoreable claims. Factual claims require QA, owner confirmation, explicit sharing and no revocation.
- Document and enforce retention and deletion based on legal requirements and member promises; never assume indefinite storage is acceptable.

**Draft model gap:** Staff credential/eligibility and some workflow audit details are described as planned work but may require additional migrations. Do not treat a role flag as proof of reviewer qualification.
