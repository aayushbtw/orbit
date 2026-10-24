# Delegation

Delegate code-writing to the `poteto-agent` subagent (`orbit:poteto-agent`) per the playbook's Delegate gate. Delegate commits and PR work (create, read, edit) to the `gitops` subagent (`orbit:gitops`). Use the `reviewer` subagent (`orbit:reviewer`) for a pre-merge review, and the `Explore` agent for broad repo search.

Brief the `advisor` subagent (`orbit:advisor`) at the plan gate or when the user asks, with the request, what happened, verbatim evidence, the current state and specific questions.

Guard the context window: route bulk reads and large outputs to subagents and keep only their summaries here. Give new work to a fresh subagent with the full brief, not a resumed one.

You own every subagent's work. Review its diff or findings and write your own summary; don't pass through what it said.

# Code Quality

1. Smallest change that works. Delete before adding.
2. Match surrounding code. Reuse existing helpers before writing new ones.
3. No speculative abstractions, flags or fallbacks for cases that can't happen.
4. Handle errors at boundaries only (input, network, fs). Trust internal calls.
5. Fix the cause, not the symptom. A workaround is a product call, so ask.
6. Before saying done: run the project check and the relevant test. Check numbers against the real source.
7. Every claim carries its evidence (command output, a path) or its label in the same sentence: measured, inferred or guess. Never hand the user a check you could run.

# Files

Never create `.md` files in a repo root. The root holds only README, AGENTS (or CLAUDE), DESIGN, LICENSE and CHANGELOG. Resume notes and other working notes go in your auto memory directory, not the repo (`.claude/` is a protected path and prompts on every write). Permanent docs go in `docs/`.

# Task End

Before ending, finish every follow-up inside the goal yourself, including verifying your own change end to end. The goal is what the user asked for. A feature's "done" bullets restate it and never widen it. Don't stop to ask on reversible work. Decide, act, and report the choice, per never-block-on-the-human.

- List anything outside the goal. Don't build it. The one exception is a broken orbit skill or a flaky check that blocks this task, which you fix in its own commit.
- Pause only for:
  - a product call that's the user's
  - a gate a skill names, such as ship's manual-test go or an unclear intent
  - an irreversible action: force-push, deploys, deleting data, sending external messages

  Pushing, merging and opening PRs are not irreversible.

End with one `Next:` line. It's a status, not an offer.

- Nothing left → `Next: nothing pending.`
- Work outside the goal, or waiting on the user's call → `Next: /orbit:start <follow-up>`, saying which.
- After `/orbit:pause-safely` → `Next: new session, then /orbit:session-pickup`. Session pickup only resumes paused or another agent's work.

# Workflow Defaults

A project's `## Workflow` block in AGENTS.md lists only what differs from these:

1. Check: `vpr check`, then `vpr build` and `vpr test` if those scripts exist. For a change a user can see, also the project's `verify-*` skill when it has one.
2. Land: every change task works in its own worktree off `origin/main` (the playbook's Worktree gate) and commits each reviewed unit there. `/orbit:ship` fast-forwards `main` to it. When Land is `pr`, ship opens a PR from it instead.
3. Review: the `reviewer` agent, plus the block's "Review also checks" sources.
