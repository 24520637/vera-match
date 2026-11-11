# Starter status — implemented versus planned

## Included in this starter

- Next.js application shell and a clearly labeled placeholder landing page.
- NestJS application skeleton, `GET /api/health`, and a basic health test.
- Draft Prisma domain schema; **no applied migrations** are included.
- Local Docker Compose configuration for PostgreSQL, MinIO, and Mailpit; sample GitHub CI workflow.
- Plan for 20 tickets / 104 proposed micro-tasks, branch workflow, Codex context, API contract, Auth design, and reviewer workflow documentation.

## Not yet implemented or verified

- Backend registration, verification mail, sessions, login/logout, password reset, protected routes, and authentication forms.
- Video uploads, short-lived private access URLs, reviewer workspace, independent QA, matching, blocks, and reports.
- Full npm install/build/test, actual Prisma migration, Docker integration, and full end-to-end test suite.
- Production secrets/configuration, staff MFA, access review, threat modeling, verified backup/restore and legal retention policy.
- Any of the 104 planned feature commits. Placeholder branch refs all start at the same initial scaffold commit.

This starter intentionally has **no pretrained AI inference** and no payment features. It is a **fresh reconstruction** of the agreed VERA Match requirements, not a byte-for-byte copy of an older archive.

**Honest status rule:** A README, design document, schema draft, or health endpoint is not evidence that the complete business workflow works.
