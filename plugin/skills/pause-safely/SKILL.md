---
name: pause-safely
description: Stop cleanly and leave a resume note a fresh session can pick up. Use when the user asks to pause, stop for now or go offline, before switching model, or before imminent context compaction. Not on "keep going" or "don't stop".
---

# Pause safely

Source: cursor/plugins, pstack (MIT).

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.** This is explicit only. On "keep going", "going to bed, keep going", or "don't stop", do not pause.

1. Stop at a safe boundary. Finish the current atomic step or back out of it. Start nothing new, and cancel any nested subagents. When the pause hands the thread back to the user (pause, stop, offline, model switch), list the PRs this thread watches (`list_thread_pull_requests`, entries with `watching: true`) and call `unwatch_pull_request` on each, when those tools are present, per the host adapter's Stop row (`../../docs/harness/t3-code.md`). Only the lead does this. A subagent or delegated child skips it. Before imminent context compaction, keep the watches.
2. Take no irreversible action to pause. No PR and no push unless you already had one out.
3. Make the work durable. Have gitops commit uncommitted edits as one clear `wip:` commit on the current branch so nothing is lost. If the tree is broken, say so in the commit body in one line. Leave a task worktree in place.
4. Write the resume note off-context. Capture intent, what you were doing, progress and what's verified, current state (with the worktree path and branch), next steps, key files, gotchas, each PR this thread watched, whether or not step 1 unwatched it, and under T3 Code this thread's `threadId`, which is the `parentThreadId` that `orchestrator_capabilities` returns for the calling thread (probe the tool first, as the adapter says; if it is absent, the note omits the id). The note says that a watched PR resumes through babysit (`/orbit:playbook babysit`). Write it to the memory file `resume-<slug>.md` in your auto memory directory (type project, one file per paused task slug, with its own line in MEMORY.md), never the repo. A lead with no auto memory directory writes the note and its MEMORY.md line to Claude Code's memory directory for this project, `~/.claude/projects/<path>/memory/`, so a lead on any provider finds it. `<path>` is the main checkout's path, the first path that `git worktree list` prints, with each `/` and `.` replaced by `-`, because Claude Code keys project memory on the main checkout, not a worktree. A pause in another session writes its own file and never overwrites this one.
**Reply:** where you are in the loop, what's on disk versus still in your head (paths, no diff dumps), the commits you made and whether the tree is clean, each PR you unwatched, and the first action on resume. This is a pause, not a final report.

Focus: $ARGUMENTS
