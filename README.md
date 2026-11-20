# orbit

Orbit runs software work inside [T3 Code](https://github.com/pingdotgg/t3code). You give a T3 thread a goal, and orbit plans it, builds it, has a second agent run it, and lands it.

A coding agent can stop at code that compiles and never run it. Orbit uses T3's threads, providers and PR watching to split the work into small reviewed commits and test the change before anything lands.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/readme-dark.svg">
  <img alt="Three swimlanes for you, orbit and checks. You name a goal with /orbit:start. Orbit picks a flow and opens a worktree. For each small unit, orbit writes it, a check reads and runs it, and orbit commits it. Then a fresh agent runs the change like a user. On PASS, orbit lands the change and you get a Next: line. On FAIL, nothing lands and you get a repro." src="docs/diagrams/readme-light.svg">
</picture>

## What orbit does in T3

- Claude, through Claude Code, leads every thread. Other families only fill review seats and the verifier.
- Work that needs its own checkout runs as a child thread with its own worktree. That covers parallel units, review adversaries and the verifier. A review seat on another model family, and work that runs while the lead keeps going, such as an autopilot build round, also get a child thread. Helpers that share your checkout stay nested in your thread.
- Review panels and the verifier can use a second model family, such as Codex or Grok. Orbit uses only the providers you list in `/orbit:setup`.
- Before a change lands, an agent that did not write it runs it the way a user would. It returns `PASS`, `PASS+NOTES` or `FAIL`, and only a pass lands. Green CI is not a pass.
- Orbit waits on a PR with T3's PR watch, so the thread wakes when checks finish or a review arrives.
- Changes ship by default. Say "don't ship" to stop at the PR or branch, and land it later with `/orbit:ship`.

## Install

Orbit needs `git`, `node`, `bun`, `jq` and `gh` logged in with `gh auth login`. The default Check also needs [Vite+](https://viteplus.dev), unless your AGENTS.md names its own Check.

Orbit installs once, through Claude Code's plugin marketplace. T3's Claude provider loads it from there.

```
claude plugin marketplace add aayushbtw/orbit
claude plugin install orbit@orbit
```

Then run `/orbit:setup` in a T3 thread. It lists missing tools, checks the project, and asks which providers to use for review. It asks before it changes anything.

Auto-update is off for third-party marketplaces. [Turn it on](docs/usage.md#auto-update) or run `claude plugin update orbit@orbit`.

Outside T3, orbit still runs in Claude Code. It then runs on Claude models only, and runs child work as Claude Code subagents instead of child threads.

## Use orbit

| To | Run |
| --- | --- |
| Start a task or ask a question | `/orbit:start <goal>` |
| Get an open PR green | `/orbit:playbook babysit` |
| Land a ready change | `/orbit:ship` |
| Stop or switch model | `/orbit:pause-safely`, then `/orbit:session-pickup` in a new thread |
| Learn how or why code works | `/orbit:how` or `/orbit:why` |
| Stop a repeated mistake | `/orbit:correct` |

[Every command](docs/usage.md#every-command) lists the rest. [The guide](docs/guide/README.md) walks through one task from start to finish. [Orbit in T3 Code](docs/t3-code.md) explains how orbit loads and picks providers, and lists [each live result](docs/t3-code.md#what-is-verified).

Each task ends with a `Next:` line that tells you what to run.

| Line | Means | You run |
| --- | --- | --- |
| `Next: nothing pending.` | Done | `/orbit:start` with your next goal |
| `Next: /orbit:ship` | You said "don't ship" | `/orbit:ship` to verify and land |
| `Next: /orbit:start <follow-up>` | Work outside the goal, or a call for you | That line, when ready |
| `Next: new session, then /orbit:session-pickup` | Work was paused | `/orbit:session-pickup` in a new thread |

## Make it fit a project

By default orbit uses [Vite+](https://viteplus.dev), a worktree per change, and a fast-forward onto `main` with no PR. Put only what differs in your AGENTS.md:

```md
## Workflow

- Check: `vpr check`, plus `vpr e2e` when the UI changed.
- Land: `pr`
- Review also checks: `docs/architecture.md`.
```

See [project defaults](docs/usage.md#project-defaults) and [Make orbit fit your project](docs/guide/08-make-it-fit.md).

## Credits

Orbit started as [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan. [Differences from pstack](docs/pstack-differences.md) lists each change and its reason.

## Maintain

- Run orbit from source with `claude --plugin-dir ~/Projects/orbit/plugin`.
- Run the Check line in AGENTS.md. On each push, CI runs it plus the hook, worktree audit, diagram drift, link, T3 grader and version tests in `tests/`.
- Update vendored skills, listed in `skills.json`, with `/update-skills [name]`.
- Allow `Read(~/.claude/plugins/**)` so `/orbit:interrogate` doesn't ask to read the plugin folder.
- To release, bump `version` in `plugin/.claude-plugin/plugin.json`. CI fails a `plugin/` change without a higher version.
