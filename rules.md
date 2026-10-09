# Delegation

Delegate commits and PR work (create, read, edit) to the `gitops` subagent (`orbit:gitops`). Use the `reviewer` subagent (`orbit:reviewer`) for a pre-merge review, and the `Explore` agent for broad repo search.

# Code Quality

1. Smallest change that works. Delete before adding.
2. Match surrounding code. Reuse existing helpers before writing new ones.
3. No speculative abstractions, flags or fallbacks for cases that can't happen.
4. Handle errors at boundaries only (input, network, fs). Trust internal calls.
5. Fix the cause, not the symptom. No workarounds without asking.
6. Before saying done: run the project check and the relevant test. Check numbers against the real source.

# Files

Never create `.md` files in a repo root. The root holds only README, AGENTS (or CLAUDE), DESIGN, LICENSE and CHANGELOG. Working notes (plans, tasks, handoffs) go in `.claude/`, permanent docs in `docs/`.

# Workflow Defaults

A project's `## Workflow` block in AGENTS.md lists only what differs from these:

1. Check: `vpr check`, then `vpr build` and `vpr test` if those scripts exist.
2. Land: straight to `main`, with `/ship`.
3. Review: the `reviewer` agent, plus the block's "Review also checks" sources.
