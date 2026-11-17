#!/bin/sh
exec awk -v sq="'" '
{ json = json $0 }
END {
	if (!match(json, /"command": *"([^"\\]|\\.)*"/)) exit 0
	cmd = substr(json, RSTART, RLENGTH)
	sub(/^"command": *"/, ";", cmd)
	if (!match(cmd, /([;&|(`]|\\n) *([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)*([^ ;&|()`"]*\/)?git( +-[Cc] +[^ ]+| +--?[A-Za-z0-9-]+(=[^ ]*)?)* +commit(-tree)?[ "\\;&|)]/)) exit 0
	rest = substr(cmd, RSTART + RLENGTH - 1)
	if (match(rest, /[;&|)`]|\\n/)) rest = substr(rest, 1, RSTART - 1)
	found = tolower(cmd) ~ /co-authored-by: *claude/
	if (!found && match(rest, / (-F|--file[= ]) *(\\")?[^ ;&|)"\\]+/)) {
		f = substr(rest, RSTART, RLENGTH)
		sub(/^ (-F|--file[= ]) *(\\")?/, "", f)
		gsub(sq, "", f)
		if (f !~ /^\// && match(json, /"cwd": *"([^"\\]|\\.)*"/)) {
			dir = substr(json, RSTART, RLENGTH)
			sub(/^"cwd": *"/, "", dir)
			f = substr(dir, 1, length(dir) - 1) "/" f
		}
		while (!found && (getline line < f) > 0)
			found = tolower(line) ~ /co-authored-by: *claude/
	}
	if (!found) exit 0
	print "Blocked: commit message has a Co-Authored-By: Claude trailer. Commit again with the same message minus that trailer." > "/dev/stderr"
	exit 2
}'
