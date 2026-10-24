---
name: ship
description: Land a change - check, review, docs, commit
argument-hint: [notes]
---
Land the current change. Notes: $ARGUMENTS

Read the project's AGENTS.md (or CLAUDE.md) Workflow block for what differs from the defaults in the global Workflow Defaults.

1. **Check.** Run the block's Check line, else `vpr check` plus `vpr build` and `vpr test` when those scripts exist. Then, if the project has a `.claude/skills/verify-*` skill and the change is something a user can see, use it to drive the changed feature and report the evidence paths. "Inconclusive" or the wrong place is not a pass. Flag it. Docs-only changes skip Check and Clean.
2. **Clean.** Scope is `git diff origin/main...HEAD` plus uncommitted and untracked files. Run the `deslop` skill over it. Then run the `no-comments` skill over the same scope. Rerun the checks the edits touched.
3. **Review.** State the intent in one paragraph from the goal, the "done" bullets and the code; if unsure of the intent, ask me first. Brief the reviewer agent with it. Sort every finding per `${CLAUDE_PLUGIN_ROOT}/references/interrogate/lead-judgment.md`: Act on (fix it), Consider (tell me), Noted, Dismissed (one-line reason). More than 5 Act on means you're not filtering hard enough. Rerun the checks the fixes touched. Report each source's result in one line.
4. **Docs.** A decision the change settles or reverses goes in the doc that owns it, in the same change.
5. **Land**, by the Land line. gitops first commits what's left, one concern per commit, fetches, and rebases the task branch onto `origin/main`. Rerun Check if that pulled in new commits.
   - `main`: gitops pushes `HEAD:main`. If the push is rejected because `main` moved, it fetches, rebases, and you rerun Check before it pushes again. Never force.
   - `pr`: gitops pushes the branch as `<type>/<slug>` and opens a ready PR. If there is anything to test by hand, give numbered steps and wait for my go. Then gitops merges with the Land line's merge method (default merge commit).

   Then, if the Worktree gate entered this worktree, clean up: `ExitWorktree` with `keep`, and from the main checkout gitops runs `git pull --ff-only`, removes the worktree and deletes its local branch (and the remote `<type>/<slug>` for `pr`, passing that name). If the main checkout isn't on a clean `main`, leave the worktree and say so.

The reply also holds the playbook section's **Reply:**. End with the one Task End `Next:` line. Don't start the next task.
