# orbit

One workflow for every project. Orbit teaches Claude Code to build, check, review and ship the same way in every repo, so you don't repeat yourself each session.

Much of it comes from [pstack](https://github.com/cursor/plugins/tree/main/pstack) by [Lauren Tan](https://x.com/poteto): the reviewer's filters, the playbooks, `/correct`, verification skills, and the `unslop` and `typescript-best-practices` skills. Orbit keeps the ideas and stays small enough to read in one sitting.

## Install

In Claude Code:

```
/plugin marketplace add aayushbtw/orbit
/plugin install orbit@orbit
```

The rules load on their own at the start of every session. Update from `/plugin`. Your own `CLAUDE.md` and `settings.json` stay yours.

## Use it

Ask for what you want as usual. Orbit adds these commands:

| Type | When | What happens |
| --- | --- | --- |
| `/ship` | The change is ready | Runs the checks, gets a review, updates docs, then commits to `main` or opens a PR |
| `/playbook bug` | Starting a task | Follows a short standard flow. Also `feature`, `refactor`, `perf` |
| `/correct <mistake>` | Claude got something wrong again | Removes the cause, or adds a lint rule, test or doc line, so it can't happen again |
| `/handoff` | Stopping mid-task, or switching model | Saves where you are, outside the repo |
| `/pickup` | Starting the next session | Reads the handoff and does the next step |
| `/verify-skill create` | Once per project | Builds a skill that lets Claude run your app and show proof a change works |

A typical day:

```
fix the login redirect bug          ← or: /playbook bug fix the login redirect
/ship
/clear                              ← next task
```

Stopping before it's done:

```
/handoff
/clear
/pickup
```

Each command also works as `/orbit:<name>`. Use that form if another plugin has a command with the same name.

## Let Claude prove its work

Tests passing isn't the same as the feature working. Run `/verify-skill create` once in a project. Claude reads the repo and writes `.claude/skills/verify-<project>/`:

- a small control script (`doctor`, start the app, drive it, save evidence, clean up), with JSON output and errors that say what to do next
- a feature map: one file per feature, saying how a user reaches it, the exact commands to drive it, and what proves it worked

Claude runs the new skill once end to end before handing it over. After that, `/ship` uses it on any change a user can see and reports where the evidence is.

When the app changes, run `/verify-skill maintain`. It drives every feature, fixes the skill and map where they drifted, and reports real bugs instead of hiding them.

## What runs in the background

Claude hands work to these agents itself. You don't call them.

- **gitops** (Sonnet): commits and PRs.
- **reviewer** (Opus, read-only): checks the change before it lands. Looks for bugs, TypeScript and React problems, patterns the next agent would copy, tests that check nothing, AI-sounding prose, and slop.
- **advisor** (Opus, read-only): a second opinion before a big decision, when Claude is stuck, and before it calls a task done.

## Make it fit a project

Defaults assume [Vite+](https://viteplus.dev). `vpr check` must pass, plus `vpr build` and `vpr test` if those scripts exist. Changes land straight on `main`.

If a project differs, add a `## Workflow` block to its AGENTS.md. List only what's different:

```md
## Workflow

- Check: `vpr check`, plus `vpr e2e` when the UI changed.
- Land: `pr`
- Review also checks: `docs/architecture.md`.
```

`templates/workflow-block.md` has the template. The reviewer also reads any "Mistakes made before" list in the same file.

## Maintain

- Develop without installing: `claude --plugin-dir ~/Projects/orbit`. Check with `claude plugin validate .`.
- Vendored skills (`typescript-best-practices` and `unslop` from pstack, the two `vercel-*` skills from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), all MIT) are tracked in `skills.json`. Update them with `/update-skills [name]` from this repo.
- The reviewer may ask once to read the plugin folder for the React rules. Allow `Read(~/.claude/plugins/**)` to skip the prompt.
- Release: bump `version` in `.claude-plugin/plugin.json`.
