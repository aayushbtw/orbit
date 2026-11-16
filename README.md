# orbit

**Claude Code on steroids.**

It plans, builds, tests and ships on its own. You just name the goal.

Orbit is mostly [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan, trimmed and ported to Claude Code. [Differences from pstack](docs/pstack-differences.md) lists where orbit departs and why.

## Install

```
/plugin marketplace add aayushbtw/orbit
/plugin install orbit@orbit
```

Auto-update is off for third-party marketplaces. [Turn it on](docs/usage.md#auto-update) or run `claude plugin update orbit@orbit`.

## T3 Code

Orbit runs in Claude Code and in T3 Code. In T3 Code, it links PRs to the thread, waits on PRs, schedules wakes and asks for secrets with T3's tools. It also fills each review panel's second seat from your other T3 providers, so a second model family checks the work. Where a T3 tool is absent, it does what it does in Claude Code. [Orbit in T3 Code](plugin/docs/harness/t3-code.md) maps each step.

## Other providers in T3

To set up orbit for every provider in T3, send this in any T3 thread. The lead installs orbit for each provider it has a tested setup for and checks that it loads.

```
Set up orbit by following https://github.com/aayushbtw/orbit/blob/main/docs/setup.md
```

A T3 thread led by another provider, such as Grok, runs orbit too. Start a task with `/orbit:start <goal>`. The lead loads orbit's `rules` skill once per session, when the provider drops orbit's SessionStart hook. To load the rules in every session, even without `/orbit:start`, add this line to the provider's own instruction file, such as `~/.grok/AGENTS.md`. Orbit writes that file only when you say yes during setup.

```
If Non-negotiables is not in your context, load the orbit `rules` skill before your first reply.
```

Grok loads orbit from Claude Code's install record when orbit is enabled in Claude Code's user settings, so `claude plugin update orbit@orbit` updates Grok's copy too. Until that command runs, Grok keeps the version in that record, even when Claude Code already loads a newer one. A Grok install of its own, `grok plugin install aayushbtw/orbit#plugin --trust`, wins over that record, and `grok plugin update orbit` updates it. [How orbit runs in T3](docs/t3-code.md) explains the design.

Tested on: Claude and Grok leads verified, others untested. Under a Grok lead, the wake after a code child on Claude has not run live yet.

## A task, start to finish

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/readme-dark.svg">
  <img alt="You run /orbit:start. Claude picks the flow and a worktree. For each unit, poteto-agent writes it, Claude reviews and runs it, and gitops commits it. Claude cleans up, a fresh verifier runs the change, and on PASS it lands and you get a Next: line." src="docs/diagrams/readme-light.svg">
</picture>

- A question stops after the answer, with citations.
- Large or cross-cutting work goes through `/orbit:figure-it-out`, which designs its own steps.
- Say "don't ship" to stop at the PR.

New to orbit? Read [the guide](docs/guide/README.md), which starts with the [full walkthrough](docs/guide/01-start-a-task.md).

## What do I run?

| You want to | Run |
| --- | --- |
| Start a task or ask a question | `/orbit:start <goal>` |
| Get an open PR green | `/orbit:playbook babysit` |
| Land a ready change | `/orbit:ship` |
| Stop or switch model | `/orbit:pause-safely`, then `/orbit:session-pickup` in a new session |
| Learn how or why code works | `/orbit:how` or `/orbit:why` |
| Stop Claude repeating a mistake | `/orbit:correct` |

Every command: [docs/usage.md](docs/usage.md#every-command)

## The `Next:` line

Every task ends with one `Next:` line. Do what it says.

| Line | Means | You do |
| --- | --- | --- |
| `Next: nothing pending.` | Task is done | `/orbit:start` your next goal |
| `Next: /orbit:ship` | You said "don't ship", so the PR or unpushed branch waits | Run it to verify and land the change |
| `Next: /orbit:start <follow-up>` | Outside the goal or needs your decision. Claude says which. | Run it when ready |
| `Next: new session, then /orbit:session-pickup` | Work was paused | Open a new session, run it |

## Correct usage

- Give `/orbit:start` the goal, not the steps. Claude picks the flow and the steps.
- Don't land a change by hand. A change task ships by default, and only after a fresh verifier passes it. Say "don't ship" or "I'll land it" to stop at the PR, or the unpushed branch under Land `main`, then land it with `/orbit:ship`.
- Project differences (check command, PR landing, extra review sources) go in the project's `## Workflow` block, not in chat.

## Make it fit a project

Defaults assume [Vite+](https://viteplus.dev), a worktree per change, and fast-forward onto `main`. If a project differs, list only what's different in its AGENTS.md:

```md
## Workflow

- Check: `vpr check`, plus `vpr e2e` when the UI changed.
- Land: `pr`
- Review also checks: `docs/architecture.md`.
```

More:

- [Project defaults](docs/usage.md#project-defaults) and [folder rules](docs/guide/08-make-it-fit.md#put-folder-rules-next-to-the-code)
- [Background agents](docs/usage.md#what-runs-in-the-background)
- [Principles](docs/usage.md#principles) and [stack rules](docs/guide/04-build-a-change.md#follow-the-stack-rules-for-typescript)

## Maintain

- Develop without installing: `claude --plugin-dir ~/Projects/orbit/plugin`. Check with `claude plugin validate . && claude plugin validate plugin`.
- Vendored files are tracked in `skills.json`. Update them with `/update-skills [name]` from this repo.
- `/orbit:interrogate` may ask once to read the plugin folder for the arena skill it runs. Allow `Read(~/.claude/plugins/**)` to skip the prompt.
- Release: bump `version` in `plugin/.claude-plugin/plugin.json`.
