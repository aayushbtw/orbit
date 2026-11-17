# T3 lane harness

`lane.mjs` starts one T3 Code thread at a commit, with orbit loaded from that commit instead of the installed plugin. It sends one scenario message, waits for the reply, writes the transcript and tool calls as JSON, and removes everything it set up. Later PRs use it to prove orbit live in a T3 thread loaded from a PR head. `grade.mjs` then grades the saved JSON from its tool calls, with no session and no T3 (see Grade a lane).

## How a lane loads orbit from the head

1. `git archive <head> plugin` goes into a run directory, `$TMPDIR/orbit-lane-<id>/`, next to a copy of the head's `.claude-plugin/marketplace.json` renamed `orbit-head-<id>`. The run directory also holds `lane.pid`.
2. `claude plugin marketplace add` registers the run directory. `claude plugin install orbit@orbit-head-<id> --scope user`, then `claude plugin disable` at user scope, so no other session loads it.
3. A lane commit on top of the base adds `.claude/settings.json`, merged into the base's own file if it has one. Every `orbit@*` plugin enabled in the user settings or the base's project settings is set to `false`, and `orbit@orbit-head-<id>` is set to `true`. A temporary `GIT_INDEX_FILE` and `git commit-tree` build it, so no checkout or branch moves.
4. `t3 thread start <project> - --worktree <lane commit> --branch orbit-lane/<slug>-<id> --title "orbit lane <slug> <id>" --wait --json` reads the message on stdin.

T3 honored every step. In probe thread `mcp:5e8c67e4-fc75-4904-925f-7a9ebe2f3eed`, the agent quoted a marker that existed only in the head's `orbit:how` description and listed 19 orbit skills with no duplicates. After teardown, the user's `settings.json`, `known_marketplaces.json` and `installed_plugins.json` matched their backups except for key order.

The project must be the main checkout, the parent of `git rev-parse --git-common-dir`. `t3 thread start .` fails from a T3 worktree with "No T3 Code project matches '.'".

## How a Codex lane loads orbit

Codex loads orbit's skills, as `orbit:<name>`, from a folder named `orbit` in a skills root that is or links to orbit's whole plugin folder. It reads three roots: `.agents/skills` in the session's working directory, `$CODEX_HOME/skills` (default `.codex/skills` in the home directory) and `.agents/skills` in the home directory. Two links to the same folder load once. Two copies that resolve to different folders both load. With `--provider codex`, and without `--installed`, a lane adds two steps to the four above:

1. The lane commit also adds `.agents/skills/orbit`, a symlink (git mode `120000`) to the run directory's `plugin` folder by absolute path. The Claude marketplace install stays, so a seat on another family that runs on Claude, such as the verifier, loads the head orbit too.
2. The lane moves each user-level orbit Codex would load, `$CODEX_HOME/skills/orbit` and `~/.agents/skills/orbit`, into the run directory as `codex-skills-orbit` and `agents-skills-orbit` before it starts the thread. It first writes `codex-skills.json` there with each original path, its name in the run directory and, for a symlink, its target.

The provider kind comes from the start of the provider instance id, so `codex` and `codex-work` are both Codex.

Without `--provider`, the thread runs on the project's default provider, which the CLI does not report before the thread starts. If that turns out to be Codex, the lane made neither step, so Codex loaded whatever user-level orbit it found. The harness then sets `orbit` to `"installed"` and prints a warning that names the `--provider` value to pass. It does not fail, because the run's transcript and tool calls are still valid for the installed orbit.

## Why each run gets its own marketplace

The plan named one marketplace, `orbit-head`, whose run directory each run refreshes. Live lanes run in parallel at different SHAs, so a shared directory would be overwritten under a running lane. A marketplace per run also lets each run restore user settings on exit without counting how many lanes still use it.

## Run it

```sh
node tests/t3/lane.mjs --head HEAD --scenario probe
node tests/t3/lane.mjs --head <sha> --scenario probe --out head-marker.json
node tests/t3/lane.mjs --head HEAD --scenario docs-goal --message "/orbit:start fix the typo in README"
node tests/t3/lane.mjs --head HEAD --scenario probe --provider codex --model gpt-6-luna
node tests/t3/lane.mjs --head HEAD --scenario gitops-native --provider codex
node tests/t3/lane.mjs --head HEAD --scenario codex-child --provider codex --message "<task that delegates a child>" --wake 15
```

| Flag | Meaning |
| --- | --- |
| `--head <ref>` | Commit to load orbit from, resolved with `git rev-parse --verify <ref>^{commit}` in this repo |
| `--scenario <slug>` | Names the thread, the branch and the default output file. A slug in `scenarios.mjs` sends that scenario's prompt. Other slugs need `--message` |
| `--message <text>` | Message to send. It replaces the scenario's prompt |
| `--out <file>` | Output JSON. Default `$TMPDIR/orbit-lane-<slug>-<id>.json` |
| `--project <dir>` | Run in another repo that is already a T3 project. The worktree base is that repo's `HEAD`. Default is the scenario's project when it has one (see Scenario projects), else orbit's main checkout, based on the head |
| `--installed` | Skip head loading, so orbit comes from the installed plugin |
| `--provider <id>`, `--model <slug>` | Passed to `t3` only when given. Otherwise the project default runs. A Codex id also links the head orbit into `.agents/skills` (see How a Codex lane loads orbit). A Codex thread started without one reports `orbit: "installed"` |
| `--timeout <minutes>` | Default 30 |
| `--wake <minutes>` | After the lead completes, keep polling `t3 thread show` until a later run of the lead posts a reply, such as the wake after an async `delegate_task` child finishes, or until this many minutes pass. Off by default |

The CLI is `T3CODE_CLI_PATH`, else `t3` on `PATH`. stdout is the output path. The exit code is 0 when the agent completed, 2 when it asked a question back, and 1 otherwise. If no T3 CLI runs or the ref does not resolve, the harness prints the cause, writes the JSON when `--out` is given, and exits 1 before it starts a thread or touches settings. On SIGINT or SIGTERM, it runs cleanup, writes the JSON with status `interrupted` and `threads` filled in, and exits 1.

## Scenario projects

A scenario whose check depends on the project's Workflow block names a `project` in `scenarios.mjs`, and the lane runs there unless `--project` is given. `review-seat` and `verifier-seat` need one, because orbit's own `AGENTS.md` sets the `other-family` row to `inherit`, so a correct lead in orbit keeps every seat native and `seat-other-family` cannot pass. They share the `seats` project. Its `AGENTS.md` Models table has these rows, in the format of rules.md Workflow Defaults, Models:

```
| other-family | panel seat on another family | codex, claudeAgent | |
| verifier | runs the change before it lands | other-family | |
```

A Claude or Grok lead takes the `codex` seat. A Codex lead skips the entry of its own family and takes `claudeAgent`. A second commit adds `median.mjs` and its test, which the two prompts name as the change to review or verify.

A project's spec is a name and a list of commits, each a message and its files. The lane builds it once at `$TMPDIR/orbit-lane-project-<name>-<hash>`, where the hash covers the commits, so a changed spec gets a new folder. It builds the repo in a sibling folder and renames it into place, so a crashed build never leaves a half-made project. It then runs `t3 project add` when `t3 thread list --project <dir>` does not find the project. Both steps run under the lock. The folder and the T3 project stay for the next lane, because removing a T3 project also deletes its threads.

## Output

```
{ scenario, message, head: { ref, sha }, project, laneCommit, orbit: "head" | "installed", marketplace,
  exit, status: "completed" | "failed" | "waiting" | "timeout" | "interrupted" | "error", reply, error,
  wake: null | "arrived" | "none", wakes: [{ at, text }],
  pendingQuestion: [{ name, input }] | null,
  thread: { threadId, link, providerInstanceId, model, runtimeMode, branch, worktreePath } | null,
  threads: [{ threadId, link | null, waiting, parentThreadId | null }],
  messages: [{ role, text }], session, firstTurnInputTokens, toolCalls: [{ name, input, sidechain }] }
```

`t3 thread show` returns message text only. Tool calls, token usage and a pending question come from the lead's session file. A table in `sessions.mjs`, `READERS`, holds one reader per provider kind, and the thread's `providerInstanceId` picks the reader. `lane.mjs`, `grade.mjs` and `fixtures/make.mjs` all use it.

- **Claude.** The session file is under `$CLAUDE_CONFIG_DIR/projects/` (default `.claude/projects/` in the home directory), in a folder named after the worktree path. Children that share the checkout write their sessions to the same folder, so the lead's session is the file whose first `user` entry is the scenario message. A message that starts with a slash command matches in the `<command-message>` form Claude records it in. Subagent calls carry `sidechain: true`. `firstTurnInputTokens` sums the input, cache creation and cache read tokens of the first assistant entry.
- **Codex.** The session file is a rollout, `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`, whose first line, `session_meta`, has `payload.cwd` equal to the worktree path. The harness reads only rollouts changed since the lane started. The lead's rollout is the one with the earliest `session_meta` timestamp. Each tool call is an `item_completed` event. An MCP call is named `mcp__<server>__<tool>` with its arguments as `input`. A shell command is named `exec_command` with `{ command, cwd }`. A native subagent's start, a `SubAgentActivity` item of kind `started`, is named `spawn_agent`. Its input is the arguments of the `spawn_agent` function call with the same `call_id`, such as `task_name`, `fork_turns` and `model`, without the encrypted `message`. It adds `agent_path`, `agent_thread_id`, `resolved_model` and `resolved_reasoning_effort` from the item. So `model` is set only when the lead passed one, and `resolved_model` is the model the child ran on. `fork_turns` is absent when the lead omitted it, which Codex treats as `"all"`. With no matching function call, the input holds `join: "missing"` instead of the arguments. Its `completed` item is dropped, because it is not a call. A `CollabAgentToolCall` is named after its `tool` with `_agent` appended, so `wait` reads `wait_agent`, with `{ receiver_thread_ids }`. Another item type keeps its type as the name and the whole item as `input`. A native subagent writes its own rollout, whose `session_meta` has `parent_thread_id` set to its parent's id. The harness reads every rollout linked this way to the lead, grandchildren included, and adds its calls after the lead's with `sidechain: true`. `firstTurnInputTokens` is `input_tokens` of the first `token_usage_record`, which already counts cached input. `pendingQuestion` stays `null`.
- **Grok.** The session file is `$GROK_HOME/sessions/<worktree path, URL-encoded>/<id>/chat_history.jsonl` (default `.grok/sessions/` in the home directory). The lead's session is the one whose first `<user_query>` is the scenario message. Each tool call keeps its name, and its `arguments`, parsed as JSON, become `input`, such as `read_file` with `{ target_file }`, `spawn_subagent` with `{ subagent_type, background }` and `use_tool` with `{ tool_name: "t3-code__<tool>", tool_input }`. Each folder under the lead's `subagents/` names a child session in the same sessions folder, and its calls follow the lead's with `sidechain: true`. Grok records usage per turn, so `firstTurnInputTokens` is `null`. `pendingQuestion` lists the lead's calls that have no `tool_result`. No Grok lane ran at this head. The reader was proven offline on one real T3 session, `orbit-lane-grok-t3-t34-b0a55d382c241abf`.

With no reader for the provider, or no session file for the lead, `session`, `toolCalls` and `firstTurnInputTokens` are `null`, and stderr names the place it tried.

`threads` lists the lead first, with `parentThreadId` null. `t3 thread list` does not list `delegate_task` children, so the harness reads each `childThreadId` from the tool results of every reader's session files for the worktree. Those are Claude's and Grok's `tool_result` entries and Codex's `McpToolCall` results. A Codex lead's seats that run on Claude are found this way too. It adds a child once `t3 thread show` gives a `parentThreadId` already in `threads`, and repeats until nothing is added, so grandchildren in the folder are found too. A child's `waiting` is true when it has pending requests. A child isolated in its own worktree writes its session elsewhere, so its own children are found only when their ids appear in a tool result in a session file for the lead's worktree.

`wake` is `null` without `--wake`. With it, and once the lead completes, the harness reads `t3 thread show` at once and then every 10 seconds. The first run is the `runId` of the first message that has one, the run of the scenario message. A wake is an `assistant` message from any later `runId`, read once the thread has no `activeRunId`. T3 posts a wake as assistant messages under a new run with no user message, and `t3 thread start --wait` can return only after the wake run ends, so the first read can already hold the wake. When one arrives, `wake` is `"arrived"` and `wakes` holds the last message of each new run, with `at` set to the time the harness saw it. When none arrives in time, `wake` is `"none"`, `wakes` is empty and `status` stays `completed`. The harness then reads `threads`, `messages` and the session again, so they include the wake.

## Grade a lane

`scenarios.mjs` holds each scenario's prompt and its checks. A check holds one expectation per provider kind, `claude`, `codex` and `grok`, over the raw `toolCalls`. An expectation says that `some` call, or `none`, matches a tool name, an input shape and who made it, `lead`, `child` or `any`. `anyOf` passes when any expectation it lists passes. A shape names only the input keys it checks. Each leaf is a literal, a RegExp that tests a string or any string in an array, `ABSENT` for a missing key, or a function. A provider with no expectation is N/A, and the check's `na` gives the reason. So the table is the one place that says what each lead must call.

| Scenario | Checks | Passes when |
| --- | --- | --- |
| `probe` | `ran-pwd`, `loaded-no-skill` | The lead runs `pwd` and loads no skill |
| `rules-load` | `rules-read` | A Codex lead reads `rules.md`. A Grok lead reads the `rules` skill or `rules.md`. N/A on Claude, whose SessionStart hook prints the rules |
| `gitops-native` | `gitops-native-child`, `no-child-thread` | gitops runs as a native child, `Agent` or `spawn_subagent` with `orbit:gitops`, or `spawn_agent` with `fork_turns: "none"`. No `delegate_task` |
| `code-child` | `code-native-child`, `no-child-thread` | The code child runs native, as `orbit:poteto-agent`, or on Codex with `fork_turns: "none"` and `model: "gpt-6.1-sol"`. No `delegate_task` |
| `verifier-seat` | `verifier-ran`, `seat-other-family` | A verifier runs, and it is a `delegate_task` seat on another family in a worktree |
| `review-seat` | `seat-other-family`, `request-id` | The lead calls `delegate_task` with `role: "review"`, `mode: "async"`, no `runtimeMode` and a provider of another family, and that same call has a `clientRequestId` |
| `watch-pr-wait` | `lead-watches`, `no-child-watches` | The lead calls `watch_pull_request` on a PR URL, and no child does |
| `schedule-loop` | `bound-to-thread`, `interval-min-60s` | `schedule_task` has `bindToCurrentThread: true`, and no interval is under 60000 ms |

The `gitops-native` and `code-child` prompts are the ones the Codex lanes ran. The `watch-pr-wait` prompt is the hillclimb wake lane's, with its PR URL replaced. The rest are drafts that live lanes may tune.

```sh
node tests/t3/grade.mjs tests/t3/fixtures/*.json
node tests/t3/grade.mjs "$TMPDIR"/orbit-lane-gitops-native-*.json
```

For each lane, `grade.mjs` prints `<file>  <scenario>  <provider>`, then one line per check with `PASS`, `FAIL` or `N/A`, the check and why. A `PASS` names the matching call by its position, counted from 1. A `FAIL` names the call it missed and the nearest call with that name. A `spawn_agent` with `join: "missing"` fails with a why that says its call args were not found. A lane whose `status` is not `completed` fails every check, N/A ones included. A lane whose `toolCalls` is `null` fails every check that applies.

The exit code is 0 when no check fails and 1 when any check fails. It is 2 when a file cannot be graded, because it is not valid JSON, names an unknown scenario, has a `thread.providerInstanceId` no reader knows, has no `toolCalls` key, or has a `toolCalls` that is neither `null` nor a list of calls that each have a string `name`. stderr then names the file and the reason. Exit 2 wins over exit 1.

## Fixtures

`fixtures/*.json` are graded lanes. Each keeps `scenario`, `message`, `status`, `thread` with `providerInstanceId` and `model`, `toolCalls` and `fixture`. `fixture` has these fields.

- `origin` is `real` for calls read from a session file, and `hand-built` for a copy edited by hand.
- `source` names the session file or lane folder of a real fixture, or the fixture a hand-built one was copied from. It is never an absolute path.
- `relabeled` is true when `message`, the prompt the session ran, differs from the scenario's prompt.
- `note` says what the lane shows.
- `expect` maps every check of the scenario to `PASS`, `FAIL` or `N/A`.

`fixtures/make.mjs` builds a real fixture from a session file.

```sh
node tests/t3/fixtures/make.mjs --provider codex --session ~/.codex/sessions/2026/11/16/rollout-<id>.jsonl \
  --scenario gitops-native --out tests/t3/fixtures/codex-gitops-native.json --note "<what it shows>"
```

It reads the calls with the reader `lane.mjs` uses, and the message and model from the session. It keeps only the input keys some shape in `scenarios.mjs` names, plus `subagent_type`, `tool_name`, `command` and `join`. It cuts a string over 200 characters to its first 60, and rewrites the temp folder to `$TMPDIR` and the home folder to `~`. It grades the raw calls and the kept calls, and writes nothing when a verdict differs. `expect` holds the verdicts of the kept calls, so read them before you commit. `--source` replaces the default, the session file's name. Pass the lane folder for a Claude session, whose file name is a bare id.

| File | Origin | Source | Shows |
| --- | --- | --- | --- |
| `claude-probe.json` | real | `orbit-lane-probe-fa8172` | A Claude lead runs `pwd` and loads no skill |
| `claude-gitops-native.json` | real | `orbit-lane-gitops-native-c1ab0a` | A Claude lead spawns `orbit:gitops` as an `Agent` |
| `claude-code-child.json` | real, relabeled | `orbit-lane-routing-8524-8094ae89ae7d6368` | A Claude lead spawns `orbit:poteto-agent` as an `Agent` |
| `claude-review-seat-pre-1f80b16.json` | real, relabeled | `orbit-lane-interrogate--5b3974d12a498483` | A seat on Grok with no `clientRequestId`, before 1f80b16 asked for one. `request-id` fails |
| `claude-review-seat.json` | hand-built | the fixture above | The same seat call with a `clientRequestId` |
| `claude-rules-load.json` | hand-built | none | `rules-read` is N/A on a Claude lead |
| `claude-schedule-loop.json` | real, relabeled | `orbit-lane-hillclimb-wa-2d6d996f1cc0dfc1` | A `once` `schedule_task` bound to the thread |
| `claude-verifier-seat-pre-79ebe0b.json` | real, relabeled | `orbit-lane-verifier-t3--018b867cd5f861e4` | The native verifier, before 79ebe0b put it on another family. `seat-other-family` fails |
| `claude-verifier-seat.json` | hand-built | the fixture above | A verifier seat on Codex in a worktree |
| `claude-watch-pr-wait.json` | real, relabeled | `orbit-lane-hillclimb-wa-8d91928f07af12fb` | The lead arms `watch_pull_request` |
| `codex-code-child.json` | real | `rollout-2026-11-17T00-05-00-01a1e5f6` | `spawn_agent` with `fork_turns: "none"` and `model: "gpt-6.1-sol"` |
| `codex-gitops-fork-all.json` | hand-built | `codex-gitops-native.json` | `fork_turns: "all"` fails `gitops-native-child` |
| `codex-gitops-fork-omitted.json` | real | `rollout-2026-11-16T22-39-02-01a1e5a7` | The lead omitted `fork_turns` although its adapter asked for `"none"`. `gitops-native-child` fails |
| `codex-gitops-native.json` | real | `rollout-2026-11-16T23-09-55-01a1e5c4` | `spawn_agent` with `fork_turns: "none"` |
| `codex-rules-load.json` | real, relabeled | the rollout of `codex-gitops-fork-omitted.json` | The lead reads `rules.md` |
| `grok-code-child-pre-b8e7318.json` | real, relabeled | `orbit-verify-grok-code--54dd8bbf7b523bfa` | A code child on Claude through `delegate_task`, before b8e7318 kept code children native. Both checks fail |
| `grok-code-child.json` | hand-built | the fixture above | A native `spawn_subagent` as `orbit:poteto-agent`. No such Grok lane has run live |
| `grok-gitops-native.json` | real, relabeled | `orbit-lane-grok-t3-t34-b0a55d382c241abf` | `spawn_subagent` as `orbit:gitops` |
| `grok-rules-load.json` | real, relabeled | the session of `grok-gitops-native.json` | The lead reads the `rules` skill, then `rules.md` |

A real session that ran before a rule landed is named for the commit that added the rule, and a hand-built copy that follows the rule passes. `fixtures/invalid/truncated.json` is the first 800 bytes of `codex-code-child.json`, so `grade.mjs` exits 2 on it. The `invalid` folder keeps it out of `fixtures/*.json`.

`grade.test.mjs` runs in CI. Each fixture must grade to its `expect`, name every check of its scenario, and set `relabeled` correctly. Every check needs an expectation or an `na` reason for each provider, never both. No fixture may hold a home or temp path, an email address or a token. The test also tests the CLI exit codes, and prints a `no fixture:` line for each provider cell that no fixture exercises.

## Cleanup

Each step pushes its undo before it runs, and every undo ignores a step that never happened. One cleanup function runs the undos in reverse from `finally` and on SIGINT or SIGTERM. The `--wake` hold runs before `finally`, so cleanup waits for it to end. When the thread is not yet known, it finds the thread by title with `t3 thread list --project <project> --json` and reads its `worktreePath` with `t3 thread show --json`. It removes that worktree with `git worktree remove --force`, or the worktree on `orbit-lane/<slug>-<id>` when no thread was found. It may delete that branch and whatever branch the worktree had checked out, since orbit's Worktree gate renames it to `<type>/<slug>`. Before `t3 thread start` it records every branch, and it refuses to start when `orbit-lane/<slug>-<id>` matches one of them with case ignored. It then deletes a branch only when all of these hold, so a thread that checks out an existing branch never loses it:

- The ref starts with `refs/heads/`, so a `HEAD` pointed at `refs/tags/v1` deletes nothing.
- `git for-each-ref refs/heads` lists the ref by that exact name. On a case-insensitive disk, git resolves `refs/heads/Main` to the file of `refs/heads/main`, but lists only `main`.
- No branch recorded before the thread started matches it with case ignored.
- The oldest entry of its reflog, or its tip when it has no reflog, is the lane commit, the SHA T3 created the lane branch at. A rename keeps the reflog, so the renamed branch still qualifies.

It deletes with `git update-ref --no-deref -d <ref> <sha>`, so a symbolic ref loses only itself and a branch that moved since the check is kept. `lane.test.mjs` runs these cases against a stub `t3` and a throwaway repo. It removes the worktree's parent folder when that folder is empty, since T3 keeps one per project. Then it prunes worktrees. A Codex lane moves each folder that `codex-skills.json` lists back to its original path, then deletes `codex-skills.json`. If something new sits at a path by then, the harness keeps the new one and moves the saved copy next to the skills root as `orbit.orbit-lane-<id>`, such as `~/.codex/orbit.orbit-lane-<id>`, and prints that path. It never deletes that copy. It goes next to the root, not in it, because Codex loads a folder in a skills root under any name. If a move fails, `codex-skills.json` stays, and the harness keeps the run directory and prints its path. Last, it uninstalls the plugin, removes the marketplace and deletes the run directory. Orbit plugins enabled at user scope stay enabled, because only the lane commit's project settings turn them off.

`claude plugin` edits user settings by read, modify and write, so register and unregister run under a lock directory, `$TMPDIR/orbit-lane.lock`. A lock whose pid is dead is taken over. Before it registers, a run reaps leftovers. It removes each `orbit-head-*` marketplace whose `lane.pid` is missing or names a dead process, and first moves back each folder that the dead run's `codex-skills.json` records, the same way cleanup does. It never touches a marketplace with any other name.

Only one Codex lane at a time may hold the user-level orbit folders. Under the lock, a Codex lane fails before it starts a thread when another live lane's run directory holds `codex-skills.json`. A second Codex lane would otherwise find the folders already gone, and the first lane's cleanup would put them back mid-run.

The thread outlives the lane. A follow-up message after exit runs without the head orbit, because the worktree, branch and marketplace are gone. A thread that times out or is interrupted keeps running in T3. On timeout, stderr prints its link.

The `t3` CLI has no settle command. `t3 thread` has only `list`, `start`, `send` and `show`. So the agent that ran the lane settles each thread in `threads`, children included, with the T3 tool `t3_thread_organize`, action `settle`. Settle refuses a thread that waits on a question, so a thread whose `waiting` is true gets action `archive` instead. That keeps every thread listed in `threads` out of the operator's sidebar.

## Cost

Each lane is a real T3 session on the project's default model unless `--provider` and `--model` say otherwise. The `probe` scenario takes one tool call, about 50,000 first-turn input tokens with orbit loaded. Lanes are not part of Check. `grade.mjs` and its tests read only saved JSON, so they cost no session.
