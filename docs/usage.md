# Using orbit

A lookup reference for orbit's commands, agents and defaults. To learn how a task runs and why, read [the guide](guide/README.md).

## Every command

### Do a task

| Situation | Run |
| --- | --- |
| Any new task (a bug, a feature, a refactor, a slow path), or a question with no code change | `/orbit:start <goal>` |
| A specific flow, or only its step list | `/orbit:playbook <investigate\|bug\|feature\|refactor\|prototype\|perf\|hillclimb\|autopilot-full\|autopilot-stack\|multi-phase-plan>` |
| Improve one metric over many rounds, toward a target | `/orbit:playbook hillclimb`, or `/orbit:start` with a metric goal |
| Run a queue of independent changes to merged, one owner each | `/orbit:start autopilot this queue: <items>` |
| Build and verify a queue as one stack you land yourself | `/orbit:start build the stack, I'll land it: <items>` |
| Plan work that spans phases or several PRs, to run on your go | `/orbit:start multi-PR plan: <goal>` |
| Large or cross-cutting work, or work you step away from | `/orbit:figure-it-out <goal>` (`/orbit:start` routes there too) |
| Get an open PR green, answer its review threads, or check its status | `/orbit:playbook babysit` (`/orbit:start` routes "babysit this" there) |
| Build a change but land it yourself | `/orbit:start <goal>, don't ship` (or "I'll land it") |
| Change is ready, land it | `/orbit:ship`. A fresh verifier runs the change first. |
| Stop mid-task, switch model, step away | `/orbit:pause-safely`, then `/orbit:session-pickup` in a new session. See [Stop cleanly, pick up later](guide/06-hands-off.md#stop-cleanly-pick-up-later). |
| A long or unattended run you'll review later | `/orbit:show-me-your-work` |
| Catch up on what changed since your last message | `/orbit:ketchup` |
| Disk is tight, or worktrees have piled up | `/orbit:worktree-cleanup` |

Mid-task, "continue" or "do it" resumes the todo list. "new task" starts a fresh one.

### Understand code

| Situation | Run |
| --- | --- |
| How a subsystem works, where new code goes | `/orbit:how <subsystem>` |
| Why code is the way it is (rationale, regressions, history) | `/orbit:why <code or decision>` |
| Design the shape before writing code | `/orbit:architect <what>` |
| Several attempts at one artifact, then pick a base and graft the best parts | `/orbit:arena <task>` |
| Adversarial review of a change | `/orbit:interrogate` |
| Fan out parallel workers for coverage, races or exploration | `/orbit:swarm <job>` |
| Catch up on recent work across sessions | `/orbit:recall [topic]` |

### Improve Claude

[Make orbit fit your project](guide/08-make-it-fit.md#fix-a-repeated-mistake-with-orbitcorrect) explains how correct and reflect differ.

| Situation | Run |
| --- | --- |
| Claude made the same mistake again | `/orbit:correct <mistake>` |
| Learn from a session's corrections | `/orbit:reflect` |
| Turn your working style into a `-mode` skill | `/orbit:automate-me` |

### Prove it works

[Give the verifier a way to drive your app](guide/05-prove-and-ship.md#give-the-verifier-a-way-to-drive-your-app) explains what these write.

| Situation | Run |
| --- | --- |
| First time in a project users can run or install | `/orbit:create-verification-skill` |
| App changed, verify skill drifted | `/orbit:maintain-verification-skill` |

## What runs in the background

Claude runs these itself. You can also ask for the advisor. A Models table in your Workflow block routes each unit to one of your work types and can change any agent's model and effort with a row named after its role ([Route work by work type](guide/08-make-it-fit.md#route-work-by-work-type)).

| Agent | Model | Job |
| --- | --- | --- |
| poteto-agent | The row of the unit's work type. With no work type that fits, the `judgment` model (Opus by default) for the hardest changes, else the `code` model (your session's model by default). | Writes the code for each unit of a change, so no code is reviewed by the agent that wrote it. |
| gitops | Sonnet at `medium` effort, or the `gitops` row | Commits, pushes, PRs and merges. |
| comment-sicko | Your session's model | Deletes comments outside its keep list and flags the code they excuse, before review. |
| verifier | Your session's model at `high` effort, or the `verifier` row. No Edit or Write tools, in its own worktree. | Runs the change the way a user would before it lands, and returns PASS, PASS+NOTES or FAIL. It is never the agent that wrote the change. |
| advisor | Opus at `high` effort, or the `advisor` row. Read-only. | Gives a second opinion at the plan gate, when a change adds a module or touches more than 3 files. Ask for it any other time. |

When each runs:

- poteto-agent and comment-sicko run only inside the flow you start. The verifier runs only inside Shipping (at task end or `/orbit:ship`), autopilot-full and autopilot-stack.
- The advisor runs at the plan gate, or when you ask for it.
- As in pstack, the rest is opt-in. `/orbit:correct`, `/orbit:session-pickup`, `/orbit:reflect`, `/orbit:recall`, `/orbit:automate-me`, `/orbit:create-verification-skill` and `/orbit:maintain-verification-skill` run only when you type them.
- `/orbit:how` and `/orbit:why` run when you type them, when Claude matches a question to them, and inside the investigate and bug flows and `no-comments`.
- `/orbit:arena` runs when you type it, inside `/orbit:architect`, and in the feature flow on a choice with several valid shapes.
- `show-me-your-work` also runs when Claude sees long or unattended work.
- `/orbit:worktree-cleanup` runs when you type it, or when Claude matches "clean up worktrees" or "free up space".

## Principles

The playbook holds all 24 of pstack's principles, in pstack's five groups. [Steer with principles](guide/07-steer-with-principles.md) shows how to use their names.

| Group | Principles |
| --- | --- |
| Core | laziness protocol, foundational thinking, redesign from first principles, attack the premise, subtract before you add, minimize reader load, outcome-oriented execution, experience first, exhaust the design space, build the lever |
| Architecture | model the domain, boundary discipline, type-system discipline, make operations idempotent, migrate callers then delete legacy APIs, separate before serializing shared state |
| Verification | prove it works, fix root causes, sequence verifiable units, test behavior not implementation, explain the number |
| Delegation | guard the context window, never block on the human |
| Meta | encode lessons in structure |

## Project defaults

| Setting | Default |
| --- | --- |
| Check | `vpr check`, then `vpr build` and `vpr test` if those scripts exist |
| Land | `main`. Each change is built in a worktree under `.claude/worktrees/`, and Shipping fast-forwards `main` to it. |
| Review | `/orbit:interrogate` before shipping when the design is contested |

A project that differs adds a `## Workflow` block to its AGENTS.md, listing only what's different. Start from [`templates/workflow-block.md`](../templates/workflow-block.md). [Make orbit fit your project](guide/08-make-it-fit.md) explains each line and folder rules. [Build a change](guide/04-build-a-change.md#follow-the-stack-rules-for-typescript) covers stack rules.

## Auto-update

Claude Code leaves auto-update off for third-party marketplaces, so orbit stays on the version you installed. To turn it on:

1. Run `/plugin`.
2. Open the **Marketplaces** tab and select `orbit`.
3. Choose **Enable auto-update**.

To update once by hand, run `claude plugin update orbit@orbit`.
