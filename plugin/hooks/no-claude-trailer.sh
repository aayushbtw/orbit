#!/bin/sh
file=$(awk '
{ json = json $0 }
END {
	if (!match(json, /"command": *"([^"\\]|\\.)*"/)) exit 0
	cmd = substr(json, RSTART, RLENGTH)
	sub(/^"command": *"/, ";", cmd)
	if (!match(cmd, /([;&|(`]|\\n)( |\\t)*(([{!]|if|elif|then|else|do|while|until|time)( |\\t)+)*([A-Za-z_][A-Za-z0-9_]*=(\\"([^\\]|\\[^"])*\\"|\047[^\047]*\047|[^ \\;&|]*)( |\\t)+)*([^ ;&|()`"]*\/)?git( +-[Cc] +[^ ]+| +--?[A-Za-z0-9-]+(=[^ ]*)?)* +commit(-tree)?[ "\\;&|)]/)) exit 0
	if (tolower(cmd) ~ /co-authored-by: *claude/) exit 3
	rest = substr(cmd, RSTART + RLENGTH - 1)
	gsub(/ (-m|--message)[= ]*(\\"([^\\]|\\[^"])*\\"|\047[^\047]*\047|[^ ]*)/, "", rest)
	if (match(rest, /[;&|)`]|\\n/)) rest = substr(rest, 1, RSTART - 1)
	if (!match(rest, / (-F|--file[= ]) *(\\"[^"\\]+\\"|\047[^\047]+\047|[^ ;&|)"\\]+)/)) exit 0
	f = substr(rest, RSTART, RLENGTH)
	sub(/^ (-F|--file[= ]) */, "", f)
	gsub(/\\"|\047/, "", f)
	if (f !~ /^\// && match(json, /"cwd": *"([^"\\]|\\.)*"/)) {
		dir = substr(json, RSTART, RLENGTH)
		sub(/^"cwd": *"/, "", dir)
		f = substr(dir, 1, length(dir) - 1) "/" f
	}
	print f
}')
case $? in
3) ;;
0) [ -f "$file" ] && [ -r "$file" ] && grep -Eiq 'co-authored-by: *claude' "$file" || exit 0 ;;
*) exit 0 ;;
esac
echo 'Blocked: commit message has a Co-Authored-By: Claude trailer. Commit again with the same message minus that trailer.' >&2
exit 2
