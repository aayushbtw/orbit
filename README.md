# orbit

Personal Claude Code setup: global rules, settings and slash commands. Tracked in git.

## Layout

- `claude/CLAUDE.md`, `claude/settings.json`: symlinked into `~/.claude/`.
- `commands/`: slash commands, symlinked into `~/.claude/commands/`.
- `agents/`: subagents, symlinked into `~/.claude/agents/`.
- `skills/`: global skills, symlinked into `~/.claude/skills/`. From poteto/plugins (pstack, MIT): `typescript-best-practices` is loaded by `reviewer`, and `unslop` runs when writing docs, READMEs, PR descriptions and copy. From vercel-labs/agent-skills (MIT): `vercel-react-best-practices` and `vercel-composition-patterns`, which `reviewer` reads on demand for React diffs.
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
- `/correct`: turn a mistake into a lint rule, test or doc line.
- `/playbook`: standard flow for `bug`, `feature` or `perf`.
- `/ship`: check, review, docs, then land by the project's Land rule.

## Updating vendored skills

Say "update skills" or run `/update-skills [name]`. `skills.json` pins each skill's upstream commit and lists the local edits to redo after an update. To record a new local edit, add a line to that skill's `edits`.

## Projects

Each project adds a `## Workflow` block to its AGENTS.md (template: `templates/workflow-block.md`). Commands and agents read it for Check, Land and Review also checks.

## Agents

- `gitops` (Sonnet): commits and PR create, read, edit. Claude delegates to it on its own.
- `reviewer` (Opus): read-only pre-merge review.
- Main thread runs on Opus for coding and merge conflicts.
