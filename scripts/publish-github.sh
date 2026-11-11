#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then echo 'Usage: bash scripts/publish-github.sh USERNAME/vera-match' >&2; exit 2; fi
case "$1" in */*) ;; *) echo 'Expected OWNER/REPOSITORY' >&2; exit 2 ;; esac
# Create empty private repository on GitHub FIRST. This script does not create one.
git remote set-url origin "https://github.com/$1.git"
git push -u origin main
git push -u origin develop
printf 'Pushed main & develop. Create feature branches only when their work starts.
'
