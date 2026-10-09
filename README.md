# orbit

Shared Claude Code setup for the team: slash commands, subagents, skills and working rules.

## Install

```sh
git clone https://github.com/aayushbtw/orbit ~/Projects/orbit
~/Projects/orbit/install.sh
```

Then add this line to your own `~/.claude/CLAUDE.md` to load the rules:

```
@~/.claude/orbit/rules.md
```

The installer only links commands, agents and skills. Your own `CLAUDE.md` and `settings.json` stay yours.

## Layout

- `commands/`: slash commands, linked into `~/.claude/commands/`.
- `agents/`: subagents, linked into `~/.claude/agents/`.
- `skills/`: vendored skills, linked into `~/.claude/skills/`. Sources and local edits are in `skills.json`.
- `rules.md`: shared rules: delegation, code quality, where files go, workflow defaults.
- `templates/workflow-block.md`: the `## Workflow` block a project adds to its AGENTS.md.
- `install.sh`: creates the links. Safe to rerun.

## Commands

- `/handoff`: write `.claude/HANDOFF.md` before `/clear` and a model switch.
- `/resume`: load `.claude/HANDOFF.md` and show git status.
- `/correct`: turn a mistake into a lint rule, test or doc line.
- `/playbook`: standard flow for `bug`, `feature` or `perf`.
- `/ship`: check, review, docs, then land by the project's Land rule.
- `/update-skills`: update vendored skills from upstream, keeping local edits.

## Agents

- `gitops` (Sonnet): commits and PR create, read, edit. Claude delegates to it on its own.
- `reviewer` (Opus): read-only pre-merge review.

## Skills

- From poteto/plugins (pstack, MIT): `typescript-best-practices`, loaded by `reviewer`, and `unslop`, which runs when writing docs, READMEs, PR descriptions and copy.
- From vercel-labs/agent-skills (MIT): `vercel-react-best-practices` and `vercel-composition-patterns`, which `reviewer` reads on demand for React diffs.

To update them, say "update skills" or run `/update-skills [name]`. `skills.json` pins each skill's upstream commit and lists the local edits to redo. To record a new local edit, add a line to that skill's `edits`.

## Projects

Each project adds a `## Workflow` block to its AGENTS.md (template: `templates/workflow-block.md`) listing only what differs from the defaults in `rules.md`. Commands and agents read it for Check, Land and Review also checks.

## Add a command

1. Create `commands/<name>.md` with frontmatter (`description`).
2. Run `./install.sh`.
3. Commit.
