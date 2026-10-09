#!/bin/sh
# Symlink each command into ~/.claude/commands. Safe to rerun.
set -eu

src="$(cd "$(dirname "$0")" && pwd)/commands"
dst="$HOME/.claude/commands"
mkdir -p "$dst"

for f in "$src"/*.md; do
  name="$(basename "$f")"
  target="$dst/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "skip $name: real file exists at $target" >&2
    continue
  fi
  ln -sfn "$f" "$target"
  echo "linked $name"
done
