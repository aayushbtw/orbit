---
name: playbook
description: Run the standard flow for a task type
argument-hint: investigate | bug | feature | refactor | perf | hillclimb
---
Task type: $ARGUMENTS

Follow Principles, Stack rules and only the matching task section. Check and Land come from the Workflow block in the project's AGENTS.md (or CLAUDE.md). Each section opens with its stance and ends with its **Reply:**, the content the final reply must hold.

Every section except `investigate` has these gates:
- **Worktree gate**, before the first edit: call `EnterWorktree` named `<type>-<slug>`, so parallel sessions never share a checkout. `<type>` is the commit type of the change (`feat`, `fix`, `refactor`, `perf`), and ship pushes a PR branch as `<type>/<slug>`. hillclimb and figure-it-out runs take the commit type of what they change (`perf` for a perf metric, else `feat`, `fix` or `refactor`). Skip the gate when the session is already in a worktree. Before entering, if `git check-ignore -q .claude/worktrees` fails, append `.claude/worktrees` to `.git/info/exclude`. After entering, install dependencies when the project has a lockfile (`vp install`).
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
**You own the answer.** Read-only: a cited explanation or a recommendation, not a code change.
1. Run `/orbit:how` on the part in question. For motivation or history questions, also run `/orbit:why`. Cite `path:line` for each claim.
2. For a choice between options, give a recommendation and a tradeoffs table. If the premise is wrong, say so.
3. If the answer leads to a code change, stop, give the answer, and name the change as the next `/orbit:start <goal>`.

**Reply:** the answer with citations, or the recommendation with its tradeoffs. No commit.

## bug
**Every shipped line traces to runtime evidence.** A change that "might help" is a hypothesis, not a fix. When evidence refutes a hypothesis, revert what it motivated.
1. Reproduce it yourself on the matching surface via the project's `verify-*` skill when it has one, even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form candidate hypotheses, seeded by `/orbit:how` over the subsystem and `/orbit:why` for its regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with `/loop`. Confirm the surviving mechanism with runtime evidence before planning the fix.
3. Fix the cause, not the symptom, per fix-root-causes. If the fix crosses a function boundary, run `/orbit:architect` first. Stage the commits so the failing repro lands before the fix in git history. See `${CLAUDE_PLUGIN_ROOT}/skills/tdd/SKILL.md` for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
4. Confirm the repro passes and the check is green. Unit tests show branch behavior, not bug absence.

**Reply:** what was broken, the root cause, the fix, how you verified. Paste the failing-then-passing output verbatim.

## feature
**You own the design.**
1. State "done" in 3 bullets. Ask only if a real decision is missing.
2. Run `/orbit:how` over the affected subsystem. Read the nearest similar code and match it.
3. Run `/orbit:architect` for parallel design exploration, through its synthesized sketch. If the design is contested, run `/orbit:interrogate` on the sketch before the delegate starts.
4. Implement against the sketch through the Delegate gate. Its types are the data shape. Without a sketch, name the data shape first, per model-the-domain. Make the smallest change that meets "done". Run the check.
5. Stack follow-ups. Each gap that verification finds against a "done" bullet becomes its own unit and commit before `/orbit:ship`.

**Reply:** what you built, what you chose and why, open decisions. Tables for design alternatives.

## refactor
**The structure changes. The behavior does not.** A bug or missing feature found on the way is split out as its own task. A redesign is allowed, but name it and route to feature. Large or cross-cutting structural work belongs to `/orbit:figure-it-out`. This flow is the focused-to-medium change.
1. Run `/orbit:how` over the affected subsystem to learn the contract. Pin it before any structure moves with a characterization test, snapshot or equivalence harness. Types and lint are not a pin.
2. Name the structure the code is missing, per model-the-domain, and the target shape. Boring code stays when the shape is already clear and local. The reshape must delete branches or invalid states, not add indirection. If the target crosses a function boundary, run `/orbit:architect` before the move.
3. Delete dead code and one-caller wrappers before adding the new shape, as its own unit.
4. Move in small steps, pin green after each. Migrate every caller and delete the old API in the same change. No compatibility shims or parallel old and new paths. Check each rename against strings and docs too.
5. Prove behavior is unchanged on the real artifact, not "it compiles", per prove-it-works. For larger reshapes, diff old and new outputs with a script, replay a recorded baseline against the new code, or smoke-run the matching surface.
6. Keep it only if the code is easier to read. Otherwise revert.

**Reply:** the structure that changed, the pin it held against, the equivalence proof, what got easier to read, what got reverted.

## perf
**Tie every fix to a measurement.** Don't read source in place of measuring.
1. Measure first and record the number. Check the timed work actually ran and didn't error. Save the raw output as an artifact under `$TMPDIR/orbit-perf/<slug>/`, outside the worktree, since ship deletes it. Vet the baseline, and each later number, with `${CLAUDE_PLUGIN_ROOT}/skills/benchmark-checklist/SKILL.md`.
2. Run `/orbit:how` to ground hypotheses. Don't claim a perf ceiling without running it.
3. Try fixes cheapest first: don't do it, don't do it again, do less, do it later, do it when they're not looking, do it concurrently, do it cheaper. Stop when one meets the target.
4. If the fix crosses a function boundary, run `/orbit:architect` first.
5. Change one thing, measure again over several runs. Save each run's raw output next to the baseline. Keep it only if the gain beats run-to-run noise, per explain-the-number.
6. Parse and compare the artifacts (diff, JSON into sqlite). "Inconclusive" or wrong-surface is not a pass. Flag it. Cite the measurement in the PR body when Land is `pr`, else in the reply.

For sustained improvement against a metric rather than a one-off fix, use the hillclimb flow (`/orbit:playbook hillclimb`).

**Reply:** baseline number, post-fix number, delta, run count and spread, artifact path.

## hillclimb
**You own the metric and the experiment's integrity. Supervise and review. Delegate the attempts.** For sustained, iterative improvement of one measurable thing against a target. A one-off fix is bug or perf. This is the loop. Core discipline: one change, one measurement, keep or revert. Never stack untested changes, and never claim a win from code inspection, per prove-it-works.
1. Ground the workload and architecture before choosing the metric. Run `/orbit:how` over the target, name the realistic workload dimensions that can move the result (data size, history, state, concurrency), and select a case that reproduces the user's complaint. If no case reproduces it, fix the repro instead of hillclimbing. Then fix one metric, the direction that counts as better, and a checkable stop predicate that pairs a target with a floor on attempts so a lucky early win can't end the run (the example "at least 50% better than baseline and at least 10 iterations" is this shape). Use the user's numbers when given, otherwise agree them.
2. Build the measurement harness, prove its sensitivity, then freeze it. Run contrasting realistic workloads and confirm the target case reproduces the symptom while easier cases separate as expected. If the harness cannot distinguish them, revise the workload or metric. Vet the harness with `${CLAUDE_PLUGIN_ROOT}/skills/benchmark-checklist/SKILL.md` before you freeze it, and make it print its error count and a count of the work done. Once frozen, one repeatable command emits the metric, sampled enough to clear the noise (median of N, not a single run). Record the baseline metric and a green run of the regression gate (the tests that must keep passing) before any change.
3. Open the decision log via `/orbit:show-me-your-work` (read `${CLAUDE_PLUGIN_ROOT}/skills/show-me-your-work/SKILL.md`). A `decision.tsv`, one row per attempt: id, hypothesis, change, before, after, delta, tests, verdict (kept or reverted), note. Read it before each attempt. Keep it out of the tree, under `$TMPDIR/orbit-perf/<slug>/`, since ship deletes the worktree.
4. Ground each hypothesis in the architecture model from step 1, so it names a specific mechanism ("defer X off the boot path because it blocks first paint"), not "try memoizing something". For a perf metric, order hypotheses by the performance mantras in step 3 of the perf flow. Borrow only their order, not that step's stop rule.
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
