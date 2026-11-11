# API development rules — NestJS

- Implement only assigned micro-tasks from `docs/COMMIT-PLAN.md`. Never return fake success from incomplete endpoints.
- Authenticate using a server-validated database session. Authorize using role, resource ownership, current consent, and expert assignment as appropriate.
- Do not trust a user ID or role supplied by the browser as evidence of permission.
- Every Prisma schema change needs a reviewed migration. Coordinate shared schema changes with the other developer before merging.
- Do not expose private video bytes, private object keys, or unpublished expert assessments to unrelated users. Use short-lived signed media URLs.
- Protect state-changing cookie-authenticated requests from CSRF. Redact passwords, tokens, and sensitive observations in logs.
- New endpoints require validated DTOs, consistent response/error semantics, API documentation, and relevant unit/integration tests.
