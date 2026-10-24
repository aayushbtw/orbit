#!/usr/bin/env bash
# Refuses `git branch -D` unless each branch's tip is the head its PR merged.
# A merged PR says nothing about commits made on the branch after it landed.
set -euo pipefail

command=$(jq -r '.tool_input.command // empty')
[[ "$command" =~ git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+branch[[:space:]] ]] || exit 0
[[ "$command" =~ (^|[[:space:]])(-D|--delete[[:space:]]+--force|--force[[:space:]]+--delete|-df|-fd)([[:space:]]|$) ]] || exit 0

dir=.
if [[ "$command" =~ git[[:space:]]+-C[[:space:]]+([^[:space:]]+) ]]; then
  dir="${BASH_REMATCH[1]}"
fi

after=${command#*branch }
for word in $after; do
  case "$word" in
    -* | '&&' | ';' | '|' | '||') continue ;;
  esac
  [[ "$word" =~ ^[A-Za-z0-9._/-]+$ ]] || break
  tip=$(git -C "$dir" rev-parse --verify --quiet "refs/heads/$word") || continue
  landed=$(cd "$dir" && gh pr view "$word" --json state,headRefOid \
    --jq 'select(.state == "MERGED") | .headRefOid' 2>/dev/null || true)
  if [[ "$tip" != "$landed" ]]; then
    echo "Refused: branch '$word' is at ${tip:0:7}, but its merged PR's head is ${landed:0:7}${landed:+.}${landed:-none.} It holds commits that never landed. Keep the branch and report it; delete with 'git branch -d' only once they're merged." >&2
    exit 2
  fi
done
exit 0
