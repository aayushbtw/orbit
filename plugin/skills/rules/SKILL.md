---
name: rules
description: "Orbit's rules for the chat that leads a session. The lead loads it before its first reply when Non-negotiables is not in its context. A subagent never loads it."
user-invocable: false
---
A subagent stops here. These rules are for the lead.
A lead that is not running in Claude Code tells the user that orbit leads only under Claude Code, and stops.

Read `../../rules.md` and then `../../rules-shared.md` in full now, before you reply, each in its own command. They sit in orbit's plugin folder, two folders above this skill's base directory. `<orbit-plugin>` in them is that folder.

Then read `~/.claude/rules/orbit-models.md` if it exists. It holds the user-wide Models rows that `/orbit:setup` writes. Claude Code loads it natively.
