# orbit

**Claude Code on steroids.**

It plans, builds, tests and ships on its own. You just name the goal.

Orbit is mostly [pstack](https://github.com/cursor/plugins/tree/main/pstack) by [Lauren Tan](https://x.com/poteto), trimmed and ported to Claude Code. See [Credits](#credits).

## Install

```
/plugin marketplace add aayushbtw/orbit
/plugin install orbit@orbit
```

Auto-update is off for third-party marketplaces. [Turn it on](docs/usage.md#auto-update) or run `claude plugin update orbit@orbit`.

## A task, start to finish

```mermaid
flowchart TD
    start["/orbit:start &lt;goal&gt;"] --> flow{Pick the flow}
    flow -- investigate --> answer[Answer, no commit]
    answer --> next
    flow -- bug, feature, refactor,<br/>perf, hillclimb --> wt[Own worktree]
    flow -- large or cross-cutting --> fio["/orbit:figure-it-out<br/>designs the steps"]
    fio --> wt
    wt --> big{Adds module or<br/>over 3 files?}
    big -- yes --> advisor[Advisor reviews plan]
    big -- no --> build
    advisor --> build
    subgraph loop [Build loop]
        build[poteto-agent writes unit] --> review[Claude reviews, verifies]
        review --> commit[gitops commits]
        commit -- next unit --> build
    end
    commit -- all units done --> clean
    commit -. contested design .-> interrogate["/orbit:interrogate"]
    interrogate --> clean
    subgraph opr [Opening a PR]
        clean[deslop, no-comments] --> land{Land line}
        land -- pr --> pr[Push, open a ready PR]
        land -- main --> branch[Keep the branch, unpushed]
    end
    pr --> next([Next: line])
    branch --> next
```

[Full walkthrough](docs/usage.md#a-task-start-to-finish)

## What do I run?

```mermaid
flowchart LR
    q{What now?}
    q -- new task or question --> start["/orbit:start &lt;goal&gt;"]
    q -- PR open, get it green --> babysit["/orbit:playbook babysit"]
    q -- change ready, land it --> ship["/orbit:ship"]
    q -- stop or switch model --> pause["/orbit:pause-safely"]
    pause -- new session --> pickup["/orbit:session-pickup"]
    q -- how or why code works --> how["/orbit:how or /orbit:why"]
    q -- Claude repeats a mistake --> correct["/orbit:correct"]
```

Every command: [docs/usage.md](docs/usage.md#every-command)

## The `Next:` line

Every task ends with one `Next:` line. Do what it says.

| Line | Means | You do |
| --- | --- | --- |
| `Next: nothing pending.` | Task is done | `/orbit:start` your next goal |
| `Next: /orbit:playbook babysit` | A PR is open | Run it to get the PR green, or leave it |
| `Next: /orbit:ship` | The change waits on an unpushed branch | Run it to verify and land the change |
| `Next: /orbit:start <follow-up>` | Outside the goal or needs your decision. Claude says which. | Run it when ready |
| `Next: new session, then /orbit:session-pickup` | Work was paused | Open a new session, run it |

## Correct usage

- Give `/orbit:start` the goal, not the steps. Orbit picks the flow and the steps.
- Don't land a change by hand. A task ends at a ready PR, or an unpushed branch under Land `main`. `/orbit:ship` lands it only after a fresh verifier passes it.
- Project differences (check command, PR landing, extra review sources) go in the project's `## Workflow` block, not in chat.

## Make it fit a project

Defaults assume [Vite+](https://viteplus.dev), a worktree per change, and fast-forward onto `main`. If a project differs, list only what's different in its AGENTS.md:

```md
## Workflow

- Check: `vpr check`, plus `vpr e2e` when the UI changed.
- Land: `pr`
- Review also checks: `docs/architecture.md`.
```

More in [docs/usage.md](docs/usage.md):

- [Project defaults](docs/usage.md#project-defaults) and [folder rules](docs/usage.md#folder-rules)
- [Background agents](docs/usage.md#what-runs-in-the-background)
- [Principles](docs/usage.md#principles) and [stack rules](docs/usage.md#stack-rules)

## Credits

Most of orbit is MIT work from [pstack](https://github.com/cursor/plugins/tree/main/pstack) by [Lauren Tan](https://x.com/poteto) and [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit). [What came from where](docs/usage.md#credits-in-full).

Orbit's own parts are the `/orbit:start` routing, the playbook gates and the project defaults. [Differences from pstack](docs/pstack-differences.md) lists where orbit departs and why.

## Maintain

- Develop without installing: `claude --plugin-dir ~/Projects/orbit`. Check with `claude plugin validate .`.
- Vendored files are tracked in `skills.json`. Update them with `/update-skills [name]` from this repo.
- `/orbit:interrogate` may ask once to read the plugin folder for its review rubric. Allow `Read(~/.claude/plugins/**)` to skip the prompt.
- Release: bump `version` in `.claude-plugin/plugin.json`.
