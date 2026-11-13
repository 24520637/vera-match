# VERA Match

An adult matchmaking platform based on member profiles, questionnaires, reciprocal preferences, and consent-controlled expert review of private videos.

**Current implementation:** Next.js landing page and shared UI design-system preview at `/design-system`, NestJS health endpoint, Prisma schema and initial migration, local infrastructure, and CI configuration. The preview uses page-local examples. Authentication, private video review, and matching remain planned. A checked-in migration does not establish that it has been applied or verified.

## Stack

- Next.js 15, React 19, TypeScript (`apps/web`)
- NestJS 10 (`apps/api`)
- PostgreSQL 16 and Prisma 6 (`apps/api/prisma`)
- Private S3-compatible media storage; MinIO and Mailpit for local development

## Local setup

Install Git, Node.js 24 (see `.nvmrc`), npm, and Docker Desktop. In PowerShell:

```powershell
git clone https://github.com/24520637/vera-match.git
cd vera-match
git switch develop
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
```

Update the example credentials in both environment files, keeping `POSTGRES_PASSWORD` and `DATABASE_URL` consistent. Then run:

```powershell
docker compose --env-file .env -f infra/docker-compose.yml up -d
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate
```

Start each service in a separate terminal at the repository root:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

| Service | Local address |
| --- | --- |
| Web | http://localhost:3000 |
| API process health (no database probe) | http://localhost:4000/api/health |
| Mailpit | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

Create a private `vera-private` bucket in MinIO before implementing uploads. Full setup, migration, and application flows still require verification; use synthetic test data until security and privacy controls work.

## Development workflow

`develop` is the integration branch; `main` contains reviewed releases. Start one task at a time from current `develop`, using your own branch prefix:

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c huong/chore/cleanup-docs
```

Use `huong/feat/<task>`, `huong/fix/<task>`, or `huong/chore/<task>` for Huong; Phuc uses `phuc/...`. Open PRs into `develop`, request review from the other developer, and pass relevant checks. Commit and push only when explicitly requested.

Huong owns authentication, sessions, private video, safety, and privacy. Phuc owns web foundation, profiles and consent, expert assignment/review/QA, and matching. Both deliver UI, API, database changes, and tests for their features. See [feature ownership](docs/FEATURE-OWNERSHIP.md) and [backlog](docs/BACKLOG.md).

## Essential documentation

| Document | Purpose |
| --- | --- |
| [Scope](docs/SCOPE-DECISIONS.md) | Required features and exclusions |
| [Architecture](docs/ARCHITECTURE.md) | Components and trust boundaries |
| [UI design system](docs/UI-DESIGN-SYSTEM.md) | Shared tokens, components, interaction patterns, and Huong’s design review |
| [API contract](docs/API-CONTRACT.md) | Planned endpoints and access rules |
| [Authentication](docs/AUTH-SPEC.md) | Sessions, account states, CSRF, and authorization |
| [Database](docs/DATABASE.md) | Models and data invariants |
| [Expert review](docs/EXPERT-REVIEW-WORKFLOW.md) | Assignment, observations, independent QA, and owner controls |
| [Matching](docs/MATCHING-DESIGN.md) | Reciprocal rules and permitted factual claims |
| [Test plan](docs/TEST-PLAN.md) | Acceptance scenarios and release gates |
| [Deployment](docs/DEPLOYMENT.md) | Local operations and production prerequisites |

## Quality and product rules

A feature is done only when its UI → API → database flow works, server authorization is enforced, relevant tests pass, and loading/empty/error/success states and accessible controls are present. Schema changes require a reviewed migration. Report checks as `PASS`, `FAIL`, or `NOT RUN`; documentation alone is not implementation evidence.

Validate cookie sessions on the server, protect state-changing requests against CSRF, enforce rate limits, and never store session tokens in browser storage. Distinguish invalid sessions (`401`) from denied access (`403`) and network/server failures. Experts may access only currently assigned videos with valid consent; QA reviewers cannot approve their own assessments.

Only QA-approved, owner-confirmed, explicitly share-approved, unrevoked factual claims covered by current matching consent may affect matching. Human observations are contextual assessments. Automated personality inference, fake identity/deepfake verification, paid tiers, checkout, subscriptions, and concierge services are excluded.

Never commit credentials, tokens, production personal data, or private user videos. Incomplete privacy, security, QA, or end-to-end acceptance means internal demonstration only.
