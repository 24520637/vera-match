# Architecture decision records — VERA Match v0.1.0

- **ADR-001 — Modular monolith:** Next.js and NestJS with TypeScript. Two full-stack engineers can coordinate faster without maintaining microservices.
- **ADR-002 — Data services:** PostgreSQL/Prisma for transactional data; private MinIO storage for video; Mailpit for development SMTP. Do not add Redis or vector infrastructure without a demonstrated need.
- **ADR-003 — Authentication:** Random opaque session tokens stored as hashes in PostgreSQL, HttpOnly cookie, server guards, revocation and CSRF controls. Keep only user identity projection in frontend memory.
- **ADR-004 — Video reviews:** Qualified humans review assigned private videos; no pretrained personality model. Only eligible factual claims can enter matching after QA, owner confirmation and sharing permission.
- **ADR-005 — Matching:** Apply reciprocal requirements and explainable scores. Do not claim a computed score predicts love or relationship success.
- **ADR-006 — Scope:** Exclude Premium, payments, subscriptions, concierge services, fake KYC and simulated deepfake verification. Chat and notifications remain P1.
- **ADR-007 — Delivery:** Plan ten working days and 104 proposed micro-tasks; prioritize verified behavior, security, consent and QA over commit count.
