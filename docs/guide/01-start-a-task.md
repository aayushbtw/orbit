# Start a task

Almost every piece of work in orbit begins with one command, `/orbit:start`, followed by what you want. Claude reads the goal, picks one of orbit's flows for it, writes that flow's steps as a todo list, and works through the list.

## Give the goal, not the steps

Describe the outcome you want and anything you already know. Leave the order of work to Claude.

```text
/orbit:start after login, users land on /home instead of the page they came from. the original URL is in the `next` query param.
```

That prompt names a symptom and a clue. It doesn't say "read the auth code, add logging, then patch the redirect". Orbit's flows already hold the order of steps, plus gates such as a fresh worktree and a plan review. A bug fix, for example, reproduces the bug before anyone writes a fix. If you list the steps yourself, you trade that order for one you made up on the spot.

The goal can be short. It only needs to be clear enough to act on. Claude asks you a question only when the goal itself is unclear.

```text
/orbit:start add a --json flag to the export command so scripts can read its output
```

## Claude picks the flow

The first thing `/orbit:start` does is sort the goal by what you ask for. Each kind of ask has its own playbook, because a question, a defect, and a slow endpoint need different work. A question needs evidence and no edits. A defect needs a reproduction before a fix. A slow path needs a baseline number before any change.

| You ask for | Flow | It ends with |
| --- | --- | --- |
| An answer to a question | `investigate` | A cited answer. Nothing changes. |
| A fix for something broken | `bug` | A shipped fix |
| New or changed behavior | `feature` | A shipped change |
| A new structure with the same behavior | `refactor` | A shipped change |
| A measured slowness, fixed once | `perf` | A shipped change, measured against a baseline |
| One metric moved toward a target over many rounds | `hillclimb` | One commit per accepted win |
| A call between designs | `prototype` | A recommendation and a throwaway sketch. Nothing ships. |
| Large or cross-cutting work, work you step away from, or work no flow fits | `/orbit:figure-it-out` | Phases it designs itself, with a decision log |
| "autopilot this queue" | `autopilot-full` | Each item merged by its own owner |
| "build the stack, I'll land it" | `autopilot-stack` | One verified stack of PRs that you land |
| A plan for work across phases or PRs | `multi-phase-plan` | A plan that waits for your go |
| "babysit this", "get it green" or "check on PR 42" | `babysit` | A merge-ready PR. It never merges. |
| Landing a green stack | `/orbit:ship` | The verified PRs, landed |

[Work while you're away](./06-hands-off.md) covers the autopilot flows and figure-it-out. [Prove it works, then ship](./05-prove-and-ship.md) covers Babysit and Shipping.

```text
/orbit:start rename UserRecord to Account across the server package. no behavior change.
```

```text
/orbit:start the search endpoint takes 900 ms on a cold cache. get it under 300.
```

The first is a `refactor`. The second is a `perf` task, because it names a slowness and a number to beat.

## The todo list is the playbook

Once the flow is picked, Claude loads its playbook and opens a todo list. The first items are the playbook's steps and gates, copied in word for word. Task-specific items come after them.

The list exists so you can see the whole run before it starts, and so no step disappears quietly. Claude may decide a step doesn't apply. That step stays in the list with a one-line `skip: <reason>`, where you can read it and disagree. Here is a shortened example for a small bug fix:

```text
[x] Worktree gate
[x] Plan gate. skip: the fix touches two files and adds no module
[ ] Delegate gate
[ ] 1. Reproduce it on the matching surface
[ ] 2. Binary-search the cause
[ ] 3. Plan the fix
[ ] 4. Verify on the same surface
[ ] 5. Stage the failing repro before the fix
[ ] 6. Run Opening a PR
```

The Plan gate applies only when a change adds a module or touches more than 3 files, so a two-file fix skips it in plain sight. If a skip looks wrong to you, say so.

For a change, the list continues past the flow's own steps. Opening a PR comes next. Then, unless you opted out, Babysit and Shipping. A `prototype` is the exception. It is throwaway, so it ends at its reply.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/docs-dark.svg">
  <img alt="Three swimlanes for you, Claude and subagents. You name the goal with /orbit:start. Claude picks the flow, a question stops at its answer, and a change gets a worktree off origin/main and an advisor check when it touches more than 3 files. For each unit, poteto-agent writes it, Claude reads and runs it, and gitops commits it. Then come interrogate on a contested design, deslop, comment-sicko and the PR or branch. If you said don't ship, the task stops with Next: /orbit:ship. Otherwise Babysit drives a PR to merge-ready under Land pr and a fresh verifier runs the change. On PASS, gitops lands it. On FAIL, nothing lands and the reply carries a repro. Dashed boxes run only when they apply." src="../diagrams/docs-light.svg">
</picture>

## A change ships by default

A change task doesn't stop at a branch for you to merge. It ships. Before anything lands, Shipping spawns a fresh verifier, an agent that did not write the code, to run the change the way a user would. Only a `PASS` or `PASS+NOTES` verdict lands. Green CI and an approving bot review don't count as a verdict, because neither one runs the change.

The verifier has to be a different agent because an author checks what it meant to build, not what it built. With that check in place, there is no reason to hand you a branch and ask you to merge it by hand.

To keep the change but land it yourself, put "don't ship" or "I'll land it" in the goal:

```text
/orbit:start add a --dry-run flag to the cleanup script. I'll land it.
```

The flow stays the same and stops at Opening a PR. You get the PR link, or under Land `main` the worktree path and branch. Run `/orbit:ship` when you're ready, and the same verifier runs first. [Make orbit fit your project](./08-make-it-fit.md) explains the Land line that picks between `pr` and `main`.

## Read the Next: line

Every task ends with one `Next:` line. It reports where things stand. It is never an offer. There are four forms:

- `Next: nothing pending.` The task is done. Start your next goal.
- `Next: /orbit:ship` You said "don't ship", so the PR or the unpushed branch waits for you. Run it to verify and land.
- `Next: /orbit:start <follow-up>` Something is outside the goal or needs your decision. The reply says which. Run it when you're ready.
- `Next: new session, then /orbit:session-pickup` The work was paused. Open a new session and run it there.

One fixed line means you never have to read a long reply to learn whether something waits on you. The README has the same four lines as a table.

## Steer a task in progress

Claude stays in the current todo list until it ends. Two short phrases move it:

- "continue" or "do it" resumes the list where it stopped.
- "new task" drops the current list and starts a fresh one for your next goal.

```text
new task. find out why the nightly export job skips accounts created after midnight UTC.
```

Without "new task", Claude reads your message against the list it is already running. The phrase makes the switch explicit, so a question about something else doesn't turn into the next step of an unrelated feature.

For the full command list, see [Every command](../usage.md#every-command) in the usage reference.

Next: [Understand code before you change it](./02-understand-code.md)
