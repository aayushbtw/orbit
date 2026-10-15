---
name: playbook
description: Run the standard flow for a task type
argument-hint: investigate | bug | feature | refactor | perf
---
Task type: $ARGUMENTS

Follow Principles, Stack rules and only the matching task section. Check and Land come from the Workflow block in the project's AGENTS.md (or CLAUDE.md). Each section opens with its stance and ends with its **Reply:**, the content the final reply must hold.

Every section except `investigate` has two gates:
- **Plan gate**, before editing: if the change adds a module or touches more than 3 files, read the project sources for the paths it touches (as the `reviewer`'s step 2 finds them), then brief the `advisor` with the plan and those sources, and act on its verdict.
- **Land gate**, the last step: run /orbit:ship. It checks, runs the `reviewer` and lands. A change never lands without it.

## Principles

Read the leaf in full for any principle you apply: `${CLAUDE_PLUGIN_ROOT}/skills/principle-<name>/SKILL.md`. In the reply, one line names each principle that shaped a decision and the choice it changed (`Principles: <name> -> <choice>`). Cite only leaves read this session.

- **laziness-protocol.** Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading. Bias to deletion and the smallest change that solves the problem.
- **subtract-before-you-add.** Sequencing an addition, refactor, or rewrite. Remove dead weight first, then build on the simpler base.
- **minimize-reader-load.** Reviewing or shaping code that's hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.
- **model-the-domain.** Writing stateful logic, or code that branches a lot or repeats a shape assumption across files. Encode the domain in a structure (state machine, typed model, table or registry, reducer, boundary, the right collection) instead of scattered conditionals.
- **boundary-discipline.** Wiring validation, error handling, or framework adapters. Guards at system boundaries, trust internal types, keep business logic pure.
- **type-system-discipline.** Designing types or a signature in any typed language. Make illegal states unrepresentable, brand primitives, parse external data at boundaries.
- **attack-the-premise.** Two or more fixes that share one premise have failed the same gate. Take a census of which actors hold the imbalance before the next fix, then question the premise instead of writing another fix that assumes it.
- **fix-root-causes.** Debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.
- **prove-it-works.** After a task, before declaring done. Verify against the real artifact, not a proxy or "it compiles".
- **test-behavior-not-implementation.** Writing, changing, or keeping a test. Assert what the code's users can observe, so the test fails when that behavior breaks and keeps passing when only the internals change.
- **explain-the-number.** Before you trust, report, or act on a number you measured. Find what limits it, and rule out that it measured something other than the work you think.

## Stack rules

Before writing code that matches a line below, read its index, then open only the rule files that apply:
- `.ts` or `.tsx`: `${CLAUDE_PLUGIN_ROOT}/skills/typescript-best-practices/SKILL.md`.
- React components, hooks, context or data fetching: `${CLAUDE_PLUGIN_ROOT}/skills/vercel-react-best-practices/SKILL.md` and `${CLAUDE_PLUGIN_ROOT}/skills/vercel-composition-patterns/SKILL.md`. Skip Next.js-only rules in other frameworks.

## investigate
**You own the answer.** Read-only: a cited explanation or a recommendation, not a code change.
1. Read the code and its history (`git log -L`, `git blame`) for the part in question. Cite `path:line` for each claim.
2. For a choice between options, give a recommendation and a tradeoffs table. If the premise is wrong, say so.
3. If the answer leads to a code change, stop, give the answer, and name the change as the next `/orbit:start <goal>`.

**Reply:** the answer with citations, or the recommendation with its tradeoffs. No commit.

## bug
**Every shipped line traces to runtime evidence.** A change that "might help" is a hypothesis, not a fix. When evidence refutes a hypothesis, revert what it motivated.
1. Reproduce it yourself where the user sees it, with the project's `verify-*` skill when it has one. Write a failing test or exact command first.
2. Find the cause by ruling out hypotheses with runtime evidence, per fix-root-causes. Fix the cause, not the symptom.
3. Confirm the repro passes and the check is green. Unit tests show branch behavior, not bug absence.

**Reply:** what was broken, the root cause, the fix, how you verified. Paste the failing-then-passing output verbatim.

## feature
**You own the design.**
1. State "done" in 3 bullets. Ask only if a real decision is missing.
2. Read the nearest similar code and match it.
3. Name the data shape first, per model-the-domain. Make the smallest change that meets "done". Run the check.

**Reply:** what you built, what you chose and why, open decisions.

## refactor
**The structure changes. The behavior does not.** A bug or missing feature found on the way is split out as its own task.
1. Pin current behavior first: a test or a saved output to diff against. Types and lint are not a pin.
2. Delete dead code and one-caller wrappers before adding the new shape.
3. Move in small steps, pin green after each. Migrate every caller and delete the old API in the same change. Check each rename against strings and docs too.
4. Keep it only if the code is easier to read. Otherwise revert.

**Reply:** the structure that changed, the pin it held against, what got easier to read, what got reverted.

## perf
**Tie every fix to a measurement.** Don't read source in place of measuring.
1. Measure first and record the number. Check the timed work actually ran and didn't error.
2. Try fixes cheapest first: don't do it, don't do it again, do less, do it later, do it concurrently, do it cheaper. Stop when one meets the target.
3. Change one thing, measure again over several runs. Keep it only if the gain beats run-to-run noise, per explain-the-number.

**Reply:** baseline number, post-fix number, delta, run count and spread.
