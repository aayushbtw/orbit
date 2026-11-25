# orbit

Orbit runs software work inside [T3 Code](https://github.com/pingdotgg/t3code). You give a T3 thread a goal, and orbit plans it, builds it, has a second agent run it, and lands it.

A coding agent can stop at code that compiles and never run it. Orbit uses T3's threads, providers and PR watching to split the work into small reviewed commits and test the change before anything lands.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/readme-dark.svg">
  <img alt="Three swimlanes for you, orbit and checks. You name a goal with /orbit:start. Orbit picks a flow and opens a worktree. For each small unit, orbit writes it, a check reads and runs it, and orbit commits it. Then a fresh agent runs the change like a user. On PASS, orbit lands the change and replies with what landed. On FAIL, nothing lands and you get a repro." src="docs/diagrams/readme-light.svg">
</picture>

## What orbit does in T3

- A model on any T3 provider can lead the thread. Every provider loads orbit through the `orbit` CLI, which registers orbit's skills directory and adds a marked rules block to the provider's user-wide instructions file. Each lead maps orbit's steps to its own tool list. To switch providers mid-task, run `/orbit:pause-safely`, switch, then run `/orbit:session-pickup`.
- Work that needs its own checkout runs as a child thread with its own worktree. That covers parallel units, review adversaries and the verifier. A review seat on another model family, and work that runs while the lead keeps going, such as an autopilot build round, also get a child thread. Helpers that share your checkout stay nested in your thread.
- Review panels and the verifier can use a second model family, such as Codex or Grok. Orbit uses only the providers you list in `/orbit:setup`.
- Before a change lands, an agent that did not write it runs it the way a user would. It returns `PASS`, `PASS+NOTES` or `FAIL`, and only a pass lands. Green CI is not a pass.
- Orbit waits on a PR with T3's PR watch, so the thread wakes when checks finish or a review arrives.
- Changes ship by default. Say "don't ship" to stop at the PR or branch, and land it later with `/orbit:ship`.

## Install

Orbit runs in [T3 Code](https://t3.codes) only. T3 supplies the lead, the enabled providers, delegation, worktrees, and the PR, CI and issue tools orbit uses. Orbit needs `git` and Node.js 22.12 or later. The default Check also needs [Vite+](https://viteplus.dev), unless your AGENTS.md names its own Check.

Install and configure Orbit from the standalone CLI, whichever provider leads. To try a version before it is published to npm, [build the package from source](docs/cli.md#build-from-source).

```bash
npm install -g @aayushbtw/orbit
orbit setup
orbit models
orbit doctor
```

`orbit setup` stages the bundle at `~/.config/orbit/current` and registers its skills directory and user-wide instructions block with each T3 provider it detects. Open the Orbit start skill in a new T3 thread. See [Orbit CLI](docs/cli.md) for scriptable commands and model configuration.

Then run `/orbit:setup` in a T3 thread. It lists missing tools, checks the install and the project, and asks which providers to use for review. It asks before it changes anything. Run `orbit update` to move to a newer release.

## Use orbit

| To | Run |
| --- | --- |
| Start a task or ask a question | `/orbit:start <goal>` |
| Get an open PR green | `/orbit:playbook babysit` |
| Land a ready change | `/orbit:ship` |
| Stop or switch model | `/orbit:pause-safely`, then `/orbit:session-pickup` in a new thread |
| Learn how or why code works | `/orbit:how` or `/orbit:why` |
| Stop a repeated mistake | `/orbit:correct` |

A host that links each skill flat, such as Claude Code, drops the `orbit:` prefix, so you run `/start`, `/ship` and so on.

[Every command](docs/usage.md#every-command) lists the rest. [The guide](docs/guide/README.md) walks through one task from start to finish. [Orbit in T3 Code](docs/t3-code.md) explains how orbit loads and picks providers, and lists [each live result](docs/t3-code.md#what-is-verified).

Each task ends with a plain reply. It names anything skipped, failed or left behind. After "don't ship" it tells you to run `/orbit:ship`, and after a pause it tells you to run `/orbit:session-pickup` in a new thread.

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

- Run orbit from source with `orbit link ~/Projects/orbit`.
- Run the Check line in AGENTS.md. On each push, CI runs it plus the worktree audit, diagram drift, link, T3 grader and version tests in `tests/`.
- Update vendored skills, listed in `skills.json`, with `/update-skills [name]`.
- To release, bump `version` in `plugin/manifest.json`. CI fails a `plugin/` change without a higher version.
