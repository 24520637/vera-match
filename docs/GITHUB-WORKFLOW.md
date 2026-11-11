# Git workflow — Huong, Phuc, and v0.1.0 release

## Permanent branches

- `main`: reviewed and released code only.
- `develop`: shared integration branch.
- Cut each new task branch from the **current green `develop`**. Open a PR back to `develop`, get review from the other engineer, and pass CI. Avoid direct commits to `main` or `develop`.

## Reference names in the downloaded Git bundle (16)

```text
main
develop
huong/chore/auth-foundation
huong/feat/email-auth-session
huong/feat/private-video
huong/feat/safety-privacy
huong/feat/auth-recovery-security
huong/test/security-regression
phuc/chore/web-foundation
phuc/feat/profile-consent
phuc/feat/expert-assignment
phuc/feat/expert-review-workspace
phuc/feat/review-approval
phuc/feat/reciprocal-matching
phuc/test/e2e-regression
release/v0.1.0
```

**These feature and release refs are placeholders, not completed work.** They all point to the initial starter commit. Push only `main` and `develop` initially; do not upload placeholder feature/release branches.

## Start a new ticket branch

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c huong/feat/email-auth-session
# Implement, validate, and commit real changes using the plan.
git push -u origin huong/feat/email-auth-session
# Open a PR into develop; request cross-review; merge only with passing checks.
```

If you deliberately restored local placeholder branches, their names may already exist. Do **not** blindly create them again or use stale work; check `git branch -vv`, and recreate unused placeholders from current `develop` only after confirming they contain no unique work.

## Release, Days 9–10

Once `develop` passes the required gates, create a **new** release branch from that integrated commit—not from the bundle placeholder. If a local placeholder `release/v0.1.0` exists and has no unique work, delete it after checking and recreate it from `develop`.

Freeze features, fix release bugs, complete QA, PR into `main`, then tag `v0.1.0` **only after approval**. Back-merge approved release changes into `develop`.

104 planned tasks do not justify creating empty or misleading commits.

## Replacing an earlier downloaded starter

The English Git bundle has a **rewritten initial commit**. If you already pushed the old root commit to GitHub, do not force-push. Follow `docs/GIT-MIGRATION-GUIDE.md` to publish the English files as a normal reviewed update instead.
