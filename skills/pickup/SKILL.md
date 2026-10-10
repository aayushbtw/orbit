---
name: pickup
description: Resume work from the project's handoff memory
---
!`git status --short`

Read the project's `handoff.md` memory file. Check `git log` since its `modified` time: steps those commits finished are done, not next. Don't redo finished work; check only the claims the next step builds on. Reply with state in 3 bullets, then do the first step still open.
