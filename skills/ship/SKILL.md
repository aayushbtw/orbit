---
name: ship
description: Land a change - check, review, docs, commit
argument-hint: [notes]
---
Land the current change. Notes: $ARGUMENTS

Read the project's AGENTS.md (or CLAUDE.md) Workflow block for what differs from the defaults in the global Workflow Defaults.

1. **Check.** Run the block's Check line, else `vpr check` plus `vpr build` and `vpr test` when those scripts exist. Changes only to files no agent or runtime loads (README, docs/) skip Check, Clean and Verify.
2. **Clean.** Scope is `git diff origin/main...HEAD` plus uncommitted and untracked files. Run the `deslop` skill over it. Then run the `no-comments` skill over the same scope. Rerun the checks the edits touched.
3. **Review.** State the intent in one paragraph from the goal, the "done" bullets and the code; if unsure of the intent, ask me first. Spawn the `reviewer` agent twice in one message, with `model: "opus"` and `model: "sonnet"`, each briefed with the same intent paragraph. Merge findings that describe the same issue and note which model raised each. A finding both raised is the highest signal; a lone model's finding is weighed. Sort every finding per `${CLAUDE_PLUGIN_ROOT}/references/interrogate/lead-judgment.md`: Act on (fix it), Consider (tell me), Noted, Dismissed (one-line reason). More than 5 Act on means you're not filtering hard enough. Rerun the checks the fixes touched. Report each source's result in one line.
4. **Verify.** Spawn a fresh `verifier` agent with the worktree path, the intent paragraph and the changed paths. Only its verdict counts. On FAIL, fix it (a fresh `orbit:poteto-agent` for code), re-review the fix, then spawn a fresh verifier. Record the verdict, which agent produced it, and `git diff origin/main...HEAD | git patch-id --stable`.
5. **Docs.** A decision the change settles or reverses goes in the doc that owns it, in the same change.
6. **Land**, by the Land line. gitops first commits what's left, one concern per commit. Fixes from Clean and Review fold into the unit commit they belong to (fixup plus autosquash), not trailing commits. A fix that spans units gets its own commit. gitops then fetches and rebases the task branch onto `origin/main`. If that pulled in new commits, rerun Check and compare the patch-id against the one Verify recorded; if it changed beyond tests or docs, run a fresh verifier before landing.
   - `main`: gitops pushes `HEAD:main`. If the push is rejected because `main` moved, it fetches, rebases, and you rerun Check before it pushes again. Never force.
   - `pr`: gitops pushes the branch as `<type>/<slug>` and opens a ready PR. gitops then waits for CI with `gh pr checks <n> --watch` (`--required` when the repo has required checks), polling up to a minute before concluding there are no checks. On a failure it reports the failing check and the log tail, and you classify it: a flake gets one rerun; an identical second failure is real, so fix it; a failure in code the diff never touches means a stale base, so rebase. Once CI is green, if there is anything to test by hand, give numbered steps and wait for my go. Then gitops merges with the Land line's merge method (default merge commit) and reads back `gh pr view <n> --json state,mergeCommit`; the reply cites it.

   Then, if the Worktree gate entered this worktree, clean up: `ExitWorktree` with `keep`, and from the main checkout gitops runs `git pull --ff-only`, removes the worktree and deletes its local branch (and the remote `<type>/<slug>` for `pr`, passing that name). If the main checkout isn't on a clean `main`, leave the worktree and say so.

The reply also holds the playbook section's **Reply:**, plus one line naming the verifier's verdict and one naming the panel's agreement. End with the one Task End `Next:` line. Don't start the next task.
