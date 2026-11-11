#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if ! git remote get-url origin >/dev/null 2>&1; then
  echo 'Run after cloning the .bundle, before replacing origin.' >&2; exit 1
fi
while IFS= read -r ref; do
  case "$ref" in origin|origin/HEAD) continue ;; esac
  branch="${ref#origin/}"
  if [ "$branch" != HEAD ] && ! git show-ref --verify --quiet "refs/heads/$branch"; then
    git branch "$branch" "$ref"
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin)
git switch main
git branch --list
