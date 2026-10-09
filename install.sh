#!/bin/sh
# Symlink commands and global Claude config into ~/.claude. Safe to rerun.
set -eu

root="$(cd "$(dirname "$0")" && pwd)"
dst="$HOME/.claude"
mkdir -p "$dst/commands"

link() {
  target="$2/$(basename "$1")"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "skip $(basename "$1"): real file exists at $target" >&2
    return
  fi
  ln -sfn "$1" "$target"
  echo "linked $(basename "$1")"
}

for f in "$root"/commands/*.md; do
  link "$f" "$dst/commands"
done

link "$root/claude/CLAUDE.md" "$dst"
link "$root/claude/settings.json" "$dst"
