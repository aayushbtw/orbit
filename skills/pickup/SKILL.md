---
name: pickup
description: List pending tasks from the project's handoff memory
---
!`git status --short`

Read the project's `handoff.md` memory file. Check `git log` since its `modified` time: steps those commits finished are done, not next; mark them done in the Flow list too.

Reply with state in 3 bullets, then the pending tasks, numbered, one line each, worded as a `/orbit:start` goal. Tag the one the handoff's Flow covers with its type. Stop there; work begins with `/orbit:start <number or goal>`.
