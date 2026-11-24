---
name: rules
description: "Orbit's rules for the chat that leads a T3 Code session. A lead on any provider loads it before its first reply when Non-negotiables is not in its context. A lead whose host runs no SessionStart hook gets orbit's rules only from this skill. A subagent never loads it."
user-invocable: false
---
A subagent stops here. These rules are for the lead.

Run `realpath` on this `SKILL.md` first, because a host may reach orbit's skills through a symlink. Orbit's plugin folder is two folders above the folder it prints, and every `../../` path in this skill starts from the folder it prints. Then read `../../rules.md` and then `../../rules-shared.md` in full now, before you reply, each in its own command. `<orbit-plugin>` in them is orbit's plugin folder.

Then run `orbit models list --json`. Its rows hold every Models cell with the project's `.orbit/config.json` and AGENTS.md overrides merged, and `orbit models resolve <task> --json` gives one spawn's target. Without `orbit` on PATH, read the active profile of `~/.config/orbit/config.json`, keyed by the Task names of rules.md Workflow Defaults, Models, then the project's overrides.

When `Agent` or `Skill` is missing from your tool list, read the Any lead section of `../../docs/harness/t3-code.md` now, before your first reply.
