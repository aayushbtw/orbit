# Using orbit

The detail behind the [README](../README.md).

## A task, start to finish

Start a task with `/orbit:start`. A change runs to `/orbit:ship`. Bulk reading goes to subagents, so the session stays lean across tasks.

```
/orbit:start fix the login redirect bug
```

Orbit picks the flow, writes its steps as a todo list, and works through them. A step can only be skipped in plain sight (`skip: <reason>`).

1. **Pick the flow.** `investigate`, `bug`, `feature`, `refactor`, `perf` or `hillclimb`. `investigate` stops after answering. Large or cross-cutting work, work you step away from, and work no flow fits go to `/orbit:figure-it-out`, which designs its own steps.
2. **Worktree.** A change gets its own git worktree, so parallel sessions never collide.
3. **Plan gate.** When a change adds a module or touches more than 3 files, the advisor reviews the plan first.
4. **Build.** A fresh poteto-agent writes each unit. Claude reviews and verifies it, and gitops commits it.
5. **`/orbit:ship`.** Checks, deslop, no-comments, the reviewer on Opus and Sonnet, the verifier and docs. It lands on `main` or as a PR after CI, then removes the worktree.
6. **`Next:` line.** One line telling you what to do next.

A question with no code change also goes through `/orbit:start <question>`. It runs the read-only `investigate` flow and answers with citations.

Mid-task, "continue" or "do it" resumes the todo list. "new task" starts a fresh one.

## Every command

### Do a task

| Situation | Run |
| --- | --- |
| Any new task (a bug, a feature, a refactor, a slow path), or a question with no code change | `/orbit:start <goal>` |
| A specific flow, or only its step list | `/orbit:playbook <investigate\|bug\|feature\|refactor\|perf\|hillclimb>` |
| Improve one metric over many rounds, toward a target | `/orbit:playbook hillclimb`, or `/orbit:start` with a metric goal |
| Large or cross-cutting work, or work you step away from | `/orbit:figure-it-out <goal>` (`/orbit:start` routes there too) |
| Change is built, land it | `/orbit:ship` (`start` already ends with it) |
| Stop mid-task, switch model, step away | `/orbit:pause-safely`, then `/orbit:session-pickup` in a new session. See [stopping and resuming](#stopping-and-resuming). |
| A long or unattended run you'll review later | `/orbit:show-me-your-work` |
| Disk is tight, or worktrees have piled up | `/orbit:worktree-cleanup` |

### Understand code

| Situation | Run |
| --- | --- |
| How a subsystem works, where new code goes | `/orbit:how <subsystem>` |
| Why code is the way it is: rationale, regressions, history | `/orbit:why <code or decision>` |
| Design the shape before writing code | `/orbit:architect <what>` |
| Adversarial review of a change or sketch | `/orbit:interrogate` |
| Catch up on recent work across sessions | `/orbit:recall [topic]` |

### Improve Claude

See [correct vs reflect](#correct-vs-reflect).

| Situation | Run |
| --- | --- |
| Claude made the same mistake again | `/orbit:correct <mistake>` |
| Learn from a session's corrections | `/orbit:reflect` |
| Turn your working style into a `-mode` skill | `/orbit:automate-me` |

### Prove it works

See [let Claude prove its work](#let-claude-prove-its-work).

| Situation | Run |
| --- | --- |
| First time in a project users can run or install | `/orbit:create-verification-skill` |
| App changed, verify skill drifted | `/orbit:maintain-verification-skill` |

## Stopping and resuming

To stop in the middle of a task, say so or run `/orbit:pause-safely`. Claude finishes the current step, commits a `wip:` commit, saves a resume note outside the repo, and tells you the first action on resume. Pause before you switch model or close the session. "Keep going" or "don't stop" never pauses.

To resume, start a new session and run `/orbit:session-pickup`. It reads the last session's transcript, the git log and the resume note from that session. It works out what is done and what is left, and carries on through `/orbit:start` or `/orbit:ship`. It doesn't redo finished work.

```
/orbit:pause-safely
(new session)
/orbit:session-pickup
```

## Correct vs reflect

`/orbit:correct <mistake>` fixes one mistake you name, at the highest level that works. In order: remove the cause, then a type or lint rule, then a test, then a doc line. It also keeps a table of each rule and what enforces it.

`/orbit:reflect` is broader. Three reviewers read the whole session, and you approve which skill edits to make. Items a lint or check would enforce better come back as `/orbit:correct` candidates.
## Let Claude prove its work

Tests passing isn't the same as the feature working. Run `/orbit:create-verification-skill` once in a project users can run or install. Claude reads the repo and writes `.claude/skills/verify-<app>/`:

- a SKILL.md with six sections. Launch starts the app and says how to tell it's ready. Doctor is one read-only health check. Drive uses the repo's real selectors and commands. Evidence says what to capture and where it goes. Cleanup tears down only what the run started and keeps the evidence. Helpers shows how to run any script the skill ships.
- a feature map in `features/`: an index plus one file per feature, saying how a user reaches it, how to drive it, and what end state proves it worked

Claude runs the new skill once end to end before handing it over. After that, ship's `verifier` uses it on every change that isn't docs-only and reports where the evidence is. The verifier is a fresh agent, not the main chat, so the change is never judged by the session that built it.

When the app changes, run `/orbit:maintain-verification-skill`. It reads each feature's source in parallel, drives every feature live, fixes the skill and map where they drifted, and reports real bugs instead of hiding them.

## What runs in the background

Claude runs these itself. You can also ask for the reviewer or the advisor.

- **poteto-agent**: writes the code for each unit of a change, so the code is never reviewed by the agent that wrote it.
- **gitops** (Sonnet): commits, PRs, and removing a landed worktree.
- **comment-sicko**: deletes comments outside its keep list and flags the code they excuse, before review.
- **reviewer** (read-only): checks the change against its intent before it lands, with pstack's review rubric and code-quality lens. Ship runs it twice, on Opus and Sonnet, and merges what both find. Looks for bugs, missed simplifications, TypeScript problems, patterns the next agent would copy, tests that check nothing, and AI-sounding prose.
- **verifier** (no Edit or Write tools): runs the change the way a user would before it lands and returns PASS, PASS+NOTES or FAIL. A fresh agent, never the one that wrote the change.
- **advisor** (Opus, read-only): a second opinion at the plan gate, when a change adds a module or touches more than 3 files. Ask for it any other time.

When each runs:

- poteto-agent, the verifier and comment-sicko run only inside the flow you start.
- The reviewer and advisor run there too, or when you ask for them.
- As in pstack, the rest is opt-in. `/orbit:correct`, `/orbit:session-pickup`, `/orbit:reflect`, `/orbit:recall`, `/orbit:automate-me`, `/orbit:create-verification-skill` and `/orbit:maintain-verification-skill` run only when you type them.
- `/orbit:how` and `/orbit:why` run when you type them, when Claude matches a question to them, and inside the investigate and bug flows and `no-comments`.
- `show-me-your-work` also runs when the playbook sees long or unattended work.
- `/orbit:worktree-cleanup` runs when you type it, or when Claude matches "clean up worktrees" or "free up space".

## Principles

The playbook holds thirteen of pstack's principles, each with the situation that triggers it:

- laziness protocol
- subtract before you add
- minimize reader load
- model the domain
- boundary discipline
- type-system discipline
- attack the premise
- fix root causes
- prove it works
- test behavior not implementation
- guard the context window
- never block on the human
- explain the number

Claude reads a principle only when its trigger fires. It adds one `Principles:` line to the reply, naming each one it applied and the choice it changed. Use the names to steer: "apply subtract before you add".

## Stack rules

Stack rules work like principles. Before writing TypeScript, Claude reads the TypeScript rules. The reviewer checks the same rules again before the change lands.

## Project defaults

Defaults assume [Vite+](https://viteplus.dev). `vpr check` must pass, plus `vpr build` and `vpr test` if those scripts exist. Each change is built in a worktree under `.claude/worktrees/` and fast-forwarded onto `main`. `.git/info/exclude` keeps the worktrees out of `git status`, and ship removes each one after it lands.

A project that differs adds a `## Workflow` block to its AGENTS.md, listing only what's different. `templates/workflow-block.md` has the template. Its `Before code` line holds the guidance for writing code under a path, one `<path>: <source>` entry per file or skill load command. Claude copies the matching entries into each code delegate's brief and both reviewer briefs. Delegates load them before writing, and the reviewer never skips them. The reviewer also reads any "Mistakes made before" list in the same file.

## Folder rules

Rules for one folder go in an AGENTS.md (or CLAUDE.md) inside it, say `src/server/AGENTS.md` naming a library's guide. The reviewer and the plan gate read every such file above the files a change touches, plus `.claude/rules/` files whose `paths` match. The review lists each one as read or skipped, so a missed rule shows.

## Credits in full

Most of orbit is other people's work, all MIT. Orbit trims it, ports it from Cursor to Claude Code, and wires it to a set of defaults. For the original thinking, read pstack.

- [pstack](https://github.com/cursor/plugins/tree/main/pstack) by [Lauren Tan](https://x.com/poteto):
  - the playbook flows (hillclimb included), `/orbit:figure-it-out`, pause-safely, session-pickup and worktree-cleanup
  - delegated coding with `poteto-agent`, worktree-per-task, the PR body sections and the independent verifier
  - the thirteen principles
  - the reviewer's filters, `/orbit:architect`, `/orbit:interrogate` and its references (rubric, code-quality lens, lead judgment), Comment Sicko and `no-comments`
  - `/orbit:correct`, `/orbit:reflect`, `/orbit:recall`, `/orbit:automate-me`, `/orbit:create-verification-skill`, `/orbit:maintain-verification-skill` and `show-me-your-work`
  - `/orbit:how` and `/orbit:why`
  - `unslop`, `typescript-best-practices`, `tdd` and `benchmark-checklist`
- [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit): `deslop`.

## Install notes

The rules load on their own at the start of every session. Your own `CLAUDE.md` and `settings.json` stay yours.
## Auto-update

Claude Code leaves auto-update off for third-party marketplaces, so orbit stays on the version you installed. To turn it on:

1. Run `/plugin`.
2. Open the **Marketplaces** tab and select `orbit`.
3. Choose **Enable auto-update**.

To update once by hand, run `claude plugin update orbit@orbit`.
