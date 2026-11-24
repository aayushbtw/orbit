---
name: interrogate
description: "Adversaries try to break a change or design, and only findings a run proves survive. Never fixes its findings. Use for /orbit:interrogate."
---

# Interrogate

Source: cursor/plugins, pstack (MIT).

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not fix them.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree, untracked files included (`git status --short`). State the intent by restating in your own words what you think the user's goals are and what problem they're trying to solve, from the user's message, the commits, and the PR description. Ask the user when the intent is unclear.

## Fix first

Before the audit, fix what is already known in the scope: open review comments on its PR that hold up against the code, bugs the user or an earlier step has confirmed, and failures of the project's Check. A suspicion the user wants tested is the audit's job, not a known issue. A fresh `orbit:poteto-agent` makes each fix under `../playbook/SKILL.md`'s Delegate gate, in the worktree that holds the scope's branch, and gitops commits it, so no adversary writes code. Then run the Check, and Fan out names the commit after the fixes. Skip fixes to code the user plans to replace. Skip the step for a design or plan with no code, for a branch this session does not write, and when the scope has uncommitted changes. With nothing known, go to Fan out.

## Fan out

Read `../arena/SKILL.md` and run its Phase A steps 3 and 4 and Phase B, with four changes. Run arena's default seats as the adversaries, one on the `judgment` model and one on the `code` model (rules.md Workflow Defaults, Models), each with `effort: "high"`. Name the commit each adversary checks out, and save the scope's uncommitted changes, untracked files included, as a patch in a fresh `mktemp` file that the adversary applies first. Spawn each adversary with `subagent_type: "general-purpose"` in place of arena's `orbit:poteto-agent`. Each adversary is a same-provider child with role `review`, per the host adapter's Where a child runs section (rules.md Delegation, **Host tools.**), and its brief asks for its worktree path and starting branch as the roster seat's does below. Inside a child, or without `delegate_task`, adversaries run one at a time in your own checkout, as that section's T3 otherwise column says. In place of the arena task and rationale, give each adversary the scope, the intent, the Workflow block's "Review also checks" sources and the `Before code` entries for the changed paths, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

When the `other-family` Models row lists providers (rules.md Workflow Defaults, Models), a roster seat from the host adapter's seats file (`../../docs/harness/t3-seats.md`, rules.md Delegation, **Host tools.**) replaces the `code` adversary. It is the one roster seat that runs code, so spawn it with `delegate_task` `isolation: "worktree"`. In place of the adapter's no-edit line, its brief holds the commit to check out and the patch file's absolute path to apply first, and asks it to keep repros in its own worktree, edit nothing else, and report that worktree's absolute path (`pwd`) and its starting branch (`git branch --show-current`, run before any checkout) with each finding. Its effort follows the adapter's effort rule, not `effort: "high"`.

## Verify

Verify each finding per arena Phase F by rerunning its command in that adversary's own worktree, where its repro files live. Each child, the roster seat included, reports its own path. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause. Then settle each child's thread, remove every adversary worktree that remains with `git worktree remove --force <path>`, delete its branch with `git branch -D <branch>`, for a child the starting branch it reported, and delete the patch file.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Fixed first**: each known issue fixed before the audit with its commit, or why the step was skipped.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.
