---
name: ship
description: Land a change - check, review, docs, commit
argument-hint: [notes]
---
Land the current change. Notes: $ARGUMENTS

Read the project's AGENTS.md (or CLAUDE.md) Workflow block for what differs from the defaults in the global Workflow Defaults. Fixes made during ship are yours to make.

1. **Check.** Run the block's Check line, else `vpr check` plus `vpr build` and `vpr test` when those scripts exist. Changes only to files no agent or runtime loads (such as a README) skip Check, Clean and Verify.
2. **Clean.** Scope is `git diff origin/main...HEAD` plus uncommitted and untracked files. Run the `deslop` skill over it. Then run the `no-comments` skill over the same scope. Rerun the checks the edits touched.
3. **Review.** State the intent in one paragraph from the goal, the "done" bullets and the code; if unsure of the intent, ask me first. Spawn the `reviewer` agent twice in one message, with `model: "opus"` and `model: "sonnet"`, each briefed with the same intent paragraph. Merge findings that describe the same issue and note which model raised each. A finding both raised is the highest signal. Read a lone model's finding, but give it less weight. Sort every finding per `${CLAUDE_PLUGIN_ROOT}/skills/interrogate/references/lead-judgment.md`: Act on (fix it), Consider (tell me), Noted, Dismissed (one-line reason). More than 5 Act on means you're not filtering hard enough. Rerun the checks the fixes touched. Report each source's result in one line.
4. **Verify.** gitops commits what's left. Fixes from Clean and Review fold into the unit commit they belong to (fixup plus autosquash). A fix that spans units gets its own commit. Then spawn a fresh `verifier` agent with the worktree path, the intent paragraph, the changed paths, and the path of the project's `.claude/skills/verify-*/SKILL.md` when it has one. Only its verdict counts. On FAIL, fix it, rerun the Review panel on the fix, then spawn a fresh verifier. Record the verdict, which agent produced it, the HEAD SHA, and `git diff origin/main...HEAD | git patch-id --stable`.
5. **Docs.** A decision the change settles or reverses goes in the doc that owns it, in the same change.
6. **Land**, by the Land line. gitops fetches and rebases the task branch onto `origin/main`. After any commit or rebase that follows Verify, rerun Check and compare the patch-id with the recorded one. If it changed, `git diff <verified SHA> HEAD --stat` shows what moved. A change beyond tests or docs needs a fresh verifier before landing.
   - `main`: gitops pushes `HEAD:main`. If the push is rejected because `main` moved, it fetches and rebases, and you redo the comparison above before it pushes again. Never force.
   - `pr`: gitops pushes the branch as `<type>/<slug>`, opens a ready PR, and waits on CI per its rules. You classify each failure it reports:
     - A flake or infrastructure error gets one fresh run of the whole workflow (`gh run rerun <run-id>`, never a single job).
     - An identical second failure is real. Fix it, then redo the comparison above.
     - A failure in code the diff never touches means a stale base. gitops merges `origin/main` into the branch and pushes, never forcing. Then redo the comparison above.
     - No checks reported means the repo has no CI. Go on, and say so in the reply.

     Once CI is green, if there is anything to test by hand, give numbered steps and wait for my go. Then gitops merges with the Land line's merge method (default merge commit) and reads back `gh pr view <n> --json state,mergeCommit`. If `state` isn't `MERGED`, report it as queued and stop before cleanup.

   Then, if the Worktree gate entered this worktree, clean up: `ExitWorktree` with `keep`, and from the main checkout gitops runs `git pull --ff-only` and removes the worktree. The branch stays. If the main checkout isn't on a clean `main`, leave the worktree and say so.

The reply also holds the flow's **Reply:**, plus one line naming the verifier's verdict and one naming the panel's agreement. End with the one Task End `Next:` line. Don't start the next task.
