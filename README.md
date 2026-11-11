# VERA Match

**Starter repository for the VERA Match matchmaking platform**  
**Team:** Huong and Phuc · **Plan:** 10 working days / 2 weeks · **Release target:** `v0.1.0`

> **Starter status, not a finished product.** This repository currently contains a Next.js landing page, a NestJS health endpoint, a draft Prisma schema, local infrastructure, CI configuration, and implementation specifications. Registration, email activation, secure login, video review, and matchmaking are **planned features—not working functionality**. Do not use real personal information or private videos until the relevant security and privacy controls have been implemented and verified.

## What VERA Match does

VERA Match helps adults discover mutually compatible connections using self-declared profiles, questionnaires, preferences, and consent-controlled information from privately submitted videos. Qualified **human reviewers** may review videos using an assigned-workflow interface; the system does **not** run a pretrained personality-inference model. Reviewer observations are contextual judgments, not objective personality diagnoses.

### In scope (P0)

| Area | Required functionality |
| --- | --- |
| Authentication | Register, verify email, resend activation, login, HttpOnly cookie, database-backed sessions, restore login after refresh, `GET /auth/me`, logout/logout-all, password recovery, account states, route protection, and AuthN/AuthZ guards |
| Profiles and consent | Editable profile, versioned questionnaire, reciprocal preferences, independently revocable purposes, privacy defaults |
| Private video | Capture/upload, private object storage, owner playback, access-controlled reviewer playback, deletion, and consent withdrawal |
| Reviewer operations | Staff eligibility, moderator assignment, assigned review queue, timestamped observations, draft autosave, submission, separate QA approval, owner report, feedback/dispute |
| Matching | Reciprocal hard constraints, explainable ranking based on user inputs and allowed confirmed factual claims, accept/decline, block exclusions |
| Trust and safety | User reports, moderation scope, audit trails, account deactivation, ownership and assignment authorization, security regression tests |

**Out of scope:** automated/pretrained AI personality scoring, facial identification, fake identity verification, fake deepfake detection, Premium/subscription/payment/concierge features. **P1 only if P0 is complete:** post-match chat, notifications, avatars, and advanced export.

## Technology

- **Web:** Next.js 15, React 19, TypeScript — `apps/web`
- **API:** NestJS 10, TypeScript — `apps/api`
- **Database:** PostgreSQL 16, Prisma 6 draft data model — `apps/api/prisma/schema.prisma`
- **Media:** MinIO (local) or private S3-compatible object storage
- **Development email:** Mailpit (SMTP capture)
- **CI:** GitHub Actions for web/API validation, tests, and builds

These versions reflect the **actual starter package manifests**, not future upgrade targets. No Python inference service is included.

## Quick start — Windows PowerShell

Prerequisites: Git, **Node.js 24** (see `.nvmrc`), npm, and Docker Desktop running. Open PowerShell in the folder containing the downloaded `.bundle` file:

```powershell
# Use this ONE-LINE command in PowerShell. Do not insert backslashes between arguments.
git clone -b main .\vera-match-english-branches.bundle vera-match
cd .\vera-match
git switch develop
# The bundle contains placeholder branches; set the local origin HEAD display to main.
git remote set-head origin main

git status
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
# Edit both .env files. Synchronize POSTGRES_PASSWORD and DATABASE_URL.
# These example values are only for an isolated local machine.

docker compose --env-file .env -f infra/docker-compose.yml up -d
npm install
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate
```

Run the services in **separate PowerShell windows**, each in the project root:

```powershell
npm run dev:api  # API: http://localhost:4000/api/health
```

```powershell
npm run dev:web  # Web: http://localhost:3000
```

Mailpit: `http://localhost:8025`. MinIO Console: `http://localhost:9001`. Create the `vera-private` bucket with **private** access before implementing uploads. The API health endpoint currently checks the API process, **not** PostgreSQL availability.

**Important:** Prisma schema validation, migrations, and a full Node.js build have not been verified end-to-end in this distributed starter. Treat errors as setup or development tasks. See [`docs/SETUP-WINDOWS-POWERSHELL.md`](docs/SETUP-WINDOWS-POWERSHELL.md) for a precise walkthrough and GitHub instructions.

## Branches and GitHub

- Permanent branches: `main` (releases) and `develop` (integration).
- Feature branches: `huong/...` and `phuc/...`; create them from up-to-date `develop` when a ticket starts.
- Release branch: `release/v0.1.0`, **created from tested `develop` on release day**, never from the bundle placeholder.
- The bundle includes 16 reference names, but feature and release refs are placeholders pointing to the starter commit—not completed work. Do not push placeholder branches to GitHub.
- Each PR targets `develop`, is reviewed by the other developer, and must pass the required tests. No fabricated commits.

**Initial Git commit message in the revised bundle:** `chore: set up the VERA Match project`.

### Connect to GitHub

This repository is connected to **the bundle file** immediately after cloning, not to GitHub. Create an empty GitHub repo first; make it **Private**, especially because the product will handle sensitive personal information. Then run:

```powershell
git remote set-url origin https://github.com/24520637/vera-match.git
git push -u origin main
git push -u origin develop
```

**Do not run the push commands against a GitHub repository that already has the old starter commit.** A replaced initial commit creates a different history; see `docs/GIT-MIGRATION-GUIDE.md` to update an existing repo **without force-pushing**. If the GitHub repository is empty, these commands work normally after authentication.

## The two-person plan

- **Huong:** registration and email verification; login/session recovery and security; private video storage and permissions; safety, privacy, and security tests.
- **Phuc:** web framework and CI; profile/questionnaire/consent; reviewer assignment; review workspace, QA, owner confirmation, and matching; E2E tests.
- Both developers own **UI + API + database + tests** for their features and review each other's changes.
- Planning documents include **20 tickets and 104 *proposed* micro-tasks** (`C001`–`C104`): 52 Huong / 52 Phuc, not 104 pre-written commits.
- The CSV uses **November 2–13, 2026 as the original sample schedule**. These dates are already historical; map D1–D10 to the team's actual agreed start date rather than using them as upcoming deadlines.

## Read the docs in this order

1. [`AGENTS.md`](AGENTS.md) and [`CODEX_CONTEXT.md`](CODEX_CONTEXT.md) — working rules for developers and Codex.
2. [`docs/PLAN-2-WEEKS.md`](docs/PLAN-2-WEEKS.md) and [`docs/FEATURE-OWNERSHIP.md`](docs/FEATURE-OWNERSHIP.md) — work assignments.
3. [`docs/BACKLOG.md`](docs/BACKLOG.md), [`docs/COMMIT-PLAN.md`](docs/COMMIT-PLAN.md), and [`docs/COMMIT-PLAN.csv`](docs/COMMIT-PLAN.csv) — tickets, steps, expected checks.
4. [`docs/AUTH-SPEC.md`](docs/AUTH-SPEC.md) — authentication/session/security design.
5. [`docs/EXPERT-REVIEW-WORKFLOW.md`](docs/EXPERT-REVIEW-WORKFLOW.md) — reviewer assignment, evidence, QA, and owner controls.
6. [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md), [`docs/DATABASE.md`](docs/DATABASE.md), and [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md) — integration and acceptance.

## Working agreement and quality bar

A ticket is done only when the code works through the relevant user interface, API, database, and tests; ownership/role/assignment/consent checks are enforced on the server; the interface handles loading, empty, error, and success states; and the test results are reported accurately as `PASS`, `FAIL`, or `NOT RUN`.

Human review must be performed by eligible staff and approved independently by QA. Only **QA-approved, owner-confirmed, explicitly shared, and unrevoked factual claims** may affect matching. A reviewer's subjective impressions, facial behavior, or unvalidated personality labels do **not** directly increase or decrease match scores.

**Release rule:** If privacy, session security, authorization, review QA, or end-to-end acceptance is incomplete, label the result an internal demonstration—not a production release. Two developers and ten working days do not guarantee production readiness.
