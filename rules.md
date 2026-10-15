# Delegation

Delegate commits and PR work (create, read, edit) to the `gitops` subagent (`orbit:gitops`). Use the `reviewer` subagent (`orbit:reviewer`) for a pre-merge review, and the `Explore` agent for broad repo search.

Brief the `advisor` subagent (`orbit:advisor`) at the plan gate or when the user asks, with the request, what happened, verbatim evidence, the current state and specific questions.

You own every subagent's work. Review its diff or findings and write your own summary; don't pass through what it said.

# Code Quality

1. Smallest change that works. Delete before adding.
2. Match surrounding code. Reuse existing helpers before writing new ones.
3. No speculative abstractions, flags or fallbacks for cases that can't happen.
4. Handle errors at boundaries only (input, network, fs). Trust internal calls.
5. Fix the cause, not the symptom. No workarounds without asking.
6. Before saying done: run the project check and the relevant test. Check numbers against the real source.
7. Every claim carries its evidence (command output, a path) or its label in the same sentence: measured, inferred or guess. Never hand the user a check you could run.

# Files

Never create `.md` files in a repo root. The root holds only README, AGENTS (or CLAUDE), DESIGN, LICENSE and CHANGELOG. Resume notes and other working notes go in your auto memory directory, not the repo (`.claude/` is a protected path and prompts on every write). Permanent docs go in `docs/`.

# Task End

When a task is done, end with one `Next:` line. It's a status line, not an offer. Any follow-up you know of counts as open, even if nothing is mid-edit; if you'd name it when asked "what's next?", it's open.

- Nothing open → `Next: nothing pending; /clear for the next task.`
- Anything open → `Next: /clear, then /orbit:pickup`.
- Next task builds on this context → `Next: /orbit:start <task>` (no /clear), instead of the line above.

# Workflow Defaults

A project's `## Workflow` block in AGENTS.md lists only what differs from these:

1. Check: `vpr check`, then `vpr build` and `vpr test` if those scripts exist. For a change a user can see, also the project's `verify-*` skill when it has one.
2. Land: straight to `main`, with `/orbit:ship`. When Land is `pr`, cut `<type>/<slug>` off an up-to-date `main` before the first edit, and commit each working piece on it.
3. Review: the `reviewer` agent, plus the block's "Review also checks" sources.
