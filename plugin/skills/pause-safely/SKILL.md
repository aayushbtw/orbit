---
name: pause-safely
description: Stop cleanly and leave a resume note a fresh session can pick up. Use when the user asks to pause, stop for now or go offline, before switching model, or before imminent context compaction. Not on "keep going" or "don't stop".
---

# Pause safely

Source: cursor/plugins, pstack (MIT).

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.** This is explicit only. On "keep going", "going to bed, keep going", or "don't stop", do not pause.

1. Stop at a safe boundary. Finish the current atomic step or back out of it. Start nothing new, and cancel any nested subagents. When the pause hands the thread back to the user (pause, stop, offline, model switch), list the PRs this thread watches (`list_thread_pull_requests`, entries with `watching: true`) and call `unwatch_pull_request` on each, per the host adapter's Stop row (`../../docs/harness/t3-code.md`). Only the lead does this. A subagent or delegated child skips it. Before imminent context compaction, keep the watches.
2. Take no irreversible action to pause. No PR and no push unless you already had one out.
3. Make the work durable. Have gitops commit uncommitted edits as one clear `wip:` commit on the current branch so nothing is lost. If the tree is broken, say so in the commit body in one line. Leave a task worktree in place.
4. Write the resume note off-context to `~/.config/orbit/checkpoints/<project-slug>/resume-<slug>.md`, never the repo, so a lead on any provider finds it. `<project-slug>` is the main checkout's realpath with each `/` and `.` replaced by `-`. Take that path from `projectWorkspaceRoot` in `t3_worktree_status`, else the first path `git worktree list` prints. Write one file per paused task slug, so a pause in another session or worktree writes its own file and never overwrites this one. The note opens with YAML frontmatter that pickup selects on:
   - `slug`: the task slug.
   - `threadId`, `providerInstanceId` and `model`: the `parentThreadId`, `inheritedProviderInstanceId` and `inheritedModel` that `orchestrator_capabilities` returns for the calling thread. Reuse the thread's one call. Probe the tool first, as the adapter says, and omit these three fields when it is absent.
   - `projectWorkspaceRoot`, `worktreePath` and `branch`: from `t3_worktree_status`, else the main checkout path, `git rev-parse --show-toplevel` and `git branch --show-current`.
   - `headSha`: `git rev-parse HEAD` after step 3's commit.
   - `updatedAt`: the current ISO 8601 UTC time.
   - `watchedPrs`: each PR URL this thread watched, and whether step 1 unwatched it.

   Leave `resumedAt` out. Session pickup sets it. The body captures intent, what you were doing, progress and what's verified, next steps, key files and gotchas. It says that a watched PR resumes through babysit (`/orbit:playbook babysit`).
**Reply:** where you are in the loop, what's on disk versus still in your head (paths, no diff dumps), the commits you made and whether the tree is clean, each PR you unwatched, and the first action on resume. This is a pause, not a final report.

Focus: $ARGUMENTS
