#!/bin/sh
rules=$CLAUDE_PLUGIN_ROOT/rules.md
root=$CLAUDE_PLUGIN_ROOT
case $root in *[\\\&\|]*) root=$(printf '%s\n' "$root" | sed 's/[\\&|]/\\&/g') ;; esac
case $1 in
head) half='/^# Code Quality$/,$d' ;;
tail) half='/^# Code Quality$/,$!d' ;;
esac
sed -e "$half" -e "s|<orbit-plugin>|$root|g" "$rules" ||
	echo "orbit: could not load $rules, so orbit's rules are missing from this session."
