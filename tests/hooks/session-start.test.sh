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

cmds=()
for i in 0 1; do
	cmds+=("$(node -e 'process.stdout.write(require(process.argv[1]).hooks.SessionStart[0].hooks[process.argv[2]].command)' "$plugin/hooks/hooks.json" "$i")")
done

outputs=()
for i in 0 1; do
	out=$(CLAUDE_PLUGIN_ROOT="$plugin" sh -c "${cmds[$i]}") || fail "SessionStart hook $((i + 1)) exited non-zero"
	[ -n "$out" ] || fail "SessionStart hook $((i + 1)) printed nothing"
	case "$out" in *'<orbit-plugin>'*) fail "SessionStart hook $((i + 1)) left an unexpanded <orbit-plugin>" ;; esac
	outputs+=("$out")
done

[ "${outputs[1]%%$'\n'*}" = "$heading" ] || fail "SessionStart hook 2 does not start with '$heading'"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for dir in 'a&b' 'a|b' 'a b'; do
	root="$tmp/$dir/plugin"
	mkdir -p "$tmp/$dir"
	cp -R "$plugin" "$root"
	all=''
	for i in 0 1; do
		out=$(CLAUDE_PLUGIN_ROOT="$root" sh -c "${cmds[$i]}") || fail "SessionStart hook $((i + 1)) exited non-zero under '$dir/plugin'"
		case "$out" in *'<orbit-plugin>'*) fail "SessionStart hook $((i + 1)) left an unexpanded <orbit-plugin> under '$dir/plugin'" ;; esac
		all+="$out"$'\n'
	done
	case "$all" in *"$root/skills/"*) ;; *) fail "SessionStart hooks did not rewrite <orbit-plugin> to '$root' verbatim" ;; esac
done

root="$tmp/unreadable/plugin"
mkdir -p "$tmp/unreadable"
cp -R "$plugin" "$root"
chmod 000 "$root/rules.md"
for i in 0 1; do
	code=0
	out=$(CLAUDE_PLUGIN_ROOT="$root" sh -c "${cmds[$i]}" 2>/dev/null) || code=$?
	[ "$code" = 0 ] || fail "SessionStart hook $((i + 1)) exited $code with an unreadable rules.md, expected 0"
	printf '%s\n' "$out" | grep -F 'orbit: ' | grep -qF 'rules.md' || fail "SessionStart hook $((i + 1)) printed no 'orbit: ... rules.md' warning to stdout with an unreadable rules.md"
done
chmod 644 "$root/rules.md"

root="$tmp/noexec/plugin"
mkdir -p "$tmp/noexec"
cp -R "$plugin" "$root"
chmod -x "$root"/hooks/*.sh
for i in 0 1; do
	out=$(CLAUDE_PLUGIN_ROOT="$root" sh -c "${cmds[$i]}" 2>/dev/null) || fail "SessionStart hook $((i + 1)) exited non-zero with load-rules.sh not executable"
	[ -n "$out" ] || fail "SessionStart hook $((i + 1)) printed nothing with load-rules.sh not executable"
done
trailer_cmd=$(node -e 'process.stdout.write(require(process.argv[1]).hooks.PreToolUse[0].hooks[0].command)' "$plugin/hooks/hooks.json")
code=0
printf '%s' '{"tool_input":{"command":"git commit -m \"x\" -m \"Co-Authored-By: Claude <n@a.com>\""}}' | CLAUDE_PLUGIN_ROOT="$root" sh -c "$trailer_cmd" 2>/dev/null || code=$?
[ "$code" = 2 ] || fail "PreToolUse trailer hook exited $code with no-claude-trailer.sh not executable, expected 2"

[ "$failed" = 0 ] || exit 1
echo "ok: 2 SessionStart hooks split rules.md at '$heading', expand odd plugin paths, warn on unreadable rules.md, run without the exec bit"
