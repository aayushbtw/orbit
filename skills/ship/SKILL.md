---
name: ship
description: Land a change - check, review, docs, commit
argument-hint: [notes]
---
Land the current change. Notes: $ARGUMENTS

Read the project's AGENTS.md (or CLAUDE.md) Workflow block for what differs from the defaults in the global Workflow Defaults.

1. **Check.** Run the block's Check line, else `vpr check` plus `vpr build` and `vpr test` when those scripts exist. Then, if the project has a `.claude/skills/verify-*` skill and the change is something a user can see, use it to drive the changed feature and report the evidence paths. Docs-only changes skip steps 1 and 2.
2. **Review.** Run the reviewer agent. Fix every must-fix; fix each should-fix or say why not. Rerun the checks the fixes touched. Report each source's result in one line.
3. **Docs.** A decision the change settles or reverses goes in the doc that owns it, in the same change.
4. **Land**, by the Land line:
   - `main`: gitops commits one concern per commit, then pushes.
   - `pr`: gitops commits on a branch and opens the PR titled like a commit. If there is anything to test by hand, give numbered steps and wait for my go. Then gitops merges.
5. **Hand off.** If a next task is known, or the project already has a `handoff.md` memory, write it in the `/handoff` format to match main after this change, creating it if missing. Patching one line leaves stale Next steps. End with a paste-ready prompt in a code block for the next task: what is done, what is next, decisions not yet in docs. Don't start it.
