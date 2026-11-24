---
name: worktree-cleanup
description: Reclaim local disk by pruning merged or abandoned git worktrees and stale iOS simulators. Use on "what's using my disk", "clean up worktrees", "prune safe-to-prune worktrees", "free up space" or "delete old simulators".
---

# Worktree and simulator cleanup

Source: cursor/plugins, pstack (MIT).

1. Snapshot and audit. Record `df -h /`. Check the T3 tools per the probe in `../../docs/harness/t3-code.md`. For this thread's repository, page through `pull_request_list` with `state: "all"` and `involvement: "authored"` to the end and save the combined `pullRequests` array to a scratch JSON file. Run `scripts/worktree-audit.sh [-b <pr-base-ref>] [--prs <file>] [repo-path]` from this skill's directory (principle-build-the-lever). Supply `--prs` only for a complete list from the repository being audited. When PR state is unavailable, report it and hold any candidate whose PR state you cannot verify. Without `-b` the audit checks `MERGED` against `origin/HEAD`, so pass `-b origin/<branch>` when PRs target another branch. The audit uses paths from `git worktree list` and suggests buckets from local git, PR state, and recent transcript activity where available. Remove the scratch JSON after the audit.
2. The bucket is advice, not permission. Check the live project in T3 (**prove-it-works**). Page through `t3_thread_list` for the audited project with `settled: false` and `includeSubagents: true`. Read each thread with `t3_thread_read` and compare its `worktreePath` with the candidates. Hold every bound worktree and any worktree the user says is in use. If the list or any needed read is unavailable, an unverified candidate stays.
3. Verify usage before deleting. For every `verify-recent-chat` row, or anything you doubt, check the session's activity for other worktrees it uses. A transcript can show a path another thread uses. A missing transcript cannot establish that the path is idle. Before pruning any candidate counted as merged only by its PR, confirm through `pull_request_read` that the PR is merged into the intended base and its head SHA matches the local worktree tip.
4. Pause on irreversible loss. `wip:N` is N tracked uncommitted edits. Show the diff and get a decision first, since removing a clean worktree is recoverable from its branch but uncommitted work is gone. `scratch:N` is untracked throwaway, safe to drop, but name the files. Clean and merged and not-in-use proceeds. `wip` and in-use pause.
5. Prune the confirmed set. Per path, `git worktree remove --force <path>`. If the dir survives on ignored build artifacts, `rm -rf` it, then `git worktree prune`. Branch refs survive, so no commits are lost. A `hold-locked` worktree belongs to a live agent session, so never remove it or pass `-f -f`. Confirm with `df -h /` and re-list.
6. Simulators and other reclaimers. Simulators are usually the next-biggest win. `xcrun simctl --set testing delete all` (XCTestDevices clones), `xcrun simctl delete unavailable`, and `xcrun simctl runtime list` then `runtime delete <id>` for old runtimes. More when needed: Xcode `DerivedData` and `iOS DeviceSupport`, package caches (pnpm, uv, brew, yarn). Clear only caches the user has not said to keep.

This is the one playbook that deletes user state with no code review to catch a slip, so the gates above are the review.

**Reply:** `df -h /` before and after with space reclaimed, the worktrees pruned, and a one-line reason for each held back (in-use by which session, or uncommitted work).
