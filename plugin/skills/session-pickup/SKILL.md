---
name: session-pickup
description: Resume a prior session's work in this project from its transcript, branch or resume note.
disable-model-invocation: true
---

# Session pickup

Source: cursor/plugins, pstack (MIT).

!`git status --short`

**You own the resume point. Read the prior trail, don't redo it.**

1. Locate the prior trail. Pick the resume note first, then read its trail.
   - Gather candidate `resume-*.md` notes from `~/.config/orbit/checkpoints/<project-slug>/`, with `<project-slug>` as `../pause-safely/SKILL.md` step 4 defines it. Also gather legacy notes from your auto memory directory and from `~/.claude/projects/<path>/memory/`, where `<path>` is the first path `git worktree list` prints with each `/` and `.` replaced by `-`.
   - Drop stale notes unless the user names one. A note is stale when it has `resumedAt` set, or when its `branch` exists neither locally (`git branch --list <branch>`) nor on origin (`git ls-remote --heads origin <branch>`).
   - Read the current identity: `parentThreadId` from `orchestrator_capabilities`, and `worktreePath`, `branch` and `projectWorkspaceRoot` from `t3_worktree_status`. Probe each tool first, as the adapter says, and skip the tiers whose field is missing.
   - Select by tier, and stop at the first tier with a match. Tier 1 is the user's explicit target, a slug, branch, worktree path or `threadId`. Tier 2 is a note whose `threadId` equals the current thread's, as after a provider switch in the same thread. Tier 3 is a note whose `worktreePath` or `branch` equals the current binding, as for a new thread bound to the paused worktree. Tier 4 is every remaining candidate.
   - A tier with exactly one note selects it. A tier with two or more is a tie. Do not guess and restore no PR watch. List each candidate's `slug`, `branch`, `worktreePath`, `threadId` and `updatedAt`, and ask the user which paused task to resume.
   - The trail is the selected note plus `t3_thread_read` of its `threadId`, per **T3 activity** in `../../docs/harness/t3-code.md`. A legacy note with no `threadId` falls back to the transcript. Find this project's transcript folder with `ls ~/.claude/projects/*/${CLAUDE_SESSION_ID}.jsonl` and read the one whose name matches the note's `originSessionId`, else its newest other top-level `*.jsonl` by modification time (`ls -t`). Never read another project's transcripts. With no note at all, use a pushed branch the user names, else that newest transcript. If that session was trivial (only a pickup), step back to the one before.
   - Read the metadata overview and last messages first, then scan back for the decision points. Parse a long trail in a subagent and keep the reduced timeline in the main thread.
2. Reconstruct operational state. Confirm the note's binding first. Its `worktreePath` must appear in `git worktree list` and its `branch` in `git branch`. Report it when `headSha` no longer matches the branch tip. Once the user accepts the selection, set `resumedAt` in the note to the current ISO 8601 UTC time, so the note stops auto-selecting. Then the branch and worktree (work in a task worktree by absolute path, and never call `t3_worktree_handoff` for it again), what already landed (`git log`, `git diff` against the base), the open todos, the decisions made. The prior trail is authoritative input. Resist the bias to re-derive it.
3. Diff done vs pending. Compare what shipped against what was planned, name the resume point, do not re-run the prior repro or redo completed work. A "let me verify from scratch" pass means you're treating the trail as untrustworthy when it's authoritative.
4. Route the remaining work and pick the verdict: continue the execution (`/orbit:start <goal>`), take a finished change with no PR through Opening a PR (`/orbit:playbook opening-a-pr`), ratify or override a prior conclusion, or postmortem a failed run. An open PR goes to babysit (`/orbit:playbook babysit`) or `/orbit:ship` only when the user asks. The exception is an open PR whose watch a Stop or pause ended. It goes to babysit without a new ask. Babysit's **Host watcher** waits on it, and arms the watch while checks are pending, so pickup never calls `watch_pull_request` itself (host adapter's Stop row, `../../docs/harness/t3-code.md`). Find those PRs only in the selected note's `watchedPrs` and the `watch_pull_request` calls in its `threadId`'s trail, less any the trail unwatched at a handback other than a pause. Never restore another paused task's watches. Read each one's state with `pull_request_read`. `list_thread_pull_requests` reads the current thread by default. So when the note records a `threadId` and that tool is present, call it with that `threadId`. When that `threadId` differs from the current thread, skip a PR whose entry has `watching: true`, because the prior thread still watches it. When it equals the current thread, as after a provider switch, that watch is yours, so the PR goes to babysit. Run the routed skill with the Skill tool. The pickup playbook ends here. The routed playbook owns the rest.
5. Verify the inherited claims against the original goal on the real artifact, with the project's `verify-*` skill when it has one. A passing prior self-report is not the proof.

**Reply:** where the prior agent stopped, what you inherited vs redid (ideally nothing redone), the resume point, and the outcome.
