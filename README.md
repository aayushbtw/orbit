# orbit

Personal Claude Code setup: global rules, settings and slash commands. Tracked in git.

## Layout

- `claude/CLAUDE.md`, `claude/settings.json`: symlinked into `~/.claude/`.
- `commands/`: slash commands, symlinked into `~/.claude/commands/`.
- `install.sh`: creates the symlinks. Safe to rerun.

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
