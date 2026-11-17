#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
audit="$repo/plugin/skills/worktree-cleanup/scripts/worktree-audit.sh"
for tool in rg jq; do
	command -v "$tool" >/dev/null || { echo "FAIL: needs $tool"; exit 1; }
done

tmp=$(mktemp -d)
tmp=$(cd "$tmp" && pwd -P)
trap 'rm -rf "$tmp"' EXIT

export HOME="$tmp/home" GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
mkdir -p "$HOME" "$tmp/bin"
printf '#!/bin/sh\nexit 1\n' > "$tmp/bin/gh"
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH"

git init -q --bare "$tmp/origin.git"
git init -q "$tmp/clone"
git -C "$tmp/clone" symbolic-ref HEAD refs/heads/main
git -C "$tmp/clone" commit -q --allow-empty -m init
git -C "$tmp/clone" remote add origin "$tmp/origin.git"
git -C "$tmp/clone" push -q origin main
wt="$tmp/wt-feature"
git -C "$tmp/clone" worktree add -q -b feature "$wt"

slug=$(printf '%s' "$wt" | sed 's/[^A-Za-z0-9]/-/g')
mkdir -p "$HOME/.claude/projects/$slug"
printf '{}\n' > "$HOME/.claude/projects/$slug/s.jsonl"

code=0
out=$(bash "$audit" -b origin/main "$tmp/clone" 2>"$tmp/stderr") || code=$?
header=$(printf 'SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE')
last=$(printf '%s\n' "$out" | awk -F'\t' -v w="$wt" '$9 == w {print $7}')

failed=0
fail() { echo "FAIL: $*"; failed=1; }
[ "$code" = 0 ] || fail "worktree-audit.sh exited $code"
printf '%s\n' "$out" | grep -qxF "$header" || fail "worktree-audit.sh printed no header row"
if [ -z "$last" ]; then fail "worktree-audit.sh printed no row for $wt"
elif ! printf '%s' "$last" | grep -Eqx '[0-9]{4}-[0-9]{2}-[0-9]{2}'; then fail "LAST_CHAT for $wt is '$last', expected YYYY-MM-DD"
fi

if [ "$failed" = 1 ]; then
	echo "--- stdout"; printf '%s\n' "$out"
	echo "--- stderr"; cat "$tmp/stderr"
	exit 1
fi
echo "ok: worktree-audit.sh dated the extra worktree's last chat $last"
