#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
plugin=$(cd "${1:-$repo/plugin}" && pwd -P)
heading='# Code Quality'
failed=0
fail() { echo "FAIL: $*"; failed=1; }

hook_count=$(node -e 'console.log(require(process.argv[1]).hooks.SessionStart[0].hooks.length)' "$plugin/hooks/hooks.json")
[ "$hook_count" = 2 ] || { echo "FAIL: expected 2 SessionStart hooks in $plugin/hooks/hooks.json, found $hook_count"; exit 1; }

heading_count=$(grep -cxF "$heading" "$plugin/rules.md" || true)
[ "$heading_count" = 1 ] || fail "heading '$heading' occurs $heading_count times in $plugin/rules.md, expected exactly 1"

outputs=()
for i in 0 1; do
	cmd=$(node -e 'process.stdout.write(require(process.argv[1]).hooks.SessionStart[0].hooks[process.argv[2]].command)' "$plugin/hooks/hooks.json" "$i")
	out=$(CLAUDE_PLUGIN_ROOT="$plugin" sh -c "$cmd") || fail "SessionStart hook $((i + 1)) exited non-zero"
	[ -n "$out" ] || fail "SessionStart hook $((i + 1)) printed nothing"
	case "$out" in *'<orbit-plugin>'*) fail "SessionStart hook $((i + 1)) left an unexpanded <orbit-plugin>" ;; esac
	outputs+=("$out")
done

[ "${outputs[1]%%$'\n'*}" = "$heading" ] || fail "SessionStart hook 2 does not start with '$heading'"

[ "$failed" = 0 ] || exit 1
echo "ok: 2 SessionStart hooks split rules.md at '$heading'"
