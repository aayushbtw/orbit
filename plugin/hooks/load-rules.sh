#!/bin/sh
rules=$CLAUDE_PLUGIN_ROOT/rules.md
root=$CLAUDE_PLUGIN_ROOT
case $root in *[\\\&\|]*) root=$(printf '%s\n' "$root" | sed 's/[\\&|]/\\&/g') ;; esac
case $1 in
head) part='/^# Delegation$/,$d' ;;
middle) part='/^# Delegation$/,/^# Writing the reply$/!d
/^# Writing the reply$/d' ;;
tail) part='/^# Writing the reply$/,$!d' ;;
shared)
	rules=$CLAUDE_PLUGIN_ROOT/rules-shared.md
	part='' ;;
esac
sed -e "$part" -e "s|<orbit-plugin>|$root|g" "$rules" ||
	echo "orbit: could not load $rules, so orbit's rules are missing from this session."
