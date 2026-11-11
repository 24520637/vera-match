#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then echo 'Usage: bash scripts/new-task-branch.sh huong/feat/name' >&2; exit 2; fi
case "$1" in huong/*|phuc/*) ;; *) echo 'Branch must start with huong/ or phuc/' >&2; exit 2 ;; esac
git switch develop
git pull --ff-only origin develop
git switch -c "$1"
