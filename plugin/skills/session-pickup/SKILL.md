---
name: session-pickup
description: Resume a prior session's work in this project from its transcript, branch or resume note.
disable-model-invocation: true
---

# Session pickup

Source: cursor/plugins, pstack (MIT).

!`git status --short`

**You own the resume point. Read the prior trail, don't redo it.**

1. Locate the prior trail. Find this project's transcript folder with `ls ~/.claude/projects/*/${CLAUDE_SESSION_ID}.jsonl`, then take its newest other top-level `*.jsonl` by modification time (`ls -t`). Never read another project's transcripts. Also use a pushed branch the user names, and the `resume-<slug>.md` memory note for the task slug the user names, else the one whose `originSessionId` matches the transcript you chose. Read the metadata overview and last messages first, then scan back for the decision points. If that session was trivial (only a pickup), step back to the one before. Parse a long transcript in a subagent and keep the reduced timeline in the main thread. When a `resume-<slug>.md` note has no `originSessionId`, or is newer than the newest other transcript, the trail is that note plus `t3_thread_read` of the note's `threadId`. The trail is the same when this lead has no `CLAUDE_SESSION_ID` or no transcript matches it, as the transcript row of the Any lead table in `../../docs/harness/t3-code.md` says. A lead with no auto memory directory reads the notes in Claude Code's memory directory for this project, `~/.claude/projects/<path>/memory/`, where pause-safely writes them, with `<path>` as `../pause-safely/SKILL.md` step 4 defines it.
2. Reconstruct operational state. The branch and worktree (work in a task worktree by absolute path, and never call `t3_worktree_handoff` for it again), what already landed (`git log`, `git diff` against the base), the open todos, the decisions made. The prior trail is authoritative input. Resist the bias to re-derive it.
3. Diff done vs pending. Compare what shipped against what was planned, name the resume point, do not re-run the prior repro or redo completed work. A "let me verify from scratch" pass means you're treating the trail as untrustworthy when it's authoritative.
4. Route the remaining work and pick the verdict: continue the execution (`/orbit:start <goal>`), take a finished change with no PR through Opening a PR (`/orbit:playbook opening-a-pr`), ratify or override a prior conclusion, or postmortem a failed run. An open PR goes to babysit (`/orbit:playbook babysit`) or `/orbit:ship` only when the user asks. The exception is an open PR whose watch a Stop or pause ended. It goes to babysit without a new ask. Babysit's **Host watcher** waits on it, and arms the watch while checks are pending, so pickup never calls `watch_pull_request` itself (host adapter's Stop row, `../../docs/harness/t3-code.md`). Find those PRs in the resume note's watched PRs and the prior trail's `watch_pull_request` calls, less any the trail unwatched at a handback other than a pause. Read each one's state with `pull_request_read`. `list_thread_pull_requests` reads the current thread by default, and pickup runs in a new session. So when the resume note records the prior thread's `threadId` and that tool is present, call it with that `threadId`, and skip a PR whose entry has `watching: true`, because the prior thread still watches it. Run the routed skill with the Skill tool. The pickup playbook ends here. The routed playbook owns the rest.
5. Verify the inherited claims against the original goal on the real artifact, with the project's `verify-*` skill when it has one. A passing prior self-report is not the proof.

**Reply:** where the prior agent stopped, what you inherited vs redid (ideally nothing redone), the resume point, and the outcome.
