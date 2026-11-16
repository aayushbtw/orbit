# Orbit in T3 Code

T3 Code runs orbit under a Claude lead and under a lead on another provider, such as Grok. This record says how orbit loads, finds T3's tools, fills panel seats, spawns subagents and resolves paths in each case. The [host adapter](../plugin/docs/harness/t3-code.md) holds the rules a lead follows. The [README](../README.md#other-providers-in-t3) holds the setup.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/t3-lead-dark.svg">
  <img alt="You run /orbit:start. The lead checks whether Non-negotiables is already in its context. Yes for a Claude lead, because the SessionStart hook printed the rules. No for another provider, so the lead loads the rules skill, which reads rules.md. Both paths then run the playbook. The lead spawns three kinds of child. An orbit agent runs as a native subagent, nested in the same thread. A code child runs on Claude through delegate_task. A panel seat runs on another family through delegate_task. A Claude lead runs code children as Agent spawns." src="diagrams/t3-lead-light.svg">
</picture>

## How orbit loads

A Claude lead loads orbit as a Claude Code plugin. Its SessionStart hook prints `plugin/rules.md` into the context, so Non-negotiables is there before the first reply.

A lead on another provider gets orbit from Claude Code's install record, `~/.claude/plugins/installed_plugins.json`. Grok reads the plugin's `installPath` from that record when orbit is enabled in Claude Code's user settings. Grok ignores a project's `.claude/settings.json`. A copy in `~/.grok/plugins/` wins over the record. `claude plugin update orbit@orbit` moves the record to a fresh copy of the new version, so it also updates what Grok loads.

Grok drops the SessionStart hook output. `/orbit:start` therefore loads the `rules` skill when Non-negotiables is not in context, and the skill reads `../../rules.md`. A Claude lead skips that step, because the hook already printed the rules. A user who wants the rules in every session, even without `/orbit:start`, adds one line to the provider's own instruction file, as the README shows. Orbit never writes that file.

## Find T3's tools

T3 serves its tools as MCP tools, and a step probes each tool before its first call. A tool that is not present takes the adapter's absent column, so orbit keeps working outside T3.

- A Claude lead finds a tool in its tool list, or loads it with `ToolSearch`.
- A lead on another provider has no `ToolSearch`. A tool is present when its name is in the tool list. Otherwise the first real call is the probe, and an error means absent. The lead never probes with dummy arguments, because a dummy `delegate_task` starts a thread.

## Fill a panel seat on another family

A review panel fills one seat on a model family other than the session's.

- The lead calls `orchestrator_capabilities` once per session and reuses the result.
- The roster is every enabled provider that can run a cross-provider child task and has a family other than the session's.
- The default pick takes the first roster provider's first model, and skips a model of the session's own family that another provider hosts.
- An explicit pick in the project's `other-family` row is checked with `search` before it is called unavailable.
- An unavailable pick goes in the reply with its reason.
- The seat runs through `delegate_task`, reads only, and its child thread is settled when it returns.
- Seats that write code stay on Claude.

Only Claude is assumed present. Every other provider comes from the roster at run time.

## Spawn subagents under another lead

A lead on another provider runs orbit agents with its native subagent tool, such as Grok's `spawn_subagent`. T3 shows each one as a nested node in the same thread, not as a new thread. Grok ignores an agent's `model` field, so a native subagent runs on the lead's own model.

`delegate_task` has two uses. A child that writes code runs on the roster's Claude provider. A panel seat runs on another family. Each brief names orbit's plugin folder as an absolute path, because the agent's own paths may arrive unexpanded.

## Resolve paths

- `plugin/rules.md` writes paths as `<orbit-plugin>`. The SessionStart hook rewrites that token to the plugin folder, so a Claude lead sees full paths. The `rules` skill tells another lead that the token is the folder two levels above the skill's base directory.
- Skill bodies use paths relative to their own folder, because Grok leaves `${CLAUDE_PLUGIN_ROOT}` unexpanded and names each skill's base directory.
- `poteto-agent` and `gitops` keep `${CLAUDE_PLUGIN_ROOT}`. When the variable arrives unexpanded, gitops uses the plugin folder its brief names, and with none it reports that and stops.

## What is verified

| Lead | Result |
| --- | --- |
| Claude lead | pending live lanes |
| Grok lead, headless | pending live lanes |
| Grok lead in T3 | pending live lanes |
| Other providers | untested |
