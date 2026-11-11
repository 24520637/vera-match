# Switching from the older starter to the English VERA Match starter

The **revised Git bundle contains a new initial commit ID** because the old root commit message was rewritten from an unwanted product label to:

```text
chore: set up the VERA Match project
```

This is a new starter history, not an extra feature commit. The planned 104 task entries remain **unimplemented**.

## Case A — GitHub repository is empty (recommended for first-time setup)

Clone the revised bundle into a **new directory**, then point `origin` to the empty GitHub repository and push `main` and `develop`:

```powershell
cd $HOME\Downloads
git clone -b main .\vera-match-english-branches.bundle vera-match-english
cd .\vera-match-english
git switch develop
git remote set-url origin https://github.com/24520637/vera-match.git
git push -u origin main
git push -u origin develop
```

Do **not** push the placeholder feature or release refs. Leave the old clone untouched until you confirm the new GitHub branches and files.

## Case B — You already pushed the earlier starter to GitHub

**Do not force-push, reset, or delete shared branches.** Rewriting the old root commit's message in-place would change its SHA and could break collaborators' clones. The safe approach is a **new, ordinary update commit** on a branch based on the existing `develop` history:

1. Keep your existing GitHub-based clone. Run `git status` and make sure the worktree is clean; save any real work first.
2. `git switch develop` and `git pull --ff-only origin develop`.
3. Create a branch such as `chore/english-documentation` from this updated `develop`.
4. Extract `vera-match-english-starter.zip` **into a separate temporary folder**. Copy its project files into your existing repository, **excluding all `.git` directories and any `.env` or other local secrets**. Review `git diff` and test changes.
5. Make an ordinary commit with a descriptive message such as `docs: standardize VERA Match project files in English`, push this task branch, and create a PR into `develop`.
6. Merge normally; then follow the team's planned release/update process for `main`.

The old root commit remains in shared history, but every **current file** becomes English. If replacing the old root commit message itself is mandatory on a shared remote, coordinate an explicit history rewrite with all collaborators first; that is **not** the recommended default.

## Important distinction

The Git bundle is an **offline Git repository snapshot**, not a GitHub URL. `origin` initially points to the bundle, and Git status may report an upstream named `origin/develop` even before your project has been pushed to GitHub.
