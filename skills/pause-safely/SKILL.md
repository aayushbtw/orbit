---
name: pause-safely
description: Stop cleanly and leave a resume note a fresh session can pick up. Use when the user asks to pause, stop for now or go offline, before switching model, or before imminent context compaction. Not on "keep going" or "don't stop".
---

# Pause safely

Source: cursor/plugins, pstack (MIT).

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.** This is explicit only. On "keep going", "going to bed, keep going", or "don't stop", do not pause.

1. Stop at a safe boundary. Finish the current atomic step or back out of it. Start nothing new, and cancel any nested subagents.
2. Take no irreversible action to pause. No PR and no push unless you already had one out.
3. Make the work durable. Have gitops commit uncommitted edits as one clear `wip:` commit on the current branch so nothing is lost. If the tree is broken, say so in the commit body in one line. Leave a task worktree in place.
4. Write the resume note off-context. Capture intent, what you were doing, progress and what's verified, current state (with the worktree path and branch), next steps, key files, and gotchas. Write it to the memory file `resume.md` in your auto memory directory (type project, overwritten each pause, one line for it in MEMORY.md), never the repo.
**Reply:** where you are in the loop, what's on disk versus still in your head (paths, no diff dumps), the commits you made and whether the tree is clean, and the first action on resume. This is a pause, not a final report.

Focus: $ARGUMENTS
