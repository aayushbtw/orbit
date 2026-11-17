# orbit

Name the goal in T3 Code. Orbit plans, builds, verifies and ships it.

Orbit is mostly [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan, trimmed and ported to Claude Code. [Differences from pstack](docs/pstack-differences.md) lists where orbit departs and why.

## Install

Orbit needs `git`, `gh` logged in with `gh auth login`, `node`, `bun` and `jq`. The default Check also needs [Vite+](https://viteplus.dev), unless the project's AGENTS.md names its own Check.

Install orbit once, in Claude Code:

```
/plugin marketplace add aayushbtw/orbit
/plugin install orbit@orbit
```

Then run `/orbit:setup`, on any host. It reports each missing tool with its install command, checks the git repo and its Workflow block, compares the installed orbit with the marketplace copy, and checks what Codex and Grok load. When Codex is installed, setup offers to link it to the folder Claude Code installs orbit from, so Codex needs no install of its own. Setup asks once at the end before it changes anything.

The provider step needs a T3 thread led by Claude. It lists your T3 providers, asks which ones fill each panel's seat on another family, and saves your choice for every project in `~/.claude/rules/orbit-models.md`. A project's AGENTS.md Models rows still win. Setup also sends the verifier that runs each change before it lands to those providers. Run setup from a Claude thread, because a Grok thread may load an older copy of orbit that lacks the skill.

Auto-update is off for third-party marketplaces. [Turn it on](docs/usage.md#auto-update) or run `claude plugin update orbit@orbit`.

## A task, start to finish

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/readme-dark.svg">
  <img alt="You run /orbit:start. The lead picks the flow and a worktree. For each unit, poteto-agent on Claude writes it, the lead reads and runs it, and gitops commits it. The lead cleans up, a fresh verifier runs the change, and on PASS it lands and you get a Next: line." src="docs/diagrams/readme-light.svg">
</picture>

- A question stops after the answer, with citations.
- Large or cross-cutting work goes through `/orbit:figure-it-out`, which designs its own steps.
- New to orbit? Read [the guide](docs/guide/README.md), which starts with the [full walkthrough](docs/guide/01-start-a-task.md).

## Run on any provider in T3

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/t3-lead-dark.svg">
  <img alt="You run /orbit:start. The lead checks whether Non-negotiables is already in its context. Yes for a Claude lead, because the SessionStart hook printed the rules. No for another provider, so the lead loads the rules skill, which reads rules.md. Both paths then run the playbook. The lead spawns three kinds of child. An orbit agent runs as a native subagent, nested in the same thread. A code child runs on the lead's provider, as a native subagent, or as a same-provider delegate_task child when it needs its own checkout. A panel seat runs on another family through delegate_task. Under a Codex lead, code children run on gpt-6.1-sol." src="docs/diagrams/t3-lead-light.svg">
</picture>

A T3 thread led by Claude or another provider, such as Grok or Codex, runs orbit. Each review panel fills a second seat from your other T3 providers, so a second model family checks the work. [Orbit in T3 Code](plugin/docs/harness/t3-code.md) maps each step to T3's tools.

| Lead | Tested |
| --- | --- |
| Claude | Verified |
| Grok | Verified |
| Grok, code child | Not run live yet |
| Codex | Verified |
| Codex, code child on gpt-6.1-sol | Verified |
| Other providers | Untested |

To load orbit's rules in every session, even without `/orbit:start`, add this line to the provider's own instruction file, such as `~/.grok/AGENTS.md` or `~/.codex/AGENTS.md`. Setup adds it only when you say yes.

```
If Non-negotiables is not in your context, load the orbit `rules` skill before your first reply.
```

[How orbit runs in T3](docs/t3-code.md) covers how Grok and Codex load and update orbit.

## What do I run?

| You want to | Run |
| --- | --- |
| Start a task or ask a question | `/orbit:start <goal>` |
| Get an open PR green | `/orbit:playbook babysit` |
| Land a ready change | `/orbit:ship` |
| Stop or switch model | `/orbit:pause-safely`, then `/orbit:session-pickup` in a new session |
| Learn how or why code works | `/orbit:how` or `/orbit:why` |
| Stop a repeated mistake | `/orbit:correct` |

Every command: [docs/usage.md](docs/usage.md#every-command)

## The `Next:` line

Every task ends with one `Next:` line. Do what it says.

| Line | Means | You do |
| --- | --- | --- |
| `Next: nothing pending.` | Done | `/orbit:start` your next goal |
| `Next: /orbit:ship` | You said "don't ship" | Run it to verify and land |
| `Next: /orbit:start <follow-up>` | Outside the goal, or your call | Run it when ready |
| `Next: new session, then /orbit:session-pickup` | Work was paused | Run it in a new session |

## Ships by default

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/guide-ship-dark.svg">
  <img alt="A built change goes through Opening a PR. Under Land pr, the branch opens as a PR. Under Land main, the branch stays local. A dashed line right after that marks where a task stops when you said don't ship, and /orbit:ship resumes from there. Past the line, Babysit drives a PR to merge-ready, and both paths reach a fresh verifier. On PASS or PASS+NOTES the change lands. On FAIL nothing lands, and the reply carries a repro." src="docs/diagrams/guide-ship-light.svg">
</picture>

Don't land a change by hand. Say "don't ship" or "I'll land it" to stop at the PR or unpushed branch, then land it with `/orbit:ship`.

## Make it fit a project

Defaults assume [Vite+](https://viteplus.dev), a worktree per change, and fast-forward onto `main`. List only what differs in the project's AGENTS.md, not in chat.

```md
## Workflow

- Check: `vpr check`, plus `vpr e2e` when the UI changed.
- Land: `pr`
- Review also checks: `docs/architecture.md`.
```

- [Project defaults](docs/usage.md#project-defaults) and [folder rules](docs/guide/08-make-it-fit.md#put-folder-rules-next-to-the-code)
- [Background agents](docs/usage.md#what-runs-in-the-background)
- [Principles](docs/usage.md#principles) and [stack rules](docs/guide/04-build-a-change.md#follow-the-stack-rules-for-typescript)

## Maintain

- Develop without installing with `claude --plugin-dir ~/Projects/orbit/plugin`.
- Check with the Check line in AGENTS.md.
- Update vendored files, tracked in `skills.json`, with `/update-skills [name]` from this repo.
- `/orbit:interrogate` may ask once to read the plugin folder. Allow `Read(~/.claude/plugins/**)` to skip the prompt.
- To release, bump `version` in `plugin/.claude-plugin/plugin.json`.
