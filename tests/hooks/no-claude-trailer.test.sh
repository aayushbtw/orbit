#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
hook=${1:-$repo/plugin/hooks/no-claude-trailer.sh}
fixtures="$repo/tests/hooks/no-claude-trailer.fixtures"
command -v jq >/dev/null || { echo "FAIL: needs jq"; exit 1; }

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
	input=$(jq -cn --arg c "$cmd" '{tool_name: "Bash", tool_input: {command: ($c | gsub("\\\\n"; "\n"))}}')
	code=0
	err=$(printf '%s' "$input" | "$hook" 2>&1 >/dev/null) || code=$?
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
