# claude-kit

Personal Claude Code commands and workflow rules. Tracked in git.

## Layout

- `commands/`: slash commands. Symlinked into `~/.claude/commands/`.
- `install.sh`: creates the symlinks. Safe to rerun.

Not here: `CLAUDE.md` and `settings.json` live in `~/Projects/dotfiles/claude/`.

## Install

```sh
./install.sh
```

## Add a command

1. Create `commands/<name>.md` with frontmatter (`description`).
2. Run `./install.sh`.
3. Commit.

## Commands

- `/handoff`: write HANDOFF.md before `/clear` and a model switch.
- `/resume`: load HANDOFF.md and show git status.
- `/commit`: commit with the `type(scope): desc` subject format.
