---
name: rules
description: "Orbit's rules for the chat that leads a session. The lead loads it before its first reply when Non-negotiables is not in its context. A subagent never loads it."
user-invocable: false
---
A subagent stops here. These rules are for the lead.

Read `../../rules.md` in full now, before you reply. It sits in orbit's plugin folder, two folders above this skill's base directory. `<orbit-plugin>` in that file is that folder.

A lead that is not Claude Code then reads `../../docs/harness/t3-code.md` whole. Its Lead on another provider section maps Claude Code's tool names, and its Where a child runs and Seats on another family sections set every `delegate_task` field. Read each file in its own command. A shell tool can cut the middle out of a long output, as Codex's does, so read `t3-code.md` in two parts, up to its `## Models` heading and from that heading to the end. When any read says its output was truncated, read the cut lines again in smaller parts before you act.

Then read `~/.claude/rules/orbit-models.md` if it exists. It holds the user-wide Models rows that `/orbit:setup` writes. Claude Code loads it natively, and other leads read it here.
