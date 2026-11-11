# VERA Match — development instructions for Codex

## Scope and product intent

- The product is **VERA Match**, an adult matchmaking platform using user profiles, questionnaires, private video uploads, and **expert-led video review**.
- **Do not** implement pretrained or automated personality inference, fake identity verification, fake deepfake detection, paid tiers, checkout, subscriptions, or concierge services.
- Huong and Phuc each deliver their assigned feature **end-to-end**: frontend UI, NestJS API, Prisma models/migrations, and tests. See `docs/FEATURE-OWNERSHIP.md`.
- Work on **one assigned ticket and micro-task at a time**. The 104 entries are proposed work, not commits that already exist or a target for empty commits.
- Report `PLANNED`, `IN PROGRESS`, `DONE`, and `BLOCKED` accurately. Never present the scaffold as a working app.

## Read first

`CODEX_CONTEXT.md`, `docs/SCOPE-DECISIONS.md`, `docs/FEATURE-OWNERSHIP.md`, `docs/PLAN-2-WEEKS.md`, `docs/BACKLOG.md`, `docs/COMMIT-PLAN.md`, `docs/API-CONTRACT.md`, `docs/AUTH-SPEC.md`, `docs/EXPERT-REVIEW-WORKFLOW.md`.

## Definition of Done

1. Working UI → API → database flow; include a migration if the schema changes.
2. Backend authentication and authorization: session, role, resource ownership, reviewer assignment, and current consent where applicable.
3. Tests for success, validation failure, expired/revoked sessions, 401/403 responses, state conflicts, and consent revocation.
4. Loading/empty/error/success states, responsive layout, keyboard navigation, and accessible form labels.
5. Keep API contracts and documentation up to date; report each verification as `PASS`, `FAIL`, or `NOT RUN`.
6. Commit only real changes; never commit credentials, tokens, personally identifying production data, or private user videos.

## Domain rules

- Members may access their own videos. Expert reviewers may access **only currently assigned** videos when consent is valid. A QA reviewer must not approve their own assessment.
- Members may view the QA-approved report about their own video, submit feedback, dispute the report, and confirm or revoke individual factual claims.
- Only factual claims that are QA-approved, owner-confirmed, share-approved, and not revoked may enter matching; the current matching-related consent must also be valid.
- Do not infer honesty, loyalty, relationship outcomes, or fixed personality traits from limited video signals. Subjective human assessment is contextual, not verified fact.
- Cookie-based sessions must be validated on the server. Never store session tokens in `localStorage` or `sessionStorage`. Distinguish an actual `401` from an offline/`5xx` error.
- Protect cookie-authenticated state-changing endpoints from CSRF, use rate limits, and enforce least-privilege staff access.

Do not automatically commit or push unless the user explicitly requests it.
