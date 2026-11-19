# Bash

**One plain command per Bash call.** Claude Code's worktree guard refuses heredocs, `&&` chains around git, shell variables and `$(...)` in arguments, and loops as too complex to verify. Write a script with the Write tool and run it, use `git -C <path>`, and split the rest into separate calls. A session isolated in a worktree, after `EnterWorktree` and in every subagent it spawns, may run git only in its own worktree, so the guard refuses `git -C` or `cd` into another checkout. That git waits until Shipping step 7, where the session leaves with `ExitWorktree` and `keep`. Never leave earlier to run it.

# Code Quality

1. Smallest change that works. Delete before adding.
2. Match surrounding code. Reuse existing helpers before writing new ones.
3. No speculative abstractions, flags or fallbacks for cases that can't happen.
4. Handle errors at boundaries only (input, network, fs). Trust internal calls.
5. Fix the cause, not the symptom.
6. Before saying done: run the project check and the relevant test. Check numbers against the real source.

# Files

Never create `.md` files in a repo root. The root holds only README, AGENTS (or CLAUDE), DESIGN, LICENSE and CHANGELOG. Resume notes and other working notes go in your auto memory directory, not the repo (`.claude/` is a protected path and prompts on every write). Permanent docs go in `docs/`.

# Comments

Comments use short declarative sentences, with no long-dash character and no colon joining two clauses. Write them clean as you go. Keep a comment only for a non-obvious *why* the code can't show. A verify or test script gets no phase-narrating comments such as `// Phase 1: add cards`. The assertion or log string documents the step, as in `assert(ok, 'persisted across restart')`. This applies to every file you produce, including the delegate's diff.
