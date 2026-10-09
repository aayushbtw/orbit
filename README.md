# orbit

Personal Claude Code setup: global rules, settings and slash commands. Tracked in git.

## Layout

- `claude/CLAUDE.md`, `claude/settings.json`: symlinked into `~/.claude/`.
- `commands/`: slash commands, symlinked into `~/.claude/commands/`.
- `agents/`: subagents, symlinked into `~/.claude/agents/`.
- `usage/`: token usage ledger and its SessionStart hook.
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

## Agents

- `gitops` (Sonnet): commits and PR create, read, edit. Claude delegates to it on its own.
- `reviewer` (Opus): read-only pre-merge review.
- Main thread runs on Opus for coding and merge conflicts.
