---
name: ship
description: Land a change - check, review, docs, commit
argument-hint: [notes]
---
Land the current change. Notes: $ARGUMENTS

Read the project's AGENTS.md (or CLAUDE.md) Workflow block for what differs from the defaults in the global Workflow Defaults.

1. **Check.** Run the block's Check line, else `vpr check` plus `vpr build` and `vpr test` when those scripts exist. Then, if the project has a `.claude/skills/verify-*` skill and the change is something a user can see, use it to drive the changed feature and report the evidence paths. "Inconclusive" or the wrong place is not a pass. Flag it. Docs-only changes skip Check and Clean.
2. **Clean.** Scope is the diff plus untracked files. Run the `deslop` skill over it. Then spawn the `comment-sicko` agent with that file list and inspect what it changed. Revert any edit outside comments. Restore a deleted comment only when a keep-list exception is proven. A deleted constraint comment ("do not remove") is reported open, with the type, test or lint that could enforce it. Fix each `MUST KILL` in scope with the smallest root-cause change, or report it open. Rerun the checks the edits touched.
3. **Review.** State the intent in one paragraph from the goal, the "done" bullets and the code; if unsure of the intent, ask me first. Brief the reviewer agent with it. Sort every finding per `${CLAUDE_PLUGIN_ROOT}/references/interrogate/lead-judgment.md`: Act on (fix it), Consider (tell me), Noted, Dismissed (one-line reason). More than 5 Act on means you're not filtering hard enough. Rerun the checks the fixes touched. Report each source's result in one line.
4. **Docs.** A decision the change settles or reverses goes in the doc that owns it, in the same change.
5. **Land**, by the Land line:
   - `main`: gitops commits one concern per commit, then pushes.
   - `pr`: gitops commits on a branch and opens the PR titled like a commit. If there is anything to test by hand, give numbered steps and wait for my go. Then gitops merges with the Land line's merge method (default merge commit) and cleans up: switch to `main`, pull, prune, delete the merged branch.
6. **Hand off.** If a next task is known, or the project already has a `handoff.md` memory, write it in the `/orbit:handoff` format to match main after this change, creating it if missing, with Flow `none` since this task landed. Patching one line leaves stale Next tasks. End with the one Task End `Next:` line. Don't start the next task.
