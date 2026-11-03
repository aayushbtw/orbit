---
name: session-pickup
description: Resume a prior session's work in this project from its transcript, branch or resume note.
disable-model-invocation: true
---

# Session pickup

Source: cursor/plugins, pstack (MIT).

!`git status --short`

**You own the resume point. Read the prior trail, don't redo it.**

1. Locate the prior trail. Find this project's transcript folder with `ls ~/.claude/projects/*/${CLAUDE_SESSION_ID}.jsonl`, then take its newest other top-level `*.jsonl` by modification time (`ls -t`). Never read another project's transcripts. Also use a pushed branch the user names, and the `resume.md` memory note when its `originSessionId` matches the transcript you chose. Read the metadata overview and last messages first, then scan back for the decision points. If that session was trivial (only a pickup), step back to the one before. Parse a long transcript in a subagent and keep the reduced timeline in the main thread.
2. Reconstruct operational state. The branch and worktree (re-enter a task worktree with `EnterWorktree` and its `path`), what already landed (`git log`, `git diff` against the base), the open todos, the decisions made. The prior trail is authoritative input. Resist the bias to re-derive it.
3. Diff done vs pending. Compare what shipped against what was planned, name the resume point, do not re-run the prior repro or redo completed work. A "let me verify from scratch" pass means you're treating the trail as untrustworthy when it's authoritative.
4. Route the remaining work and pick the verdict: continue the execution (`/orbit:start <goal>`), take a finished change with no PR through Opening a PR (`/orbit:playbook opening-a-pr`), ratify or override a prior conclusion, or postmortem a failed run. An open PR goes to babysit (`/orbit:playbook babysit`) or `/orbit:ship` only when the user asks. Run the routed skill with the Skill tool. The pickup playbook ends here. The routed playbook owns the rest.
5. Verify the inherited claims against the original goal on the real artifact, with the project's `verify-*` skill when it has one. A passing prior self-report is not the proof.

**Reply:** where the prior agent stopped, what you inherited vs redid (ideally nothing redone), the resume point, and the outcome.
