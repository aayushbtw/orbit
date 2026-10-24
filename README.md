# orbit

A Claude Code plugin that runs every task through the same steps: pick the flow, build the smallest change, review it, ship it. Same steps in every repo, so you don't repeat yourself each session.

Orbit is mostly [pstack](https://github.com/cursor/plugins/tree/main/pstack) by [Lauren Tan](https://x.com/poteto), repackaged. The flows, the reviewer, the principles and most of the skills are hers. Orbit trims them, ports them from Cursor to Claude Code, and wires them to a set of defaults. For the original thinking, read pstack. [Credits](#credits) lists what came from where.

## Install

In Claude Code:

```
/plugin marketplace add aayushbtw/orbit
/plugin install orbit@orbit
```

The rules load on their own at the start of every session. Your own `CLAUDE.md` and `settings.json` stay yours.

Claude Code leaves auto-update off for third-party marketplaces, so orbit stays on the version you installed. To turn it on, run `/plugin`, open the **Marketplaces** tab, select `orbit`, and choose **Enable auto-update**. To update once by hand, run `claude plugin update orbit@orbit`.

## Use it

Start a task with `/orbit:start`. A change runs to `/orbit:ship`. Bulk reading goes to subagents, so the session stays lean across tasks.

```
/orbit:start fix the login redirect bug
```

Orbit picks the flow, writes its steps as a todo list, and works through them. A step can only be skipped in plain sight (`skip: <reason>`).

### A task, start to finish

```
/orbit:start <goal>
  1. Pick the flow      investigate, bug, feature, refactor or perf (investigate stops after answering)
  2. Worktree           a change gets its own git worktree, so parallel sessions never collide
  3. Plan gate          big change? the advisor reviews the plan first
  4. Build              a fresh poteto-agent writes each unit; Claude reviews and verifies it, gitops commits it
  5. /orbit:ship        checks, deslop, no-comments, reviewer on Opus and Sonnet, verifier, docs, lands on main or as a PR after CI, removes the worktree
  6. Next: line         one line telling you what to do next
```

Claude ends every task with one `Next:` line. Do what it says:

- `Next: nothing pending.` Run `/orbit:start` with your next goal.
- `Next: /orbit:start <follow-up>`. The follow-up is outside the goal or needs your decision. Claude says which. Run it when you're ready.
- `Next: new session, then /orbit:session-pickup`. Only after `/orbit:pause-safely`. Session pickup resumes paused work.

Mid-task, "continue" or "do it" resumes the todo list. "new task" starts a fresh one.

### Stopping and resuming

To stop in the middle of a task, say so or run `/orbit:pause-safely`. Claude finishes the current step, commits a `wip:` commit, saves a resume note outside the repo, and tells you the first action on resume. Pause before you switch model or close the session. "Keep going" or "don't stop" never pauses.

To resume, start a new session and run `/orbit:session-pickup`. It reads the last session's transcript, the git log and the resume note from that session, works out what is done and what is left, and carries on through `/orbit:start` or `/orbit:ship`. It doesn't redo finished work.

```
/orbit:pause-safely
(new session)
/orbit:session-pickup
```

### When to use what

| Situation | Run |
| --- | --- |
| Any new task: a bug, a feature, a refactor, a slow path | `/orbit:start <goal>` |
| You want a specific flow, or only its step list | `/orbit:playbook <investigate\|bug\|feature\|refactor\|perf>` |
| The change is built and you want it landed | `/orbit:ship` (`start` already ends with it) |
| You have to stop mid-task, switch model, or step away | `/orbit:pause-safely` |
| New session, continuing earlier work | `/orbit:session-pickup` |
| Catch up on your recent work across sessions | `/orbit:recall [topic]` |
| A long or unattended run you'll review later | `/orbit:show-me-your-work` |
| Turn your working style into a `-mode` skill | `/orbit:automate-me` |
| Find where the UI should (and shouldn't) animate | `/orbit:find-animation-opportunities` |
| Add motion to a component | `/orbit:animate <what>` |
| Review animation code in a diff | `/orbit:review-animations` |
| Audit a whole app's motion and plan fixes | `/orbit:improve-animations [quick\|deep]` |
| Claude made the same mistake again | `/orbit:correct <mistake>` |
| A session had several corrections and you want the skills to learn from them | `/orbit:reflect` |
| How a subsystem works, or where new code should live | `/orbit:how <subsystem>` |
| Why code is the way it is: rationale, regressions, history | `/orbit:why <code or decision>` |
| A question with no code change | `/orbit:start <question>` runs the read-only `investigate` flow and answers with citations |
| First time in a project users can run or install | `/orbit:verify-skill create` |
| The app changed and the verify skill drifted | `/orbit:verify-skill maintain` |

`/orbit:correct` fixes one mistake you name, at the highest level that works: removing the cause, then a type or lint rule, then a test, then a doc line. It also keeps a table of each rule and what enforces it. `/orbit:reflect` is broader. Three reviewers read the whole session, and you approve which skill edits to make. Items a lint or check would enforce better come back as `/orbit:correct` candidates.

### Correct usage

- Give `/orbit:start` the goal, not the steps. Orbit picks the flow and the steps.
- Don't land a change by hand. `/orbit:ship` runs the checks, the cleanup, the reviewer and the verifier, and a change never lands without them.
- Project differences (check command, PR landing, extra review sources) go in the project's `## Workflow` block, not in chat. See below.

## Let Claude prove its work

Tests passing isn't the same as the feature working. Run `/orbit:verify-skill create` once in a project. Claude reads the repo and writes `.claude/skills/verify-<project>/`:

- a small control script (`doctor`, start the app, drive it, save evidence, clean up), with JSON output and errors that say what to do next
- a feature map: one file per feature, saying how a user reaches it, the exact commands to drive it, and what proves it worked

Claude runs the new skill once end to end before handing it over. After that, ship's `verifier` uses it on every change that isn't docs-only and reports where the evidence is. The verifier is a fresh agent, not the main chat, so the change is never judged by the session that built it.

When the app changes, run `/orbit:verify-skill maintain`. It drives every feature, fixes the skill and map where they drifted, and reports real bugs instead of hiding them.

## What runs in the background

Claude runs these itself. You can also ask for the reviewer or the advisor.

- **poteto-agent**: writes the code for each unit of a change, so the code is never reviewed by the agent that wrote it.
- **gitops** (Sonnet): commits, PRs, and removing a landed worktree.
- **comment-sicko**: deletes comments outside its keep list and flags the code they excuse, before review.
- **reviewer** (read-only): checks the change against its intent before it lands, with pstack's review rubric and code-quality lens. Ship runs it twice, on Opus and Sonnet, and merges what both find. Looks for bugs, missed simplifications, TypeScript and React problems, patterns the next agent would copy, tests that check nothing, and AI-sounding prose.
- **verifier** (no Edit or Write tools): runs the change the way a user would before it lands and returns PASS, PASS+NOTES or FAIL. A fresh agent, never the one that wrote the change.
- **advisor** (Opus, read-only): a second opinion at the plan gate, when a change adds a module or touches more than 3 files. Ask for it any other time.

poteto-agent, the verifier and comment-sicko run only inside the flow you start. The reviewer and advisor run there too, or when you ask for them. As in pstack, the rest is opt-in: `/orbit:correct`, `/orbit:session-pickup`, `/orbit:reflect`, `/orbit:recall`, `/orbit:automate-me` and `/orbit:verify-skill` run only when you type them. `/orbit:how` and `/orbit:why` run when you type them, when Claude matches a question to them, and inside the investigate and bug flows and `no-comments`. `show-me-your-work` also runs when the playbook sees long or unattended work.

## Principles

The playbook holds thirteen of pstack's principles, each with the situation that triggers it: laziness protocol, subtract before you add, minimize reader load, model the domain, boundary discipline, type-system discipline, attack the premise, fix root causes, prove it works, test behavior not implementation, guard the context window, never block on the human, explain the number. Claude reads a principle only when its trigger fires, and adds one `Principles:` line to the reply, naming each one it applied and the choice it changed. Use the names to steer: "apply subtract before you add".

The same goes for the stack rules. Before writing TypeScript, Claude reads the TypeScript rules. Before writing React, it reads the Vercel React and composition indexes, then only the rule files that apply. Before writing animation, it reads `animate`. The reviewer checks the same rules again before the change lands, and checks motion against `review-animations`.

## Make it fit a project

Defaults assume [Vite+](https://viteplus.dev). `vpr check` must pass, plus `vpr build` and `vpr test` if those scripts exist. Each change is built in a worktree under `.claude/worktrees/` and fast-forwarded onto `main`. `.git/info/exclude` keeps the worktrees out of `git status`, and ship removes each one after it lands.

If a project differs, add a `## Workflow` block to its AGENTS.md. List only what's different:

```md
## Workflow

- Check: `vpr check`, plus `vpr e2e` when the UI changed.
- Land: `pr`
- Review also checks: `docs/architecture.md`.
```

`templates/workflow-block.md` has the template. The reviewer also reads any "Mistakes made before" list in the same file.

Rules for one folder go in an AGENTS.md (or CLAUDE.md) inside it, say `src/server/AGENTS.md` naming a library's guide. The reviewer and the plan gate read every such file above the files a change touches, plus `.claude/rules/` files whose `paths` match. The review lists each one as read or skipped, so a missed rule shows.

## Credits

Most of orbit is other people's work, all MIT:

- [pstack](https://github.com/cursor/plugins/tree/main/pstack) by [Lauren Tan](https://x.com/poteto):
  - the playbook flows, pause-safely and session-pickup
  - delegated coding with `poteto-agent`, worktree-per-task, the PR body sections and the independent verifier
  - the thirteen principles
  - the reviewer's filters and interrogate references (rubric, code-quality lens, lead judgment), Comment Sicko and `no-comments`
  - `/orbit:correct`, `/orbit:reflect`, `/orbit:recall`, `/orbit:automate-me`, `/orbit:verify-skill` and `show-me-your-work`
  - `/orbit:how` and `/orbit:why`
  - `unslop` and `typescript-best-practices`
- [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit): `deslop`.
- [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills): the React and composition rules.
- [emilkowalski/skills](https://github.com/emilkowalski/skills) by [Emil Kowalski](https://emilkowal.ski): `find-animation-opportunities`, `animate`, `review-animations` and `improve-animations`.

Orbit's own parts are the `/orbit:start` to `/orbit:ship` wiring and the project defaults. [Differences from pstack](docs/pstack-differences.md) lists where orbit departs from pstack's Claude Code port, and why.

## Maintain

- Develop without installing: `claude --plugin-dir ~/Projects/orbit`. Check with `claude plugin validate .`.
- Files copied verbatim or with small edits are tracked in `skills.json`. Update them with `/update-skills [name]` from this repo.
- The reviewer may ask once to read the plugin folder for the review rubric and React rules. Allow `Read(~/.claude/plugins/**)` to skip the prompt.
- Release: bump `version` in `.claude-plugin/plugin.json`.
