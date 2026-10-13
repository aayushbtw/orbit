---
name: handoff
description: Save session state to the project's handoff memory before clearing or switching model
disable-model-invocation: true
---
Stop here. Overwrite the project's handoff note: the memory file `handoff.md` in your auto memory directory (type project, one file, never the repo; keep a single line for it in MEMORY.md). Under 1,000 words:
- Goal
- Files touched (path + why)
- Tried and failed (+ why)
- Open decisions
- Flow: the `/orbit:start` type and its todo list as it stands (done, `skip: <reason>`, open), or `none`
- Next tasks beyond the Flow, one line each

Then tell me: run /clear, then /model <name>, then start the new session with /orbit:pickup.

Focus: $ARGUMENTS
