#!/bin/sh
# Symlink commands and global Claude config into ~/.claude. Safe to rerun.
set -eu

root="$(cd "$(dirname "$0")" && pwd)"
dst="$HOME/.claude"
mkdir -p "$dst/commands" "$dst/agents"
ln -sfn "$root" "$dst/orbit"

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

for f in "$root"/agents/*.md; do
  link "$f" "$dst/agents"
done

mkdir -p "$dst/skills"
for d in "$root"/skills/*/; do
  link "${d%/}" "$dst/skills"
done

link "$root/claude/CLAUDE.md" "$dst"
link "$root/claude/settings.json" "$dst"
