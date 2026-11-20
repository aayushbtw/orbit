# Orbit in T3 Code

T3 Code runs orbit under a Claude lead and under a lead on another provider, such as Grok or Codex. This record says how orbit loads, finds T3's tools, fills panel seats, spawns subagents and resolves paths in each case. The [host adapter](../plugin/docs/harness/t3-code.md) holds the rules a lead follows. Two files beside it hold sections only some sessions read. A lead on another provider also reads [t3-other-lead.md](../plugin/docs/harness/t3-other-lead.md). A session whose `other-family` row lists providers, or whose `verifier` row is `other-family` or `other-family, inherit`, also reads [t3-seats.md](../plugin/docs/harness/t3-seats.md). The [README](../README.md#install) holds the setup.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/t3-lead-dark.svg">
  <img alt="You run /orbit:start. The lead checks whether Non-negotiables is already in its context. Yes for a Claude lead, because the SessionStart hook printed the rules. No for another provider, so the lead loads the rules skill, which reads rules.md. Both paths then run the playbook. The lead spawns three kinds of child. An orbit agent runs as a native subagent, nested in the same thread. A code child runs on the lead's provider. A panel seat runs through delegate_task, only on providers you listed in /orbit:setup. A child that needs its own checkout, or runs while the lead works, goes through delegate_task. Under a Codex lead, code children run on gpt-6.1-sol." src="diagrams/t3-lead-light.svg">
</picture>

## How orbit loads

A Claude lead loads orbit as a Claude Code plugin. Its SessionStart hooks print `plugin/rules.md` and `plugin/rules-shared.md` into the context, so Non-negotiables is there before the first reply.

A lead on another provider gets orbit from Claude Code's install record, `~/.claude/plugins/installed_plugins.json`. Grok reads the plugin's `installPath` from that record when orbit is enabled in Claude Code's user settings. Grok ignores a project's `.claude/settings.json`. A copy in `~/.grok/plugins/`, or one from `grok plugin install`, wins over the record, and Grok still loads orbit once. Orbit has no per-provider install. `/orbit:setup` finds a Grok install of its own and prints `grok plugin uninstall orbit` for the user to run, so Grok falls back to Claude Code's copy. `claude plugin update orbit@orbit` moves the record to a fresh copy of the new version, so it also updates what Grok loads. A directory marketplace updates Claude Code's copy on `git pull`, but Grok's copy only on `claude plugin update`.

Codex does not read Claude Code's install record. With orbit enabled in Claude Code, Codex listed no orbit skills. `/orbit:setup` therefore links `~/.codex/skills/orbit` to the folder Claude Code installs orbit from, the marketplace's `installLocation` joined with the plugin's `source`, `./plugin`. A directory marketplace's `installLocation` is the repo folder. A GitHub marketplace's is a shallow clone at `~/.claude/plugins/marketplaces/orbit`. The link skips Claude Code's install path because that path holds the version number and changes on every update. Codex then lists every skill as `orbit:<name>`, a prefix it takes from the link's folder name, and `$orbit:rules` reads `rules.md` and `rules-shared.md` through `../../rules.md` and `../../rules-shared.md`. Codex loads no orbit agents.

The same link works from `~/.agents/skills/orbit`, but Grok also scans `.agents/skills/`, so orbit uses `~/.codex/skills/orbit`. A link to `plugin/skills` alone lists the skills, but `../../rules.md` and `../../rules-shared.md` then miss. A linked Codex plugin cache folder loads nothing. `codex plugin marketplace add` reads orbit's marketplace file and installs it, but that is a second install, and orbit has one install, in Claude Code. Codex skips a second link to a folder it already loads, but two copies that resolve to different folders, such as a project's `.agents/skills/orbit` and the user link, both load. Setup reports an extra copy and prints its removal for the user to run. Codex follows the marketplace source, so `claude plugin marketplace update orbit` updates it. `claude plugin update orbit@orbit` does not pull a GitHub marketplace's clone. Claude Code children still load the record's version, which on the test machine was 0.29.3 against a source at 0.45.0. Setup compares the two versions and offers both updates on a mismatch. The Codex and Claude Code results in these two paragraphs were measured on 2026-11-16, with codex-cli 0.169.0 in a scratch home.

Grok drops the SessionStart hook output, and Codex loads only orbit's skills. `/orbit:start` therefore loads the `rules` skill when Non-negotiables is not in context, and the skill reads `../../rules.md` and `../../rules-shared.md`. A Claude lead skips that step, because the hook already printed the rules. A user who wants the rules in every session, even without `/orbit:start`, adds one line to the provider's own instruction file, as the README shows. Orbit writes that file only when the user says yes during `/orbit:setup`.

## Find T3's tools

T3 serves its tools as MCP tools, and a step probes each tool before its first call. A tool that is not present takes the adapter's absent column, so orbit keeps working outside T3.

- A Claude lead finds a tool in its tool list, or loads it with `ToolSearch`.
- A lead on another provider uses its own tool search with the bare name. Grok finds `t3-code__list_thread_pull_requests` with `search_tool` and calls it with `use_tool`. With no tool search, a tool is present when its name is in the tool list. Otherwise the first real call is the probe, and an error means absent. The lead never probes with dummy arguments, because a dummy `delegate_task` starts a thread.

## Which children get a thread

The provider picks where a child runs, not the model. Only `delegate_task` opens a child thread under the lead.

- A child on the lead's provider runs native, nested in the lead's thread. That is `Agent` under a Claude lead, `spawn_agent` under a Codex lead and `spawn_subagent` under a Grok lead.
- A child on the lead's provider that needs its own checkout, or runs while the lead keeps working, is a same-provider `delegate_task` child, as [Give a child its own checkout](#give-a-child-its-own-checkout) says.
- A child on another provider is always a `delegate_task` child. Only a panel seat on another family and the verifier seat on another family run there, as [Fill a panel seat on another family](#fill-a-panel-seat-on-another-family) says.
- Code writers, gitops and other native children never move to another provider, as [Spawn subagents under another lead](#spawn-subagents-under-another-lead) says. Under a Codex lead, a Claude model runs only as such a seat. Under a Claude lead, a Codex model runs only as such a seat.
- Orbit never opens a top-level thread with `t3_thread_launch` unless the user asks for a new thread.

## Fill a panel seat on another family

A review panel fills one seat on a model family other than the session's.

- The lead calls `orchestrator_capabilities` once per thread and reuses the result, and calls it again only after an error or a user-named provider change, or with `search` for a model the Models table names.
- The `other-family` row comes from the project's AGENTS.md, else from `~/.claude/rules/orbit-models.md`, which `/orbit:setup` writes. The roster is the list of providers in its Model cell.
- An empty cell runs the skill's own seat, and the reply says that no seat on another family is configured. `inherit` keeps the session-family seat.
- A list tries at most three listed providers outside the session's family, in list order, and never a provider the list leaves out.
- An explicit model pick is checked with `search` before it is called unavailable.
- An unavailable entry goes in the reply with its reason, whether it failed a check or its child failed.
- The seat runs through `delegate_task`, reads only, and its child thread is settled when it returns.
- Seats that write code never take a roster seat. They run on the lead's provider.

Orbit assumes no provider beyond the lead's own. Each seat on another family comes from a provider the user listed, checked at run time.

## Provider selection

The `other-family` Model cell resolves to one of four outcomes. The adapter's [t3-seats.md](../plugin/docs/harness/t3-seats.md) holds them as one table.

- An empty cell, or no row, runs the skill's session-family seat, as outside T3. The reply says that no seat on another family is configured and that `/orbit:setup` lists providers.
- `inherit` runs the session-family seat, with no line.
- A list gives at most three candidates, one per provider, in list order. An entry is a candidate when its provider is outside the session's family, is enabled, can run a cross-provider child task, lists models and offers the parent's runtime mode for a seat that runs commands. Its model must also pass the family check. The lead tries the candidates in order for one seat. They are fallbacks, not more reviewers.
- When every candidate fails at a check or after its spawn, the seat is skipped, and the reply says `Skipped <skill>'s seat on another family: every listed entry failed.` A list that ends with `inherit` runs the session-family seat instead. The verifier never skips. It runs native only when the `verifier` row's Model is `other-family, inherit`, which setup writes after the user's yes. Otherwise the lead asks the user before a native verifier runs, or holds the PR when no user can answer. A trailing `inherit` on the `other-family` row covers panel seats, not the verifier.

The family check reads the model, not only the provider. A provider's `driverKind` does not name the family of every model it serves, and an aggregator can serve the session's own family. A model is of the session's family when any token of its `id` matches the session's family word or that family's vendor, `anthropic`, `openai` or `xai`. That word comes from `inheritedModel`, not from each model the session's provider lists, because an aggregator lead lists models of several families. When `inheritedModel` is an alias such as `opus`, the word comes from the session provider's model whose `id` holds the alias. When neither gives a word, the family is unknown, and every seat says `family unverified`. A model named `auto` or `default` is opaque, so its seat says `family unverified`.

`/orbit:setup` recommends a list ranked Claude, Codex, Muse, Gemini, then Grok. For each enabled lead kind it takes the first three ranked providers outside that kind, and it recommends the union of those picks. A seat counts its three candidates after its own checks, so an entry after the third under every lead kind still runs when an earlier entry fails them. Setup names such an entry with that condition and accepts the list.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/provider-selection-dark.svg">
  <img alt="The lead reads the other-family Model cell. An empty cell runs the skill's own seat and says that no seat on another family is configured. A list is filtered by family, provider and model checks, and keeps at most three candidates. The candidates are tried in order for one seat. When all fail, the seat is skipped and the reply says so, or the native session-family seat runs when the list ends with inherit." src="diagrams/provider-selection-light.svg">
</picture>

## Spawn subagents under another lead

A lead on another provider runs every orbit agent with its native subagent tool, such as Grok's `spawn_subagent`. Children that write code in the lead's checkout run this way too, so they stay on the lead's provider. T3 shows each one as a nested node in the same thread, not as a new thread. Grok ignores an agent's `model` field, so a native subagent runs on the lead's own model. A Models cell that names a Claude model is skipped under such a lead, so that spawn runs on the lead's model too.

Codex's subagent tool, `spawn_agent`, takes no agent type, so it cannot select an orbit agent. The lead passes `fork_turns: "none"` and a brief that names the agent file, `agents/<name>.md` in the plugin folder, for the child to follow. The brief says that `${CLAUDE_PLUGIN_ROOT}` in that file is the plugin folder, because Codex leaves it literal in a file read by hand. It states the agent's `tools` limit, such as read-only for the advisor, because a hand-read file enforces none. The lead waits with `wait_agent`, then calls `close_agent` when its tool list has it, because a finished agent stays open and counts toward a limit (inferred from the Codex binary). Codex 0.169 in T3 listed no `close_agent` in a live lane on 2026-11-17. Codex reported these tools and `request_user_input` in `codex exec` on 2026-11-16. Two T3 lanes then ran `orbit:gitops` as a `spawn_agent` child, and the child read `agents/gitops.md` and called `list_thread_pull_requests` itself. In one of them the lead passed `fork_turns: "all"` instead of `"none"`.

Under a Codex lead, a spawn on the `code` role passes `model: "gpt-6.1-sol"` to `spawn_agent`, and its effort as `reasoning_effort`. If `spawn_agent` rejects the model, the lead omits it and says so. Every other role runs on the lead's model. `spawn_agent` has no worktree option. In T3, a unit that needs its own checkout runs as a same-provider `delegate_task` child, as it does under a Claude lead ([Give a child its own checkout](#give-a-child-its-own-checkout)). Outside T3, such units run one at a time in the task worktree.

`delegate_task` fills a panel seat on another family, the verifier seat, and each same-provider child that needs its own checkout or runs while the lead keeps working. The lead reads each child's result with `task_status` and settles its thread. Each brief names orbit's plugin folder as an absolute path, because the agent's own paths may arrive unexpanded.

## Give a child its own checkout

T3 sends a separate checkout and a background agent to `delegate_task`, never to an `Agent` with `isolation: "worktree"` or a background `Agent`. The adapter's Where a child runs table picks how each child runs, by what the child needs. The same table holds under a Claude lead and under a lead on another provider.

- A read-only or shared-checkout child stays a foreground `Agent` with no worktree. Examples are the `how` explainer, the advisor, judges on the session's family, audit and verify lanes, swarm workers that only read, gitops and serial delegates. A verify lane reads the head SHA from a `git archive -o` export.
- A parallel delegate, an arena runner, an interrogate adversary, a swarm worker that writes and the native verifier each run as a same-provider `delegate_task` child, with `isolation: "worktree"` and `mode: "async"`.
- An autopilot owner's build round runs the same way, so the root keeps its tick and starts the next owner as one finishes. The owner pushes, opens its PR, reads its state once with `watch-pr --once` and returns. The root babysits the PR. Each later round of the owner, a fix, a rebase or the merge, runs in the root's thread as a foreground `Agent` in the owner's worktree, which outlives the child.

The lead commits what the child needs first, because T3 copies no uncommitted edits into the child's checkout. T3 starts that checkout at HEAD of the lead thread's bound checkout, else of the project root, which can lag the task branch. So the brief names the start SHA, and the child resets its own branch there. Before that, it checks that its checkout is neither the lead's nor the project root, and stops if it is, so a child that got no worktree never moves your branch. The child commits its unit in its own worktree and reports its path, branch and commit SHA. On the completion wake, the lead checks that the commit descends from the start SHA, reviews `git show <sha>`, gitops cherry-picks the commit onto the task branch, and the lead settles the child and removes any worktree that remains. A child starts no child thread, so its own parallel units run one at a time. Each such child adds one thread to the sidebar. Outside T3, the same children run as an `Agent` with `isolation: "worktree"`. [pstack-differences.md](pstack-differences.md#own-checkout-children) records the T3 rules and the prototype behind this.

## Resolve paths

- `plugin/rules.md` writes paths as `<orbit-plugin>`. The SessionStart hooks rewrite that token to the plugin folder in `rules.md` and `rules-shared.md`, so a Claude lead sees full paths. The `rules` skill tells another lead that the token is the folder two levels above the skill's base directory.
- Skill bodies use paths relative to their own folder, because Grok leaves `${CLAUDE_PLUGIN_ROOT}` unexpanded and names each skill's base directory.
- Some skills, such as `playbook` and `worktree-cleanup`, name `${CLAUDE_SKILL_DIR}`. The adapter tells another lead that it is the skill's own base directory.
- `poteto-agent` and `gitops` keep `${CLAUDE_PLUGIN_ROOT}`. Claude Code and Grok both expand it in agent bodies. When another provider leaves it unexpanded, gitops uses the plugin folder its brief names, and with none it reports that and stops.

## What is verified

Each row is graded from tool calls by `tests/t3/grade.mjs`. [trails/live-matrix.tsv](trails/live-matrix.tsv) holds one row per scenario and lead, with each check's verdict, first-turn input tokens and wall time. A T3 row ran through `tests/t3/lane.mjs`, with orbit loaded from the SHA it names.

| Lead | Result |
| --- | --- |
| Claude lead in T3, claude-opus-5-5 | 16 of 16 scenarios PASS at `34fdaae`, 1 run each, 2026-11-17. They are `probe`, `gitops-native`, `code-child`, `foreground`, `verifier-seat`, `review-seat`, `seat-listed`, `seat-empty`, `seat-all-fail`, `verifier-all-fail`, `watch-pr-wait`, `babysit-wait`, `schedule-loop`, `schedule-only`, `parallel-units` and `autopilot-owners`. `rules-load` is N/A, because the SessionStart hook prints the rules. Rerun on 2026-11-17, `verifier-all-fail` and `code-child` PASS at `cfc882d` and `parallel-units` at `083c25e`. Read by hand, the `verifier-all-fail` lead now sends `cursor unavailable: <reason>` and `muse unavailable: <reason>` on their own lines with `send_to_user` before its question ([#72](https://github.com/aayushbtw/orbit/issues/72)). In `parallel-units` the lead passes `medium` to both code delegates, and in `code-child` it passes `low` for one fixed line, which the rule allows ([#71](https://github.com/aayushbtw/orbit/issues/71)). |
| Claude lead, headless | 1 run at `34fdaae`, 2026-11-17, of the `parallel-units` prompt outside T3. The lead ran both units as `Agent` children with `isolation: "worktree"`, and gitops cherry-picked both commits. The children committed their own units, because the Delegate gate's "gitops commits it there" step meets Claude Code's worktree guard ([#70](https://github.com/aayushbtw/orbit/issues/70)). The gate now says that path for every host. Not rerun headless after the change. |
| Codex lead in T3, gpt-6.1-sol | 17 of 17 scenarios PASS, 1 run each, 2026-11-17. 12 PASS at `34fdaae`. The 5 that failed there PASS on rerun, `autopilot-owners`, `review-seat`, `seat-empty` and `seat-all-fail` at `cfc882d` and `parallel-units` at `083c25e` ([#68](https://github.com/aayushbtw/orbit/issues/68), [#69](https://github.com/aayushbtw/orbit/issues/69)). The cause was reading. Codex cuts a long tool output in the middle, so the lead never saw the adapter's first half. The `rules` skill now names the two `delegate_task` fields a call must carry and has the lead read the adapter in parts. `review-seat` still failed at `d47c833` and `561ded7`, before the `rules` skill named the fields. |
| Grok lead in T3, grok-4.7-build-fast | Blocked at `34fdaae`, 4 runs, 2026-11-17. `rules-load`, `gitops-native`, `code-child` and `foreground` each stopped on T3's "402 Grok Build usage balance exhausted" before the lead acted. They ran at T3's default effort, high, because `t3 thread start` takes no effort option. The other 13 scenarios were not rerun. The native code child has never run live, so it is unsupported. Earlier, 1 run at `6bc2f80` on 2026-11-16, at low effort, loaded the `rules` skill once, called `t3-code__list_thread_pull_requests` by its bare name, and ran `orbit:gitops` as a nested subagent. |
| Grok lead, headless | 1 run at `6bc2f80`, 2026-11-16, at low effort. The lead loaded the `rules` skill, read `rules.md` through the relative path, quoted a Non-negotiable, and ran `orbit:gitops` with `spawn_subagent`. Not rerun at `34fdaae`. |
| Other providers | 0 runs at `34fdaae`. `orchestrator_capabilities` reported Cursor, OpenCode, Antigravity, fx, Kiro, Muse and Pi disabled on 2026-11-17, so no lane could start. Unsupported. |

No lane covers the thread-read row, the proof table's `html_preview`, the sudo flow, the Probe retry, a child retry, `task_cancel`, a later owner round, an arena, a swarm, or the verifier as a child in its own checkout. Two paths the adapter retired, a code child on Claude under a Codex or Grok lead, are out of the matrix.
