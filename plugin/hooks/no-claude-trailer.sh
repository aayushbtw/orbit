#!/bin/sh
cmd=$(grep -Eo '"command": *"([^"\\]|\\.)*"') || exit 0
printf '%s' "$cmd" | grep -Eq 'git( +-[Cc] +[^ ]+| +--?[[:alnum:]-]+(=[^ ]*)?)* +commit([ "\\]|$)' || exit 0
printf '%s' "$cmd" | grep -Eiq 'co-authored-by: *claude' || exit 0
echo 'Blocked: commit message has a Co-Authored-By: Claude trailer. Commit again with the same message minus that trailer.' >&2
exit 2
