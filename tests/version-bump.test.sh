#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
command -v jq >/dev/null || { echo "FAIL: needs jq"; exit 1; }

tmp=$(mktemp -d)
tmp=$(cd "$tmp" && pwd -P)
trap 'rm -rf "$tmp"' EXIT

export HOME="$tmp/home" GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
mkdir -p "$HOME"

r="$tmp/repo"
manifest=plugin/manifest.json
legacy_manifest=plugin/.claude-plugin/plugin.json
git init -q "$r"
git -C "$r" symbolic-ref HEAD refs/heads/main
mkdir -p "$r/tests" "$r/plugin"
cp "$repo/tests/version-bump.sh" "$r/tests/version-bump.sh"
printf 'tests/\n' > "$r/.git/info/exclude"

set_version() { printf '{"name":"orbit","version":"%s"}\n' "$1" > "$r/$manifest"; }
log_version() { printf '## %s\n\n' "$1" >> "$r/CHANGELOG.md"; }
commit() { git -C "$r" add -A; git -C "$r" commit -q -m "$1"; }

set_version 0.51.1; log_version 0.51.1
echo a > "$r/plugin/skill.md"
echo readme > "$r/README.md"
commit init

branch() { git -C "$r" checkout -q -b "$1" main; }

branch bump
echo b > "$r/plugin/skill.md"; set_version 0.52.0; log_version 0.52.0; commit bump

branch no-changelog
echo b > "$r/plugin/skill.md"; set_version 0.52.0; commit no-changelog

branch no-bump
echo b > "$r/plugin/skill.md"; commit no-bump

branch downgrade
echo b > "$r/plugin/skill.md"; set_version 0.1.0; commit downgrade

branch docs-only
echo changed > "$r/README.md"; commit docs

branch stale
echo b > "$r/plugin/skill.md"; set_version 0.52.0; commit stale
git -C "$r" checkout -q -b main-advanced main
echo other > "$r/plugin/other.md"; set_version 0.52.0; commit other-pr

git -C "$r" checkout -q --orphan legacy-main
git -C "$r" rm -rqf .
mkdir -p "$r/plugin/.claude-plugin"
printf '{"name":"orbit","version":"0.51.1"}\n' > "$r/$legacy_manifest"; log_version 0.51.1
echo a > "$r/plugin/skill.md"
commit legacy-init

git -C "$r" checkout -q -b migrate legacy-main
git -C "$r" rm -q "$legacy_manifest"
echo b > "$r/plugin/skill.md"; set_version 0.52.0; log_version 0.52.0; commit migrate

git -C "$r" checkout -q -b migrate-no-bump legacy-main
git -C "$r" rm -q "$legacy_manifest"
echo b > "$r/plugin/skill.md"; set_version 0.51.1; commit migrate-no-bump

failed=0
expect() {
	local want=$1 head=$2 base=$3 code=0 out
	git -C "$r" checkout -q "$head"
	out=$(bash "$r/tests/version-bump.sh" "$base" 2>&1) || code=$?
	if [ "$want" = pass ] && [ "$code" != 0 ]; then
		echo "FAIL: $head vs $base should pass, exited $code: $out"; failed=1
	elif [ "$want" = fail ] && [ "$code" = 0 ]; then
		echo "FAIL: $head vs $base should fail, passed: $out"; failed=1
	fi
}

expect pass bump main
expect fail no-changelog main
expect fail no-bump main
expect fail stale main-advanced
expect fail downgrade main
expect pass docs-only main
expect pass migrate legacy-main
expect fail migrate-no-bump legacy-main

[ "$failed" = 0 ] || exit 1
echo "ok: version-bump.sh passes bumps and docs-only branches, fails missing, stale and downgraded versions and a version with no CHANGELOG entry, and reads a legacy base's .claude-plugin manifest"
