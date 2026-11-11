# Architecture — VERA Match modular monolith

```text
Next.js: member / expert reviewer / moderator screens
            |
            | Credentialed HTTPS requests and HttpOnly session cookie
            v
          NestJS API
          | Session AuthN + CSRF
          | Role / ownership / expert assignment / consent AuthZ
          +-------- PostgreSQL (Prisma)
          +-------- Private S3-compatible storage (MinIO locally)
          +-------- SMTP (Mailpit locally)

No pretrained AI inference service. No payment service.
```

## Why this architecture

A modular monolith reduces deployment and coordination overhead for two full-stack engineers. Domain modules: Auth, Profile/Questionnaire/Consent, Private Media, Expert Assignment, Expert Review and QA, Matching, Trust/Safety/Audit. Web and API are independent npm workspaces sharing explicit API contracts; PostgreSQL is the transactional system of record.

## Trust boundaries

- The browser is **not** a security boundary. The API decides who may read or change data.
- An expert receives access only to a specific, currently assigned video while the owner's consent remains active; short-lived playback URLs must be scoped to that authorization.
- Independent moderation QA approves or returns reviews. A reviewer cannot approve their own work. An owner sees only a QA-approved report about their account.
- Matching consumes current member preferences and eligible factual claims, never raw video, raw notes, biometric indicators, or unapproved subjective impressions.

## Tradeoffs

PostgreSQL for transactional state and MinIO for private media are adequate for the MVP. Mailpit intercepts messages only during development. Redis, an external task queue, vector search, microservices, and Python inference add complexity without a confirmed MVP need.

Human-written reviews are **contextual assessments**, not scientific measurements or ground truth about a person's enduring personality.
