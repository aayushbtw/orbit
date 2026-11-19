#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
plugin=$(cd "${1:-$repo/plugin}" && pwd -P)
parts=4
max_chars=9000
sources=("$plugin/rules.md" "$plugin/rules-shared.md")
failed=0
fail() { echo "FAIL: $*"; failed=1; }
chars() { node -e 'process.stdout.write(String(require("fs").readFileSync(process.argv[1], "utf8").length))' "$1"; }

hook_count=$(node -e 'console.log(require(process.argv[1]).hooks.SessionStart[0].hooks.length)' "$plugin/hooks/hooks.json")
[ "$hook_count" = "$parts" ] || { echo "FAIL: expected $parts SessionStart hooks in $plugin/hooks/hooks.json, found $hook_count"; exit 1; }

cmds=()
for ((i = 0; i < parts; i++)); do
	cmds+=("$(node -e 'process.stdout.write(require(process.argv[1]).hooks.SessionStart[0].hooks[process.argv[2]].command)' "$plugin/hooks/hooks.json" "$i")")
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sizes=()
headings=()
for ((i = 0; i < parts; i++)); do
	out="$tmp/part$i"
	CLAUDE_PLUGIN_ROOT="$plugin" sh -c "${cmds[$i]}" >"$out" || fail "SessionStart hook $((i + 1)) exited non-zero"
	[ -s "$out" ] || fail "SessionStart hook $((i + 1)) printed nothing"
	! grep -qF '<orbit-plugin>' "$out" || fail "SessionStart hook $((i + 1)) left an unexpanded <orbit-plugin>"
	size=$(chars "$out")
	sizes+=("$size")
	[ "$size" -lt "$max_chars" ] || fail "SessionStart hook $((i + 1)) printed $size characters, expected under $max_chars (Claude Code caps hook output at 10,000)"
	if [ "$i" -gt 0 ]; then
		heading=$(head -n 1 "$out")
		headings+=("$heading")
		case "$heading" in '# '*) ;; *) fail "SessionStart hook $((i + 1)) does not start with a top-level heading" ;; esac
		count=$(cat "${sources[@]}" | grep -cxF "$heading" || true)
		[ "$count" = 1 ] || fail "split heading '$heading' occurs $count times in rules.md and rules-shared.md, expected exactly 1"
	fi
done

node -e 'const fs = require("fs"); process.stdout.write(process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8")).join("").replaceAll("<orbit-plugin>", process.argv[1]))' "$plugin" "${sources[@]}" >"$tmp/expected"
cat "$tmp"/part* >"$tmp/all"
cmp -s "$tmp/all" "$tmp/expected" || fail "the SessionStart hooks' output, concatenated, differs from rules.md then rules-shared.md with <orbit-plugin> expanded"
for heading in '# Non-negotiables' '# Delegation' '# Bash' '# Code Quality' '# Files' '# Task End' '# Writing the reply' '# Comments' '# Workflow Defaults'; do
	grep -qxF "$heading" "$tmp/all" || fail "the lead's rules lost the section '$heading'"
done
grep -qF '**One plain command per Bash call.**' "$tmp/all" || fail "the lead's rules lost 'One plain command per Bash call'"

for dir in 'a&b' 'a|b' 'a b'; do
	root="$tmp/$dir/plugin"
	mkdir -p "$tmp/$dir"
	cp -R "$plugin" "$root"
	all=''
	for ((i = 0; i < parts; i++)); do
		out=$(CLAUDE_PLUGIN_ROOT="$root" sh -c "${cmds[$i]}") || fail "SessionStart hook $((i + 1)) exited non-zero under '$dir/plugin'"
		case "$out" in *'<orbit-plugin>'*) fail "SessionStart hook $((i + 1)) left an unexpanded <orbit-plugin> under '$dir/plugin'" ;; esac
		all+="$out"$'\n'
	done
	case "$all" in *"$root/skills/"*) ;; *) fail "SessionStart hooks did not rewrite <orbit-plugin> to '$root' verbatim" ;; esac
done

root="$tmp/unreadable/plugin"
mkdir -p "$tmp/unreadable"
cp -R "$plugin" "$root"
chmod 000 "$root/rules.md" "$root/rules-shared.md"
for ((i = 0; i < parts; i++)); do
	code=0
	out=$(CLAUDE_PLUGIN_ROOT="$root" sh -c "${cmds[$i]}" 2>/dev/null) || code=$?
	[ "$code" = 0 ] || fail "SessionStart hook $((i + 1)) exited $code with unreadable rules files, expected 0"
	printf '%s\n' "$out" | grep -qE '^orbit: could not load .*/rules(-shared)?\.md' || fail "SessionStart hook $((i + 1)) printed no 'orbit: could not load' warning to stdout with unreadable rules files"
done
chmod 644 "$root/rules.md" "$root/rules-shared.md"

root="$tmp/noexec/plugin"
mkdir -p "$tmp/noexec"
cp -R "$plugin" "$root"
chmod -x "$root"/hooks/*.sh
for ((i = 0; i < parts; i++)); do
	out=$(CLAUDE_PLUGIN_ROOT="$root" sh -c "${cmds[$i]}" 2>/dev/null) || fail "SessionStart hook $((i + 1)) exited non-zero with load-rules.sh not executable"
	[ -n "$out" ] || fail "SessionStart hook $((i + 1)) printed nothing with load-rules.sh not executable"
done
trailer_cmd=$(node -e 'process.stdout.write(require(process.argv[1]).hooks.PreToolUse[0].hooks[0].command)' "$plugin/hooks/hooks.json")
code=0
printf '%s' '{"tool_input":{"command":"git commit -m \"x\" -m \"Co-Authored-By: Claude <n@a.com>\""}}' | CLAUDE_PLUGIN_ROOT="$root" sh -c "$trailer_cmd" 2>/dev/null || code=$?
[ "$code" = 2 ] || fail "PreToolUse trailer hook exited $code with no-claude-trailer.sh not executable, expected 2"

[ "$failed" = 0 ] || exit 1
echo "ok: $parts SessionStart hooks print rules.md split at '${headings[0]}' and '${headings[1]}', then rules-shared.md from '${headings[2]}', in ${sizes[*]} characters, keep every section, expand odd plugin paths, warn on unreadable rules files, run without the exec bit"
