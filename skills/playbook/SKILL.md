---
name: playbook
description: Run the standard flow for a task type
argument-hint: investigate | bug | feature | refactor | perf | hillclimb
---
Task type: $ARGUMENTS

Follow Principles, Stack rules and only the matching task section. Check and Land come from the Workflow block in the project's AGENTS.md (or CLAUDE.md). Each section opens with its stance and ends with its **Reply:**, the content the final reply must hold.

Every section except `investigate` has these gates:
- **Worktree gate**, before the first edit: call `EnterWorktree` named `<type>-<slug>`, so parallel sessions never share a checkout. `<type>` is the commit type of the change (`feat`, `fix`, `refactor`, `perf`), and ship pushes a PR branch as `<type>/<slug>`. hillclimb and figure-it-out runs take the commit type of what they change (`perf` for a perf metric, else `feat`, `fix` or `refactor`). Skip the gate when the session is already in a worktree, unless it is dirty with unrelated work or snarled. Dirty branch with unrelated work: patch out, fresh worktree, apply. Snarled worktree: fresh worktree, redo minimally. For either, `ExitWorktree` with `keep` first, then run the gate again with a new slug. Ship keeps landed branches, so if `<type>/<slug>` already exists locally or on `origin`, pick a new slug. Before entering, if `git check-ignore -q .claude/worktrees` fails, append `.claude/worktrees` to `.git/info/exclude`. After entering, install dependencies when the project has a lockfile (`vp install`).
- **Plan gate**, before editing: if the change adds a module or touches more than 3 files, read the project sources for the paths it touches (as the `reviewer`'s step 2 finds them), then brief the `advisor` with the plan and those sources, and act on its verdict.
- **Delegate gate**: you plan, review and verify. A fresh `orbit:poteto-agent` writes the code, one verifiable unit at a time. Brief each with this file's absolute path, the absolute worktree path, the file paths, the named data shape, the behavior to reach or hold, and the check that proves it. Review its diff, confirm its changed paths match the brief, verify, then have gitops commit that unit by path before the next delegate starts. This is mandatory. The gain is review separation, not lines saved, so size never skips it. A fix round is a fresh delegate with the original brief, every later directive, your findings and the current diff. Ship's cleanup and review fixes are yours to make. Parallel delegates (hillclimb and figure-it-out fan-out) are the one exception to one at a time. Spawn each with the `Agent` tool's `isolation: "worktree"` and brief it with that worktree, not the task's. For each attempt you keep, gitops commits it there by path and cherry-picks the commit onto the task branch.
- **Land gate**, the last step: run /orbit:ship. It checks, runs the `reviewer` panel and an independent `verifier`, and lands. A change never lands without it.

Long, autonomous or multi-phase work, or a task the user steps away from: read `${CLAUDE_PLUGIN_ROOT}/skills/show-me-your-work/SKILL.md` and keep its decision trail.
Running a benchmark, measuring perf yourself, or reporting a speedup or regression you measured: read `${CLAUDE_PLUGIN_ROOT}/skills/benchmark-checklist/SKILL.md` before you report or act on the number.

## Principles

Read the leaf in full for any principle you apply: `${CLAUDE_PLUGIN_ROOT}/skills/principle-<name>/SKILL.md`. In the reply, one line names each principle that shaped a decision and the choice it changed (`Principles: <name> -> <choice>`). Cite only leaves read this session.

- **laziness-protocol.** Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading. Bias to deletion and the smallest change that solves the problem.
- **subtract-before-you-add.** Sequencing an addition, refactor, or rewrite. Remove dead weight first, then build on the simpler base.
- **minimize-reader-load.** Reviewing or shaping code that's hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.
- **model-the-domain.** Writing stateful logic, or code that branches a lot or repeats a shape assumption across files. Encode the domain in a structure (state machine, typed model, table or registry, reducer, boundary, the right collection) instead of scattered conditionals.
- **boundary-discipline.** Wiring validation, error handling, or framework adapters. Guards at system boundaries, trust internal types, keep business logic pure.
- **type-system-discipline.** Designing types or a signature in any typed language. Make illegal states unrepresentable, brand primitives, parse external data at boundaries.
- **attack-the-premise.** Two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it.
- **fix-root-causes.** Debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.
- **prove-it-works.** After a task, before declaring done. Verify against the real artifact, not a proxy or "it compiles".
- **test-behavior-not-implementation.** Writing, changing, or keeping a test. Assert what the code's users can observe, so the test fails when that behavior breaks and keeps passing when only the internals change.
- **guard-the-context-window.** Context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents. Keep summaries in the main thread, not raw payloads.
- **never-block-on-the-human.** Tempted to ask "should I do X?" on reversible work. Proceed, present the result, let the human course-correct.
- **explain-the-number.** Before you trust, report, or act on a number you measured. Find what limits it, and rule out that it measured something other than the work you think.

## Stack rules

Before writing code that matches a line below, read its index, then open only the rule files that apply:
- `.ts` or `.tsx`: `${CLAUDE_PLUGIN_ROOT}/skills/typescript-best-practices/SKILL.md`.
- React components, hooks, context or data fetching: `${CLAUDE_PLUGIN_ROOT}/skills/vercel-react-best-practices/SKILL.md` and `${CLAUDE_PLUGIN_ROOT}/skills/vercel-composition-patterns/SKILL.md`. Skip Next.js-only rules in other frameworks.
- Animation or motion (transitions, keyframes, Motion props, gestures): `${CLAUDE_PLUGIN_ROOT}/skills/animate/SKILL.md`, and its RECIPES.md when a recipe matches.

## investigate
**You own the answer. Plan, route, write.**

Investigation requests are read-only. They produce a cited explanation or a recommendation, not a code change.
1. Route through `/orbit:how`. For motivation questions, also route through `/orbit:why`.
2. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only investigation`.
3. Produce the `how`-shaped output (Overview / Key Concepts / How It Works / Where Things Live / Gotchas), or a recommendation with a tradeoffs table if the request is a decision between alternatives.
4. Apply `/orbit:unslop` to the reply.

No commit, no `/orbit:ship`, no `/orbit:architect` unless the investigation precedes a code change. If it does, hand back to the user and re-route to bug or feature (`/orbit:start <goal>`).

**Reply:** the investigation output. For "are we sure?" answers, include your real judgment with reasons. Push back if the premise is wrong.

## bug
**You own this task. Plan, review, verify.** Delegate investigation and the fix to subagents, stay in the lead.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.
1. Reproduce it yourself on the matching surface via the project's `verify-*` skill when it has one, even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `/orbit:how` over the affected subsystem and `/orbit:why` for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with `/loop`. Confirm the surviving *mechanism* with runtime evidence before the step-3 `/orbit:architect`/`/orbit:interrogate` fan-out.
3. Plan the fix. If it crosses a function boundary, `/orbit:architect` first. Delegate implementation to a fresh `orbit:poteto-agent` per the Delegate gate, with a specific scope. The failing repro is its own unit, committed before the fix unit (step 5).
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history, the failing test first and the fix on top. See `${CLAUDE_PLUGIN_ROOT}/skills/tdd/SKILL.md` for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
6. Run the Land gate.

**Reply:** what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.

## feature
**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.
1. State "done" in 3 bullets. Ask only if a real decision is missing.
2. `/orbit:how` over the affected subsystem.
3. `/orbit:architect` for parallel design exploration. If the design is contested, `/orbit:interrogate` its sketch before the delegate starts.
4. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target. Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
5. Delegate code-writing to a fresh `orbit:poteto-agent` per the Delegate gate, with a specific scope (file paths, named data shape and its organizing structure per model-the-domain, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), run `/orbit:architect` on that choice first so its runners surface the alternatives and its synthesis guards the pick. Mandatory: no skip-with-reason escape, and laziness-protocol does not override it (the gain is review separation, not lines saved). No "standing by" reply that waits on a nested agent. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. gitops commits each reviewed unit, per the gate.
6. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
7. Stack follow-ups, building, verifying, and committing each small unit before the next.
8. Run the Land gate.

Code-coupled work (one feature, one migration) goes to the parent as single owner, with the checkpoint inline and one `orbit:poteto-agent` per unit under the Delegate gate. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Those write no code, so they run as read-only agents outside the Delegate gate. Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.

## refactor
**You own the contract. The structure changes. The behavior does not.** Distinct from feature, which adds behavior, and bug, which corrects it.

If the cleanup reveals a missing feature or a real bug, split it out and ship the structural change first against the pinned contract. A redesign is allowed, but name it and route to feature. Large or cross-cutting structural work belongs to `/orbit:figure-it-out`. This flow is the focused-to-medium change.
1. Pin the behavior contract first. Run `/orbit:how` over the affected subsystem to learn the contract, then write a characterization test, snapshot, or equivalence harness that captures current behavior before any structure moves. If the area has no coverage, write the pin before touching structure. Type check and lint are not a pin.
2. Name the structure the code is missing per model-the-domain. Boring code stays when the shape is already clear and local. The reshape must delete branches or invalid states, not add indirection.
3. Name the target shape. State what the module layout, types, and call graph should be if built today. If the target crosses a function boundary, run `/orbit:architect` for parallel design exploration of the shape before the move.
4. Subtract before you add. Delete dead code, collapse one-caller wrappers, drop redundant validators, and remove orphan references before introducing the new shape (**subtract-before-you-add**). The smallest change that reaches the target shape ships (**laziness-protocol**). A speculative cleanup that "might help" gets reverted.
5. Move in small behavior-preserving steps, each keeping the pin green. For API reshapes, migrate every caller and delete the old API in the same wave. No compatibility shims, no parallel old-and-new paths. Spot-check every rename against the actual files. Renames silently miss usages in strings, prose, and back-references. Delegate the mechanical edits to a fresh `orbit:poteto-agent` per the Delegate gate, with a specific scope (file paths, the names being moved, the behavior to hold). Delegate the units in step 8's order.
6. Prove behavior is unchanged on the real artifact, not "it compiles" (**prove-it-works**). For larger reshapes, run an equivalence check: a script that diffs old-vs-new outputs, a recorded baseline replayed against the new code, or a smoke run on the matching surface via the project's `verify-*` skill.
7. Confirm the change is worth keeping. The success measure is reduced reader load (**minimize-reader-load**). If the diff does not lower reader load somewhere, revert it.
8. Commits land in this order: a subtraction commit, then the reshape, then any follow-on cleanup, so each behavior-preserving slice stays green before the next. Run the Land gate.

**Reply:** the structure that changed, the pin you held it against, the equivalence proof, the reader-load delta, what shipped and what got reverted. No new behavior.

## perf
**You own the measurement story. Plan, review, verify the numbers.** Tie every fix to a measurement, don't read source instead of measuring.
1. Capture a baseline trace via the project's `verify-*` skill when it has one. Save the raw output under `$TMPDIR/orbit-perf/<slug>/`, outside the worktree, since ship removes it. Vet the baseline, and each later number, with `${CLAUDE_PLUGIN_ROOT}/skills/benchmark-checklist/SKILL.md`.
2. `/orbit:how` to ground hypotheses. Don't claim a perf ceiling without running it first.
   Try the performance mantras in order, cheapest first:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.

   When an earlier mantra meets the target, stop.
3. Plan the fix from the trace. If it crosses a function boundary, `/orbit:architect` first. Delegate implementation to a fresh `orbit:poteto-agent` per the Delegate gate. Review the diff. Capture a post-fix trace, saved next to the baseline. Verify each attempt before trying the next.
4. Parse and compare the artifacts (JSON to sqlite, diff). "Inconclusive" or wrong-surface is not a pass. Flag it.
5. Cite the measurement in the PR body when Land is `pr`, else in the reply.
6. Run the Land gate.

For sustained improvement against a metric rather than a one-off fix, use the hillclimb flow (`/orbit:playbook hillclimb`).

**Reply:** baseline number, post-fix number, delta, artifact path.

## hillclimb
**You own the metric and the experiment's integrity. Supervise and review. Delegate the attempts.** For sustained, iterative improvement of one measurable thing against a target. A one-off fix is bug or perf. This is the loop. Core discipline: one change, one measurement, keep or revert. Never stack untested changes, and never claim a win from code inspection, per prove-it-works.
1. Ground the workload and architecture before choosing the metric. Run `/orbit:how` over the target, name the realistic workload dimensions that can move the result (data size, history, state, concurrency), and select a case that reproduces the user's complaint. If no case reproduces it, fix the repro instead of hillclimbing. Then fix one metric, the direction that counts as better, and a checkable stop predicate that pairs a target with a floor on attempts so a lucky early win can't end the run (the example "at least 50% better than baseline and at least 10 iterations" is this shape). Use the user's numbers when given, otherwise agree them.
2. Build the measurement harness, prove its sensitivity, then freeze it. Run contrasting realistic workloads and confirm the target case reproduces the symptom while easier cases separate as expected. If the harness cannot distinguish them, revise the workload or metric. Vet the harness with `${CLAUDE_PLUGIN_ROOT}/skills/benchmark-checklist/SKILL.md` before you freeze it, and make it print its error count and a count of the work done. Once frozen, one repeatable command emits the metric, sampled enough to clear the noise (median of N, not a single run). Record the baseline metric and a green run of the regression gate (the tests that must keep passing) before any change.
3. Open the decision log via `/orbit:show-me-your-work` (read `${CLAUDE_PLUGIN_ROOT}/skills/show-me-your-work/SKILL.md`). A `decision.tsv`, one row per attempt: id, hypothesis, change, before, after, delta, tests, verdict (kept or reverted), note. Read it before each attempt. Keep it out of the tree, under `$TMPDIR/orbit-perf/<slug>/`, since ship deletes the worktree.
4. Ground each hypothesis in the architecture model from step 1, so it names a specific mechanism ("defer X off the boot path because it blocks first paint"), not "try memoizing something". For a perf metric, order hypotheses by the performance mantras in step 2 of the perf flow. Borrow only their order, not that step's stop rule.
5. Loop, one hypothesis per iteration:
   - Hand the change to a fresh `orbit:poteto-agent` per the Delegate gate, with a tight scope. Supervise and review the diff rather than typing it, per guard-the-context-window. When several independent hypotheses are live, fan them to parallel delegates, each in its own worktree per the Delegate gate's parallel exception.
   - Measure before and after with the frozen harness, and run the regression gate.
   - Accept only when the metric moves past noise and the gate stays green. Otherwise revert the change in full. A tweak that "might help" is not kept.
   - One gitops commit per accepted fix, by path. A rejected attempt is reverted in full and only logged. Log the row either way, kept or reverted.
   Each iteration ends in a check before the next begins. If the run is unattended, borrow only the wake mechanism of `/loop`, not a stop rule.
6. Push past the first plateau. On a stall, several rejects in a row, pivot category, combine near-misses, re-read the source, or try something more radical before concluding the hill is climbed. Correctness and simplicity outrank the number. Revert a win that breaks behavior, and keep a simplification that holds the number, per laziness-protocol.
7. Stop when the predicate is met, or when the remaining ideas are marginal and not worth their cost. Don't relax the predicate to meet it, and don't quit while cheap untried hypotheses remain. If you are stuck, surface it instead of spinning.
8. Run the Land gate with the accepted commits stacked in the order they landed.

**Reply:** the metric and target, baseline to final with the percent delta, iterations run (kept vs reverted), each accepted fix on one line, the `decision.tsv` path, and the best idea you would try next if pushed further.
