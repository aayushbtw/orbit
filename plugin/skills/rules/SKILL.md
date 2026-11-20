---
name: rules
description: "Orbit's rules for the chat that leads a session. The lead loads it before its first reply when Non-negotiables is not in its context. A subagent never loads it."
user-invocable: false
---
A subagent stops here. These rules are for the lead.

Read `../../rules.md` and then `../../rules-shared.md` in full now, before you reply, each in its own command. They sit in orbit's plugin folder, two folders above this skill's base directory. `<orbit-plugin>` in them is that folder.

Then read `~/.claude/rules/orbit-models.md` if it exists. It holds the user-wide Models rows that `/orbit:setup` writes. Claude Code loads it natively, and other leads read it here.

A lead that is not Claude Code then reads `../../docs/harness/t3-code.md` and `../../docs/harness/t3-other-lead.md` whole, and `../../docs/harness/t3-seats.md` when the Seats on another family section of `t3-code.md` says to. `t3-other-lead.md` maps Claude Code's tool names. The Where a child runs and Seats on another family sections of `t3-code.md`, with `t3-seats.md` for a seat on another family, set every `delegate_task` field. Every `delegate_task` call passes `mode: "async"` and a `clientRequestId`, `<skill>-<unit>-<short base sha>-try<n>`, and those two sections give the rest. Read each file in its own command, and under Codex in its own `exec` call, since one `exec` script's output is cut too and two reads in it lose their middle. A shell tool can cut the middle out of a long output, as Codex's does, so read `t3-code.md` in two parts, up to its `## Models` heading and from that heading to the end. When any read says its output was truncated, read the cut lines again in smaller parts before you act.
