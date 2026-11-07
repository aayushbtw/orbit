---
name: interrogate
description: "Adversaries try to break a change or design, and only findings a run proves survive. Never applies fixes. Use for /orbit:interrogate."
---

# Interrogate

Source: cursor/plugins, pstack (MIT).

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree, untracked files included (`git status --short`). State the intent by restating in your own words what you think the user's goals are and what problem they're trying to solve, from the user's message, the commits, and the PR description. Ask the user when the intent is unclear.

## Fan out

Read `${CLAUDE_PLUGIN_ROOT}/skills/arena/SKILL.md` and run its Phase A steps 3 and 4 and Phase B, with four changes. Run arena's default seats as the adversaries, one with `model: "opus"` (the `judgment` model) and one on the `code` model (rules.md Workflow Defaults, Models), each with `effort: "high"`. Name the commit each adversary checks out, and save the scope's uncommitted changes, untracked files included, as a patch in a fresh `mktemp` file that the adversary applies first. Spawn each adversary with `subagent_type: "general-purpose"` in place of arena's `orbit:poteto-agent`. In place of the arena task and rationale, give each adversary the scope, the intent, the Workflow block's "Review also checks" sources and the `Before code` entries for the changed paths, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

## Verify

Verify each finding per arena Phase F by rerunning its command in that adversary's own worktree, where its repro files live. The `Agent` result returns the worktree's path. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause. Then remove every adversary worktree with `git worktree remove --force <path>`, delete its branch with `git branch -D <branch>`, and delete the patch file.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.
