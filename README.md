# orbit

Shared Claude Code plugin for the team: slash commands, subagents, skills and working rules.

## Install

In Claude Code:

```
/plugin marketplace add aayushbtw/orbit
/plugin install orbit@orbit
```

Update with `/plugin`. Everything is namespaced under `orbit`, so `/ship` is `/orbit:ship` and the agents are `orbit:reviewer` and `orbit:gitops`.

The shared rules (`rules.md`) load into every session through a SessionStart hook. Your own `CLAUDE.md` and `settings.json` stay yours.

## Layout

- `.claude-plugin/`: `plugin.json` (name, version) and `marketplace.json`.
- `commands/`: slash commands.
- `agents/`: subagents.
- `skills/`: vendored skills. Sources and local edits are in `skills.json`.
- `hooks/hooks.json`: prints `rules.md` at session start.
- `rules.md`: shared rules: delegation, code quality, where files go, workflow defaults.
- `templates/workflow-block.md`: the `## Workflow` block a project adds to its AGENTS.md.
- `.claude/commands/update-skills.md`: maintainer command, available only inside this repo.

## Commands

- `/orbit:handoff`: write `.claude/HANDOFF.md` before `/clear` and a model switch.
- `/orbit:resume`: load `.claude/HANDOFF.md` and show git status.
- `/orbit:correct`: turn a mistake into a lint rule, test or doc line.
- `/orbit:playbook`: standard flow for `bug`, `feature` or `perf`.
- `/orbit:ship`: check, review, docs, then land by the project's Land rule.

## Agents

- `gitops` (Sonnet): commits and PR create, read, edit. Claude delegates to it on its own.
- `reviewer` (Opus): read-only pre-merge review.

## Skills

- From poteto/plugins (pstack, MIT): `typescript-best-practices`, read by `reviewer`, and `unslop`, which runs when writing docs, READMEs, PR descriptions and copy.
- From vercel-labs/agent-skills (MIT): `vercel-react-best-practices` and `vercel-composition-patterns`, which `reviewer` reads on demand for React diffs.

To update them, open Claude Code in this repo and say "update skills" or run `/update-skills [name]`. `skills.json` pins each skill's upstream commit and lists the local edits to redo. To record a new local edit, add a line to that skill's `edits`. Bump `version` in `plugin.json` to release.

## Projects

Each project adds a `## Workflow` block to its AGENTS.md (template: `templates/workflow-block.md`) listing only what differs from the defaults in `rules.md`. Commands and agents read it for Check, Land and Review also checks.

## Develop

Test local changes without installing: `claude --plugin-dir ~/Projects/orbit`. Check the plugin with `claude plugin validate .`.
