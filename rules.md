# Delegation

Delegate commits and PR work (create, read, edit) to the `gitops` subagent (`orbit:gitops`). Use the `reviewer` subagent (`orbit:reviewer`) for a pre-merge review, and the `Explore` agent for broad repo search.

Consult the `advisor` subagent (`orbit:advisor`) before building a change that adds a module or touches more than 3 files, after two failed attempts, and before declaring a non-trivial task done. A change never lands without the `reviewer`. Brief it with the request, what happened, verbatim evidence, the current state and specific questions.

# Code Quality

1. Smallest change that works. Delete before adding.
2. Match surrounding code. Reuse existing helpers before writing new ones.
3. No speculative abstractions, flags or fallbacks for cases that can't happen.
4. Handle errors at boundaries only (input, network, fs). Trust internal calls.
5. Fix the cause, not the symptom. No workarounds without asking.
6. Before saying done: run the project check and the relevant test. Check numbers against the real source.

# Files

Never create `.md` files in a repo root. The root holds only README, AGENTS (or CLAUDE), DESIGN, LICENSE and CHANGELOG. Handoffs and other working notes go in your auto memory directory, not the repo (`.claude/` is a protected path and prompts on every write). Permanent docs go in `docs/`.

# Task End

When a task is done, end with one `Next:` line. It's a status line, not an offer. Any follow-up you know of counts as open, even if nothing is mid-edit; if you'd name it when asked "what's next?", it's open.

- Nothing open → `Next: nothing pending; /clear for the next task.` No handoff needed.
- Anything open → write the project's handoff note first (as `/orbit:handoff` does), then `Next: /clear, then /orbit:pickup`.
- Next task builds on this context → continue here: <task>.

# Workflow Defaults

A project's `## Workflow` block in AGENTS.md lists only what differs from these:

1. Check: `vpr check`, then `vpr build` and `vpr test` if those scripts exist. For a change a user can see, also the project's `verify-*` skill when it has one.
2. Land: straight to `main`, with `/orbit:ship`. When Land is `pr`, cut `<type>/<slug>` off an up-to-date `main` before the first edit, and commit each working piece on it.
3. Review: the `reviewer` agent, plus the block's "Review also checks" sources.
