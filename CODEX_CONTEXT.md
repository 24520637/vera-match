# VERA Match — Codex project context

## The product

VERA Match is a private matchmaking application. The intended member journey is:

**Register → Verify email → Log in → Profile/questionnaire/preferences/consent → Upload private video → Expert assignment → Evidence-based observations → Independent QA → Member report and granular confirmation → Reciprocal matching → Accept/decline.**

Video reviews are written by qualified **reviewers** in a controlled workflow. No automated or pretrained personality model is used. The product name is **VERA Match**; "expert review" describes a feature, not an edition or brand.

## Team and responsibilities

- **Huong:** authentication, verification emails, sessions, password recovery, guards, private video access/upload/revocation, reports/blocking/privacy, security regression.
- **Phuc:** web foundation and CI, profile/questionnaire/preferences/consent, expert assignment, review workspace, QA, claims/disputes, reciprocal matching, end-to-end regression.
- Both engineers are **full-stack** within their ownership areas, review one another's pull requests, and coordinate changes to shared API contracts, `User`, and Prisma schema.

## Source of truth

- `docs/FEATURE-OWNERSHIP.md`: owners and shared boundaries.
- `docs/PLAN-2-WEEKS.md`: ten-day dependency plan; dates in the historical CSV are illustrative.
- `docs/COMMIT-PLAN.md` and `.csv`: proposed C001–C104 micro-tasks and evidence.
- `docs/AUTH-SPEC.md`, `docs/EXPERT-REVIEW-WORKFLOW.md`, `docs/API-CONTRACT.md`, `docs/DATABASE.md`: expected behavior and data flow.
- `docs/TEST-PLAN.md` and `docs/STARTER-STATUS.md`: acceptance gates and what currently exists.

## When assigned a task

1. Check `git status` and `git branch --show-current`. Read the exact ticket/micro-task and its verification criterion.
2. Inspect the **actual repository** before editing; identify affected files and shared contracts.
3. Implement real code and tests. Do not mock successful authentication, use fake reviewer output, or hard-code matching decisions.
4. Run appropriate build, validation, migration, unit, integration, and E2E tests when available; report `PASS`, `FAIL`, or `NOT RUN` honestly.
5. Summarize the changed files, diffs, known risks, and the proposed task-specific commit message. Do not commit or push without an explicit instruction.

## Safety and scope guardrails

- Keep videos, raw observations, and sensitive review content private. No publicly readable media objects.
- Enforce role, assignment, ownership, and current consent **in the API**, not merely in the frontend.
- A QA-approved report does not automatically make its claims shareable. The owner must independently confirm and authorize each allowed claim.
- Never score people directly from subjective personality observations.
- A staff role by itself is not proof of verified expertise or MFA completion. Require documented eligibility and enforced MFA before real-data access.
- If the ten-day plan becomes infeasible, protect P0: Auth → Profile/Consent → Private video → Reviewer workflow and QA → Matching → Security. Leave chat and notifications at P1.
