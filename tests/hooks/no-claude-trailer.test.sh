#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
hook=${1:-$repo/plugin/hooks/no-claude-trailer.sh}
hook=$(cd "$(dirname "$hook")" && pwd -P)/${hook##*/}
fixtures="$repo/tests/hooks/no-claude-trailer.fixtures"
command -v jq >/dev/null || { echo "FAIL: needs jq"; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf 'fix: thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n' > "$work/msg.txt"
printf 'fix: thing\n' > "$work/plain.txt"
mkdir "$work/tests"

trim() {
	local s=$1
	s=${s#"${s%%[![:space:]]*}"}
	printf '%s' "${s%"${s##*[![:space:]]}"}"
}

total=0
failed=0
while IFS='|' read -r name expect cmd; do
	[ -n "$name" ] || continue
	name=$(trim "$name")
	expect=$(trim "$expect")
	cmd=$(trim "$cmd")
	total=$((total + 1))
	input=$(jq -cn --arg c "$cmd" --arg d "$work" '{tool_name: "Bash", tool_input: {command: ($c | gsub("\\\\n"; "\n") | gsub("\\\\t"; "\t"))}, cwd: $d}')
	code=0
	err=$(cd "$work" && printf '%s' "$input" | "$hook" 2>&1 >/dev/null) || code=$?
	case "$expect:$code" in
	block:2)
		case "$err" in
		*Blocked*) echo "ok: $name (block)" ;;
		*) echo "FAIL: $name: exit 2 but stderr lacks 'Blocked'"; failed=$((failed + 1)) ;;
		esac ;;
	allow:0) echo "ok: $name (allow)" ;;
	*) echo "FAIL: $name: expected $expect, got exit $code"; failed=$((failed + 1)) ;;
	esac
done < "$fixtures"

[ "$failed" = 0 ] || { echo "$failed of $total fixtures failed"; exit 1; }
echo "ok: $total fixtures"
