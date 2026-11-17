#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
plugin=$(cd "${1:-$repo/plugin}" && pwd -P)
parts=3
max_chars=9000
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
		count=$(grep -cxF "$heading" "$plugin/rules.md" || true)
		[ "$count" = 1 ] || fail "split heading '$heading' occurs $count times in $plugin/rules.md, expected exactly 1"
	fi
done

node -e 'const fs = require("fs"); process.stdout.write(fs.readFileSync(process.argv[1], "utf8").replaceAll("<orbit-plugin>", process.argv[2]))' "$plugin/rules.md" "$plugin" >"$tmp/expected"
cat "$tmp"/part* | cmp -s - "$tmp/expected" || fail "the SessionStart hooks' output, concatenated, differs from rules.md with <orbit-plugin> expanded"

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
chmod 000 "$root/rules.md"
for ((i = 0; i < parts; i++)); do
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
for ((i = 0; i < parts; i++)); do
	out=$(CLAUDE_PLUGIN_ROOT="$root" sh -c "${cmds[$i]}" 2>/dev/null) || fail "SessionStart hook $((i + 1)) exited non-zero with load-rules.sh not executable"
	[ -n "$out" ] || fail "SessionStart hook $((i + 1)) printed nothing with load-rules.sh not executable"
done
trailer_cmd=$(node -e 'process.stdout.write(require(process.argv[1]).hooks.PreToolUse[0].hooks[0].command)' "$plugin/hooks/hooks.json")
code=0
printf '%s' '{"tool_input":{"command":"git commit -m \"x\" -m \"Co-Authored-By: Claude <n@a.com>\""}}' | CLAUDE_PLUGIN_ROOT="$root" sh -c "$trailer_cmd" 2>/dev/null || code=$?
[ "$code" = 2 ] || fail "PreToolUse trailer hook exited $code with no-claude-trailer.sh not executable, expected 2"

[ "$failed" = 0 ] || exit 1
echo "ok: $parts SessionStart hooks split rules.md at '${headings[0]}' and '${headings[1]}' into ${sizes[*]} characters, expand odd plugin paths, warn on unreadable rules.md, run without the exec bit"
