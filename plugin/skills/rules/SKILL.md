---
name: rules
description: "Orbit's rules for the chat that leads a session. A lead on any provider loads it before its first reply when Non-negotiables is not in its context. A lead without Claude Code's SessionStart hook gets orbit's rules only from this skill. A subagent never loads it."
user-invocable: false
---
A subagent stops here. These rules are for the lead.

Read `../../rules.md` and then `../../rules-shared.md` in full now, before you reply, each in its own command. They sit in orbit's plugin folder, two folders above this skill's base directory. `<orbit-plugin>` in them is that folder.

Then read `~/.config/orbit/models.md` if it exists. Otherwise read `~/.claude/rules/orbit-models.md` if it exists. The first file found holds the user-wide Models rows.

When `Agent` or `Skill` is missing from your tool list, read the Any lead section of `../../docs/harness/t3-code.md` now, before your first reply.
