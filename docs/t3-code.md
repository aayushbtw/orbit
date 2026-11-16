# Orbit in T3 Code

T3 Code runs orbit under a Claude lead and under a lead on another provider, such as Grok. This record says how orbit loads, finds T3's tools, fills panel seats, spawns subagents and resolves paths in each case. The [host adapter](../plugin/docs/harness/t3-code.md) holds the rules a lead follows. The [README](../README.md#run-on-any-provider-in-t3) holds the setup.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/t3-lead-dark.svg">
  <img alt="You run /orbit:start. The lead checks whether Non-negotiables is already in its context. Yes for a Claude lead, because the SessionStart hook printed the rules. No for another provider, so the lead loads the rules skill, which reads rules.md. Both paths then run the playbook. The lead spawns three kinds of child. An orbit agent runs as a native subagent, nested in the same thread. A code child runs on Claude through delegate_task. A panel seat runs on another family through delegate_task. A Claude lead runs code children as Agent spawns." src="diagrams/t3-lead-light.svg">
</picture>

## How orbit loads

A Claude lead loads orbit as a Claude Code plugin. Its SessionStart hook prints `plugin/rules.md` into the context, so Non-negotiables is there before the first reply.

A lead on another provider gets orbit from Claude Code's install record, `~/.claude/plugins/installed_plugins.json`. Grok reads the plugin's `installPath` from that record when orbit is enabled in Claude Code's user settings. Grok ignores a project's `.claude/settings.json`. A copy in `~/.grok/plugins/`, or one from `grok plugin install`, wins over the record, and Grok still loads orbit once. Orbit has no per-provider install. `/orbit:setup` finds a Grok install of its own and prints `grok plugin uninstall orbit` for the user to run, so Grok falls back to Claude Code's copy. `claude plugin update orbit@orbit` moves the record to a fresh copy of the new version, so it also updates what Grok loads. A directory marketplace updates Claude Code's copy on `git pull`, but Grok's copy only on `claude plugin update`.

Grok drops the SessionStart hook output. `/orbit:start` therefore loads the `rules` skill when Non-negotiables is not in context, and the skill reads `../../rules.md`. A Claude lead skips that step, because the hook already printed the rules. A user who wants the rules in every session, even without `/orbit:start`, adds one line to the provider's own instruction file, as the README shows. Orbit writes that file only when the user says yes during `/orbit:setup`.

## Find T3's tools

T3 serves its tools as MCP tools, and a step probes each tool before its first call. A tool that is not present takes the adapter's absent column, so orbit keeps working outside T3.

- A Claude lead finds a tool in its tool list, or loads it with `ToolSearch`.
- A lead on another provider uses its own tool search with the bare name. Grok finds `t3-code__list_thread_pull_requests` with `search_tool` and calls it with `use_tool`. With no tool search, a tool is present when its name is in the tool list. Otherwise the first real call is the probe, and an error means absent. The lead never probes with dummy arguments, because a dummy `delegate_task` starts a thread.

## Fill a panel seat on another family

A review panel fills one seat on a model family other than the session's.

- The lead calls `orchestrator_capabilities` once per session and reuses the result.
- The roster is every enabled provider that can run a cross-provider child task and has a family other than the session's.
- The empty-cell default takes the first roster provider's first model, and skips a model of the session's own family that another provider hosts.
- The `other-family` row comes from the project's AGENTS.md, else from `~/.claude/rules/orbit-models.md`, which `/orbit:setup` writes. Its Model cell can list providers in order. The seat tries only listed providers outside the session's family, then the session-family seat, never a provider the list leaves out.
- An explicit model pick is checked with `search` before it is called unavailable.
- An unavailable entry goes in the reply with its reason.
- The seat runs through `delegate_task`, reads only, and its child thread is settled when it returns.
- Seats that write code stay on Claude.

Only Claude is assumed present. Every other provider comes from the roster at run time.

## Spawn subagents under another lead

A lead on another provider runs orbit agents with its native subagent tool, such as Grok's `spawn_subagent`. T3 shows each one as a nested node in the same thread, not as a new thread. Grok ignores an agent's `model` field, so a native subagent runs on the lead's own model.

`delegate_task` has two uses. A child that writes code runs on the roster's Claude provider, with `role: "implementation"` and `mode: "async"`, never `mode: "wait"`, because only a child on Claude gets the role's model and orbit's rules. The lead ends its turn after the spawn, and the child's completion wakes it. It runs native, and the reply says so, when a T3 tool is absent, the roster has no Claude provider, or the spawn errors or returns nothing. A panel seat runs on another family. The lead reads each child's result with `task_status` and settles its thread. Each brief names orbit's plugin folder as an absolute path, because the agent's own paths may arrive unexpanded.

## Resolve paths

- `plugin/rules.md` writes paths as `<orbit-plugin>`. The SessionStart hook rewrites that token to the plugin folder, so a Claude lead sees full paths. The `rules` skill tells another lead that the token is the folder two levels above the skill's base directory.
- Skill bodies use paths relative to their own folder, because Grok leaves `${CLAUDE_PLUGIN_ROOT}` unexpanded and names each skill's base directory.
- `poteto-agent` and `gitops` keep `${CLAUDE_PLUGIN_ROOT}`. Claude Code and Grok both expand it in agent bodies. When another provider leaves it unexpanded, gitops uses the plugin folder its brief names, and with none it reports that and stops.

## What is verified

| Lead | Result |
| --- | --- |
| Claude lead | Verified headless. Routing matches trunk, the hook prints the same rules, and the lead never loads the `rules` skill. With hooks off, the lead loads it before the playbook, and not again on a second `/orbit:start`. |
| Grok lead, headless | Verified. The lead loads the `rules` skill first, reads `rules.md` through the relative path, quotes a Non-negotiable, and runs `orbit:gitops` with `spawn_subagent`. |
| Grok lead in T3 | Verified. Over two turns the lead loads the `rules` skill once, calls `t3-code__list_thread_pull_requests` by its bare name, and runs `orbit:gitops` as a nested subagent with no new thread. |
| Grok lead, code child on Claude | Partly verified. The lead read the roster, spawned one `delegate_task` child on the Claude provider with a subagent brief, and settled it by `childThreadId`, with no grandchild. That run passed `mode: "wait"`, so the adapter now requires `async` and ending the turn. The wake that then reopens a Grok lead's turn has not run live. T3's orchestrator sends that wake for any parent provider. |
| Other providers | Untested. |

Each Grok run used Grok's fast model at low effort, on 2026-11-16, at the commit that added the `rules` skill.
