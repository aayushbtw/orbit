---
name: session-pickup
description: Resume a prior session's work in this project from its transcript, branch or resume note.
disable-model-invocation: true
---

# Session pickup

Source: cursor/plugins, pstack (MIT).

!`git status --short`

**You own the resume point. Read the prior trail, don't redo it.**

1. Locate the prior trail. Find this project's transcript folder with `ls ~/.claude/projects/*/${CLAUDE_SESSION_ID}.jsonl`, then take its newest other top-level `*.jsonl` by modification time (`ls -t`). Never read another project's transcripts. Also use a pushed branch the user names, and the `resume-<slug>.md` memory note for the task slug the user names, else the one whose `originSessionId` matches the transcript you chose. Read the metadata overview and last messages first, then scan back for the decision points. If that session was trivial (only a pickup), step back to the one before. Parse a long transcript in a subagent and keep the reduced timeline in the main thread. When the prior lead left no Claude Code transcript, or this lead has no `CLAUDE_SESSION_ID`, the trail is the resume note plus `t3_thread_read` of the prior thread, with the `threadId` the note records.
2. Reconstruct operational state. The branch and worktree (re-enter a task worktree with `EnterWorktree` and its `path`), what already landed (`git log`, `git diff` against the base), the open todos, the decisions made. The prior trail is authoritative input. Resist the bias to re-derive it.
3. Diff done vs pending. Compare what shipped against what was planned, name the resume point, do not re-run the prior repro or redo completed work. A "let me verify from scratch" pass means you're treating the trail as untrustworthy when it's authoritative.
4. Route the remaining work and pick the verdict: continue the execution (`/orbit:start <goal>`), take a finished change with no PR through Opening a PR (`/orbit:playbook opening-a-pr`), ratify or override a prior conclusion, or postmortem a failed run. An open PR goes to babysit (`/orbit:playbook babysit`) or `/orbit:ship` only when the user asks. The exception is an open PR whose watch a Stop or pause ended. It goes to babysit without a new ask. Babysit's **Host watcher** waits on it, and arms the watch while checks are pending, so pickup never calls `watch_pull_request` itself (host adapter's Stop row, `../../docs/harness/t3-code.md`). Find those PRs in the resume note's watched PRs and the prior trail's `watch_pull_request` calls, less any the trail unwatched at a handback other than a pause. Read each one's `state` with `gh pr view <pr> --json state`. `list_thread_pull_requests` reads the current thread by default, and pickup runs in a new session. So when the resume note records the prior thread's `threadId` and that tool is present, call it with that `threadId`, and skip a PR whose entry has `watching: true`, because the prior thread still watches it. Run the routed skill with the Skill tool. The pickup playbook ends here. The routed playbook owns the rest.
5. Verify the inherited claims against the original goal on the real artifact, with the project's `verify-*` skill when it has one. A passing prior self-report is not the proof.

**Reply:** where the prior agent stopped, what you inherited vs redid (ideally nothing redone), the resume point, and the outcome.
