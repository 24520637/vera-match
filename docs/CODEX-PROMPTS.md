# Codex task prompts — Huong and Phuc

## One micro-task at a time

```text
I am [Huong|Phuc]. Current branch: [branch]. Ticket [Txx], micro-task [Cxxx].
Read AGENTS.md, CODEX_CONTEXT.md, docs/COMMIT-PLAN.md,
docs/FEATURE-OWNERSHIP.md, and the applicable specification
(AUTH-SPEC.md / EXPERT-REVIEW-WORKFLOW.md / API-CONTRACT.md).

Work only on the assigned Cxxx scope in the current repository.
Do not implement future tasks, hard-code fake reviewer results,
or claim a test passed without running it.

Implement the relevant UI, API, persistence, and tests. Run typechecking,
Prisma validation, builds, unit/integration/E2E checks when appropriate.
At the end, report changed files, diff summary, test results as
PASS / FAIL / NOT RUN, security/privacy considerations, and the
planned commit message. Do not commit or push unless requested.
```

## Huong — Day 1

**T01 / C001:** Confirm `huong/chore/auth-foundation`. Add validated environment configuration for database, session lifetime, cookie settings, SMTP, and MinIO. Write the verification checks defined for C001.

## Phuc — Day 1

**T02 / C007:** Confirm `phuc/chore/web-foundation`. Set up public/member/expert/moderation route groups and their app shells. Check build and route behavior according to C007.

## Required integration agreements

- Huong defines session/auth/video DTOs before Phuc builds interfaces depending on them.
- Phuc defines consent and factual claim contracts before Huong implements related upload/revocation behavior.
- Both review shared Prisma schema and migration changes in PRs; never overwrite one another's model edits.
