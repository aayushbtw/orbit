---
name: playbook
description: Run the standard flow for a task type
argument-hint: investigate | bug | feature | refactor | prototype | perf | hillclimb | autopilot-full | autopilot-stack | multi-phase-plan | opening-a-pr | babysit | shipping
---
Task type: $ARGUMENTS

Find the task type in **Playbooks** below, read `${CLAUDE_SKILL_DIR}/playbooks/<file>.md` whole and follow only it, with Principles and Stack rules. Paths in `playbooks/*.md` are relative to this skill's directory, `${CLAUDE_SKILL_DIR}`. Check and Land come from the Workflow block in the project's AGENTS.md (or CLAUDE.md). Each playbook opens with its stance and ends with its **Reply:**, the content the final reply must hold.

Every flow except `investigate`, `multi-phase-plan`, `opening-a-pr`, `babysit` and `shipping` has these gates, and `prototype` has only the Delegate gate. In `autopilot-full` and `autopilot-stack` the root writes no code, so only its owners run them, each through its own flow:
- **Worktree gate**, before the first edit: call `EnterWorktree` named `<type>-<slug>`, so parallel sessions never share a checkout. `<type>` is the commit type of the change (`feat`, `fix`, `refactor`, `perf`), and Opening a PR pushes a PR branch as `<type>/<slug>`. hillclimb and figure-it-out runs take the commit type of what they change (`perf` for a perf metric, else `feat`, `fix` or `refactor`). Skip the gate when the session is already in a worktree, unless it is dirty with unrelated work or snarled. Dirty branch with unrelated work: patch out, fresh worktree, apply. Snarled worktree: fresh worktree, redo minimally. For either, `ExitWorktree` with `keep` first, then run the gate again with a new slug. Landed branches stay, and so does each worktree until `/orbit:worktree-cleanup` runs, so if `<type>/<slug>` already exists locally or on `origin`, pick a new slug. Before entering, if `git check-ignore -q .claude/worktrees` fails, append `.claude/worktrees` to `.git/info/exclude`. After entering, run `git branch -m <type>/<slug>`. `EnterWorktree` names the branch `worktree-<type>-<slug>`. Then install dependencies when the project has a lockfile (`vp install`).
- **Plan gate**, before editing: if the change adds a module or touches more than 3 files, read the project sources for the paths it touches (the Workflow block's "Review also checks" and `Before code` entries for those paths, every AGENTS.md or CLAUDE.md in their folders and the folders above, and each `.claude/rules/` file whose `paths` match), then brief the `advisor` with the plan and those sources, and act on its verdict.
- **Delegate gate**: you plan, review and verify. A fresh `orbit:poteto-agent` writes the code, one verifiable unit at a time. Brief each with this file's absolute path, the absolute worktree path, the file paths, every `Before code` entry from the project's Workflow block whose path holds one of those files, the named data shape, the behavior to reach or hold, and the check that proves it. Copy the entries verbatim. Code delegates tier by difficulty. Spawn the delegate for the hardest changes (cross-cutting design, gnarly concurrency, subtle algorithms) with `model: "opus"`, whether the task needs judgment on vague intent or is a precisely specified sequence of steps to execute to the letter. Spawn every other delegate with `model: "sonnet"`. Review its diff, confirm its changed paths match the brief, verify, then have gitops commit that unit by path before the next delegate starts. This is mandatory. The gain is review separation, not lines saved, so size never skips it. A fix round is a fresh delegate with the original brief, every later directive, your findings and the current diff, on its unit's model. Opening a PR's cleanup fixes are yours to make. Parallel delegates (hillclimb and figure-it-out fan-out) are the one exception to one at a time. Spawn each with the `Agent` tool's `isolation: "worktree"` and brief it with that worktree, not the task's. For each attempt you keep, gitops commits it there by path and cherry-picks the commit onto the task branch. A prototype's sketch spawns the same way, even alone, and gitops commits it there with no cherry-pick, so the throwaway never reaches the task branch.
- **Opening a PR gate**, the last step: run **Opening a PR** (`/orbit:playbook opening-a-pr`). A change never reaches a PR, or a branch ready to ship, without it. Every task runs its own `/orbit:playbook opening-a-pr` with the Skill tool, also inside a loop over many tasks.

Long, autonomous or multi-phase work, or a task the user steps away from: read `${CLAUDE_PLUGIN_ROOT}/skills/show-me-your-work/SKILL.md` and keep its decision trail.
Running a benchmark, measuring perf yourself, or reporting a speedup or regression you measured: read `${CLAUDE_PLUGIN_ROOT}/skills/benchmark-checklist/SKILL.md` before you report or act on the number.

## Principles

Read the leaf in full for any principle you apply: `${CLAUDE_PLUGIN_ROOT}/skills/principle-<name>/SKILL.md`. In the reply, one line names each principle that shaped a decision and the choice it changed (`Principles: <name> -> <choice>`). Cite only leaves read this session.

**Core**

- **laziness-protocol.** Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading. Bias to deletion and the smallest change that solves the problem.
- **foundational-thinking.** Before writing logic: core types and data structures, scaffold-vs-feature sequencing, what concurrent actors share.
- **redesign-from-first-principles.** Integrating a new requirement into an existing design. Redesign as if it had been foundational from day one.
- **attack-the-premise.** Two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it.
- **subtract-before-you-add.** Sequencing an addition, refactor, or rewrite. Remove dead weight first, then build on the simpler base.
- **minimize-reader-load.** Reviewing or shaping code that's hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.
- **outcome-oriented-execution.** Planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture, don't preserve throwaway compatibility states.
- **experience-first.** Product, UX, or feature-scope tradeoffs. Choose user delight over implementation convenience.
- **exhaust-the-design-space.** A novel interaction or architectural decision with no precedent. Build 2-3 competing prototypes and compare before committing.
- **build-the-lever.** Any non-trivial work. Build the tool that does or proves it (codemod, script, generator), not by hand. The tool is the artifact a reviewer reruns.

**Architecture**

- **model-the-domain.** Writing stateful logic, or code that branches a lot or repeats a shape assumption across files. Encode the domain in a structure (state machine, typed model, table or registry, reducer, boundary, the right collection) instead of scattered conditionals.
- **boundary-discipline.** Wiring validation, error handling, or framework adapters. Guards at system boundaries, trust internal types, keep business logic pure.
- **type-system-discipline.** Designing types or a signature in any typed language. Make illegal states unrepresentable, brand primitives, parse external data at boundaries.
- **make-operations-idempotent.** Designing commands, lifecycle steps, or loops that run amid crashes and retries. Converge to the same end state.
- **migrate-callers-then-delete-legacy-apis.** Introducing a new internal API while old callers exist. Migrate and delete in one wave.
- **separate-before-serializing-shared-state.** Concurrent actors might write the same file, branch, key, or object. Eliminate the sharing first.

**Verification**

- **prove-it-works.** After a task, before declaring done. Verify against the real artifact, not a proxy or "it compiles".
- **fix-root-causes.** Debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.
- **sequence-verifiable-units.** Multi-step work (sweeps, migrations, runs of similar edits) and how you stack commits and PRs. Break work into small units that each end in a check, verify each before the next, and order delivery so the sequence proves itself.
- **test-behavior-not-implementation.** Writing, changing, or keeping a test. Assert what the code's users can observe, so the test fails when that behavior breaks and keeps passing when only the internals change.
- **explain-the-number.** Before you trust, report, or act on a number you measured. Find what limits it, and rule out that it measured something other than the work you think.

**Delegation**

- **guard-the-context-window.** Context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents. Keep summaries in the main thread, not raw payloads.
- **never-block-on-the-human.** Tempted to ask "should I do X?" on reversible work. Proceed, present the result, let the human course-correct.

**Meta**

- **encode-lessons-in-structure.** You catch yourself writing the same instruction a second time. Encode it as a lint, metadata flag, runtime check, or script instead of more text.

## Stack rules

Before writing code that matches a line below, read its index, then open only the rule files that apply:
- `.ts` or `.tsx`: `${CLAUDE_PLUGIN_ROOT}/skills/typescript-best-practices/SKILL.md`.

## Playbooks

- `investigate`, `playbooks/investigation.md`. Read-only question: how does X work, why was Y built this way, are we sure about Z, should we do X or Y.
- `bug`, `playbooks/bug-fix.md`. A reported defect to reproduce, root-cause, and fix with runtime evidence.
- `feature`, `playbooks/feature.md`. New or changed behavior, built from a named data shape.
- `refactor`, `playbooks/refactoring.md`. A behavior-preserving change to structure or shape (rename, extract, inline, dedupe, move).
- `prototype`, `playbooks/prototype.md`. A throwaway sketch to make a design or behavioral decision cheaply, or to settle an empirical fork by observing it instead of asking the human ("prototype", "mock it up", "try this layout", "sketch it to decide").
- `perf`, `playbooks/perf-issue.md`. A measured slowness to trace and improve against a baseline.
- `hillclimb`, `playbooks/hillclimb.md`. Sustained, scientific improvement of one metric against a target. Distinct from `perf`, which is a one-off fix.
- `autopilot-full`, `playbooks/autopilot-full.md`. A queue of independent PRs run to merged with full autonomy. One owner per PR carries build through merge, and the root swarm-verifies each PR before its owner merges.
- `autopilot-stack`, `playbooks/autopilot-stack.md`. A queue of changes built and verified with full autonomy, handed to the operator to land.
- `multi-phase-plan`, `playbooks/multi-phase-plan.md`. A plan for work that spans phases or stacked PRs.
- `opening-a-pr`, `playbooks/opening-a-pr.md`. Invoked at the end of every other flow.
- `babysit`, `playbooks/babysit.md`. Driving a PR or a stack to merge-ready: conflicts, review threads, CI.
- `shipping`, `playbooks/shipping.md`. The half after Babysit. Independently verifying a green stack, then landing the contiguous verified run bottom-up.
