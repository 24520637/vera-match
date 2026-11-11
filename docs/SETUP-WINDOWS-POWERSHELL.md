# First-time setup — Windows PowerShell

This walkthrough applies to the **revised English VERA Match Git bundle**. You already have an older clone? Read `docs/GIT-MIGRATION-GUIDE.md` before replacing or pushing anything.

## 1. Prerequisites

Install Git for Windows, Node.js 24, npm, Docker Desktop, and VS Code. Start Docker Desktop. In PowerShell:

```powershell
git --version
node --version
npm --version
docker --version
docker compose version
```

## 2. Download and clone

Put `vera-match-english-branches.bundle` in your Downloads folder. Do not put a backslash between command arguments. In **PowerShell**:

```powershell
Set-Location $HOME\Downloads
Get-ChildItem *.bundle
# Choose a new folder name if an older vera-match folder already exists.
git clone -b main .\vera-match-english-branches.bundle vera-match-english
cd .\vera-match-english
git switch develop
git remote set-head origin main
git status
```

Expected result: `On branch develop` and `nothing to commit, working tree clean`.

## 3. Read the starter

Open VS Code from the project directory with `code .` or File → Open Folder. Read `README.md`, `AGENTS.md`, `CODEX_CONTEXT.md`, `docs/PLAN-2-WEEKS.md`, `docs/AUTH-SPEC.md`, and `docs/EXPERT-REVIEW-WORKFLOW.md`.

## 4. Connect an **empty, Private** GitHub repository

If your GitHub repo `https://github.com/24520637/vera-match` is empty and no old commit has been pushed, run:

```powershell
git remote set-url origin https://github.com/24520637/vera-match.git
git remote -v
git push -u origin main
git push -u origin develop
```

The clone's initial `origin` points to the bundle file, **not** GitHub. If GitHub already contains the old starter, **stop and use `docs/GIT-MIGRATION-GUIDE.md`**. Never use `--force` just to replace a starter.

GitHub repo visibility should be **Private**. In GitHub: Settings → General → Danger Zone → Change repository visibility.

## 5. Configure local services

```powershell
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
notepad .env
notepad apps/api/.env
```

Use local-only credentials. `POSTGRES_PASSWORD` and the password in both `DATABASE_URL` values must match. If PostgreSQL was previously initialized with a different password, changing `.env` alone will not change the existing DB password.

```powershell
docker compose --env-file .env -f infra/docker-compose.yml up -d
docker compose --env-file .env -f infra/docker-compose.yml ps
```

- Mailpit mailbox: http://localhost:8025
- MinIO Console: http://localhost:9001. Create `vera-private` as a **private** bucket.
- PostgreSQL: localhost:5432

## 6. Install and validate

```powershell
npm install
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate
```

**Important:** the schema is a draft and these steps have not been independently validated end-to-end. If a command fails, inspect the actual error and fix the setup/schema before proceeding. Do not report PASS without a successful run.

## 7. Start web and API

From two separate PowerShell terminals, in the project root:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Visit API http://localhost:4000/api/health and web http://localhost:3000. A functioning landing page and health endpoint only confirm that the scaffold starts; register/login/expert matching are still to be built.

## 8. Start the first tickets

Huong owns T01; Phuc owns T02. On independent clones/worktrees, from up-to-date `develop`:

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c huong/chore/auth-foundation
```

Or on Phuc's machine:

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c phuc/chore/web-foundation
```

Give Codex one task at a time: Huong C001, Phuc C007. Use `docs/CODEX-PROMPTS.md` and the exact entry in `docs/COMMIT-PLAN.md`. Review changes and test evidence before committing. Push feature branches only when work exists, open a PR into `develop`, and request review by the other developer.

## 9. Common failures

- **"You must specify a repository to clone"**: Missing spaces. Use the one-line `git clone -b main .\file.bundle folder` form.
- **"Repository does not exist"**: Verify `Get-ChildItem *.bundle` and your current directory.
- **"Destination path already exists"**: Clone into `vera-match-english` rather than deleting the existing work.
- **"Non-fast-forward" when pushing**: GitHub already has history. Stop; follow the migration guide. Never solve this blindly with `--force`.
- **"Branch already exists"**: A placeholder or an actual feature branch may already be present. Inspect `git branch -a` before creating another.
- **Prisma/Docker errors**: Compare `.env`, PostgreSQL volume credentials, Docker status, and migration logs. Do not remove volumes containing important data.
