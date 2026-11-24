# VERA Match

An adult matchmaking platform based on member profiles, questionnaires, reciprocal preferences, and consent-controlled expert review of private videos.

**Current implementation:** Email registration and activation, password recovery, member profiles and consent, private video, assignment-scoped expert review, independent QA, owner-controlled claims, reciprocal matching and member safety. The shared design-system preview is at `/design-system`. The joined demo uses synthetic adults and recordings in an isolated test environment. [Demo runbook](docs/T20-DEMO-RUNBOOK.md) · [Release limitations](docs/RELEASE-NOTES-v0.1.0.md)

The browser uses same-origin `/api` via the Next.js proxy. Configure server-only `API_INTERNAL_ORIGIN` (default `http://localhost:4000`) consistently at web build and runtime; SSR uses the same validated origin with explicit cookie forwarding.

## Stack

- Next.js 15, React 19, TypeScript (`apps/web`)
- NestJS 10 (`apps/api`)
- PostgreSQL 18 and Prisma 6 (`apps/api/prisma`)
- Private S3-compatible media storage; MinIO and Mailpit for local development

## Run the internal demo

Start with the [T20 demo runbook](docs/T20-DEMO-RUNBOOK.md). It walks through a clean checkout, builds, dedicated PostgreSQL migrations, Mailpit, MinIO, FFmpeg and Chromium, and explains how to verify cleanup on Windows. From the repository root, after fixture setup:

```powershell
node scripts/run-video-e2e.cjs --grep "T18 demo"
```

The filter matches the existing joined test title and runs both Chromium projects. See the [C102 verification record](docs/T20-C102-RESULTS.md) for the two observed runs.

## Local development setup

Install Git, Node.js 24 (see `.nvmrc`), npm, and native PostgreSQL 18 listening on `localhost:5433`. T01 uses no Docker. In PowerShell:

```powershell
git clone https://github.com/24520637/vera-match.git
cd vera-match
git switch develop
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
```

Update the example credentials in both environment files, keeping `POSTGRES_PASSWORD` and `DATABASE_URL` consistent. Then run:

```powershell
npm ci
npm run prisma:validate
npm run prisma:generate
npm exec prisma -- migrate status --schema apps/api/prisma/schema.prisma
```

For an existing configured database, keep its applied migration history. Only for a new empty database, apply the committed migration with `npm exec prisma -- migrate deploy --schema apps/api/prisma/schema.prisma`; do not regenerate the initial migration. Start each service in a separate terminal at the repository root:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

| Service                                | Local address                          |
| -------------------------------------- | -------------------------------------- |
| Web                                    | http://localhost:3000                  |
| API process health (no database probe) | http://localhost:4000/api/health       |
| Database readiness                     | http://localhost:4000/api/health/ready |
| Mailpit                                | http://localhost:8025                  |
| MinIO console                          | http://localhost:9001                  |

Run Mailpit for registration, email activation and integration/browser auth tests. For regular local video development, configure a private MinIO bucket using [the storage setup instructions](docs/PRIVATE-VIDEO.md#local-native-storage). The T20 runner creates and cleans up its own fixture bucket. Use synthetic test data locally.

## Development workflow

### Same-origin API client

Browser code imports `apiFetch`, `apiJson`, and `ApiError` from
`@/lib/api`. Pass paths such as `/health`; the client requests `/api/health`
through the Next.js rewrite. `apiFetch` returns a raw `Response` and
`apiJson<T>` returns parsed JSON or `undefined` for an empty response. The
generic type describes an expected contract, not runtime schema validation.

Set the server-only `API_INTERNAL_ORIGIN` in the web process environment before
building (default `http://localhost:4000`). The value must be an HTTP(S) origin
without credentials or a path. Root `.env` files are not automatically loaded
by the web workspace; export this variable or use its local default. Next.js
records rewrites at build time, so rebuild when changing the destination.
`NEXT_PUBLIC_API_BASE_URL` is no longer used.

Run `npm run build` before the shared Playwright suite. It starts Next.js on
port 3100 and the isolated C010 fixture on port 3101, without starting the API.
Set `CI=1` when running `npm run test:ui --workspace apps/web` to test the built
web app without reusing existing servers; the C010 fixture still uses its
isolated development server. These presentation/transport checks need no DB.

Run `npm run test:auth --workspace apps/web` separately for real authentication,
protected SSR and the same-origin health proxy. Its runner rebuilds the web app
for the API on port 4100, starts an isolated test-schema API with `NODE_ENV=test`,
and waits for `/api/health/ready`. Supply a local PostgreSQL 18 `DATABASE_URL`
on port 5433 and a running Mailpit SMTP/API service; the runner cleans up only
its generated test schema and synthetic mail. See the auth runbook before use.

### C011 CI validation

PRs into `develop` or `main` run `npm ci`, Prisma validation/generation, Jest
unit tests, and API/web builds. CI then starts native PostgreSQL 18 on port
5433 and Mailpit, applies existing migrations to a disposable database, runs API
integration tests, and runs shared UI plus real-auth Playwright suites with
synthetic test configuration. Reports
are uploaded and PostgreSQL cleanup runs even after a failure. Docker is not a
local prerequisite.

`npm test` runs API unit tests; it does not run database integration or browser
tests. Run `npm run test:integration --workspace apps/api` separately against
configured local PostgreSQL 18 on port 5433, and run
`npm run test:ui --workspace apps/web` separately for transport, UI, accessibility,
and C010 presentation checks. The separate `test:auth` script runs real browser
authentication and proxy checks. See [validation criteria](docs/TEST-PLAN.md).
On Windows with restricted PowerShell script execution, use `npm.cmd`.

`develop` is the integration branch; `main` contains reviewed releases. Start one task at a time from current `develop`, using your own branch prefix:

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c huong/chore/cleanup-docs
```

Use `huong/feat/<task>`, `huong/fix/<task>`, or `huong/chore/<task>` for Huong; Phuc uses `phuc/...`. Open PRs into `develop`, request review from the other developer, and pass relevant checks. Commit and push only when explicitly requested.

Huong owns authentication, sessions, private video, safety, and privacy. Phuc owns web foundation, profiles and consent, expert assignment/review/QA, and matching. Both deliver UI, API, database changes, and tests for their features. See [feature ownership](docs/FEATURE-OWNERSHIP.md) and [backlog](docs/BACKLOG.md).

## Essential documentation

| Document                                             | Purpose                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| [Scope](docs/SCOPE-DECISIONS.md)                     | Required features and exclusions                                           |
| [Architecture](docs/ARCHITECTURE.md)                 | Components and trust boundaries                                            |
| [UI design system](docs/UI-DESIGN-SYSTEM.md)         | Shared tokens, components, interaction patterns, and Huong’s design review |
| [API contract](docs/API-CONTRACT.md)                 | Existing auth DTOs/responses and planned business endpoints                 |
| [MVP Profile/Consent contract](docs/PROFILE-CONSENT-CONTRACT.md) | C012 technically approved by Huong at b25e4d6; agreed MVP catalogs/prompts, revisions, legacy/audit and 60-second URL contract; real-user retention, storage/backup and provider enforcement remain PRE-PRODUCTION gates |
| [Authentication](docs/AUTH-SPEC.md)                  | Sessions, account states, CSRF, and authorization                          |
| [Authentication foundation](docs/AUTH-FOUNDATION.md) | Implemented T01 contracts, native setup, test evidence and review handoff  |
| [Database](docs/DATABASE.md)                         | Models and data invariants                                                 |
| [Expert review](docs/EXPERT-REVIEW-WORKFLOW.md)      | Assignment, observations, independent QA, and owner controls               |
| [Matching](docs/MATCHING-DESIGN.md)                  | Reciprocal rules and permitted factual claims                              |
| [Test plan](docs/TEST-PLAN.md)                       | Acceptance scenarios and release gates                                     |
| [Deployment](docs/DEPLOYMENT.md)                     | Local operations and production prerequisites                              |

## Quality and product rules

A feature is done only when its UI → API → database flow works, server authorization is enforced, relevant tests pass, and loading/empty/error/success states and accessible controls are present. Schema changes require a reviewed migration. Report checks as `PASS`, `FAIL`, or `NOT RUN`; documentation alone is not implementation evidence.

Validate cookie sessions on the server, protect state-changing requests against CSRF, enforce rate limits, and never store session tokens in browser storage. Distinguish invalid sessions (`401`) from denied access (`403`) and network/server failures. Experts may access only currently assigned videos with valid consent; QA reviewers cannot approve their own assessments.

Only QA-approved, owner-confirmed, explicitly share-approved, unrevoked factual claims covered by current matching consent may affect matching. Human observations are contextual assessments. Automated personality inference, fake identity/deepfake verification, paid tiers, checkout, subscriptions, and concierge services are excluded.

Never commit credentials, tokens, production personal data, or private user videos. Incomplete privacy, security, QA, or end-to-end acceptance means internal demonstration only.

C012 technical approval covers reviewed commit
`b25e4d6d93823f560ae3fc8be443313902097abd`, not production policy approval,
implementation of C019-C024, or a claim that Draft PR #8 is merged. C019 will
choose concrete schema/migration design, reusing existing migrations and never
recreating the initial migration. See the contract's PRE-PRODUCTION register
for remaining real-user policy approvals and provider verification.

## API documentation and release preparation

See [staging and deployment preparation](docs/RELEASE-PREPARATION.md) for the Swagger contract (71 operations across 63 paths), hosting templates, configuration and release checks. Local docs use `/api/docs` (JSON `/api/docs-json`, YAML `/api/docs-yaml`). Production Swagger defaults to disabled. Set `API_DOCS_MODE=public` to serve read-only Swagger in production mode. Public documentation does not grant API access.

No public domain, live website or API base URL is provisioned by this repository change. After hosting and DNS/TLS are configured, the intended paths are `https://YOUR_DOMAIN/`, `https://YOUR_DOMAIN/api` and `https://YOUR_DOMAIN/api/docs`. These are placeholders, not verified live URLs.
