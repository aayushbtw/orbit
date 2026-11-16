# T3 lane harness

`lane.mjs` starts one T3 Code thread at a commit, with orbit loaded from that commit instead of the installed plugin. It sends one scenario message, waits for the reply, writes the transcript and tool calls as JSON, and removes everything it set up. Later PRs use it to prove orbit live in a T3 thread loaded from a PR head.

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
node tests/t3/lane.mjs --head HEAD --scenario codex-child --provider codex --message "<task that delegates a child>" --wake 15
```

| Flag | Meaning |
| --- | --- |
| `--head <ref>` | Commit to load orbit from, resolved with `git rev-parse --verify <ref>^{commit}` in this repo |
| `--scenario <slug>` | Names the thread, the branch and the default output file. `probe` has a built-in message that asks for `pwd` and every `orbit:` skill with its description. Other slugs need `--message` |
| `--message <text>` | Message to send |
| `--out <file>` | Output JSON. Default `$TMPDIR/orbit-lane-<slug>-<id>.json` |
| `--project <dir>` | Run in another repo that is already a T3 project. The worktree base is that repo's `HEAD`. Default is orbit's main checkout, based on the head |
| `--installed` | Skip head loading, so orbit comes from the installed plugin |
| `--provider <id>`, `--model <slug>` | Passed to `t3` only when given. Otherwise the project default runs. A Codex id also links the head orbit into `.agents/skills` (see How a Codex lane loads orbit). A Codex thread started without one reports `orbit: "installed"` |
| `--timeout <minutes>` | Default 30 |
| `--wake <minutes>` | After the lead completes, keep polling `t3 thread show` until a later run of the lead posts a reply, such as the wake after an async `delegate_task` child finishes, or until this many minutes pass. Off by default |

The CLI is `T3CODE_CLI_PATH`, else `t3` on `PATH`. stdout is the output path. The exit code is 0 when the agent completed, 2 when it asked a question back, and 1 otherwise. If no T3 CLI runs or the ref does not resolve, the harness prints the cause, writes the JSON when `--out` is given, and exits 1 before it starts a thread or touches settings. On SIGINT or SIGTERM, it runs cleanup, writes the JSON with status `interrupted` and `threads` filled in, and exits 1.

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

`t3 thread show` returns message text only. Tool calls, token usage and a pending question come from the lead's session file. A table in `lane.mjs`, `SESSIONS`, holds one reader per provider kind, and the thread's `providerInstanceId` picks the reader.

- **Claude.** The session file is under `$CLAUDE_CONFIG_DIR/projects/` (default `.claude/projects/` in the home directory), in a folder named after the worktree path. Children that share the checkout write their sessions to the same folder, so the lead's session is the file whose first `user` entry is the scenario message. A message that starts with a slash command matches in the `<command-message>` form Claude records it in. Subagent calls carry `sidechain: true`. `firstTurnInputTokens` sums the input, cache creation and cache read tokens of the first assistant entry.
- **Codex.** The session file is a rollout, `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`, whose first line, `session_meta`, has `payload.cwd` equal to the worktree path. The harness reads only rollouts changed since the lane started. The lead's rollout is the one with the earliest `session_meta` timestamp. Each tool call is an `item_completed` event. An MCP call is named `mcp__<server>__<tool>` with its arguments as `input`. A shell command is named `exec_command` with `{ command, cwd }`. A native subagent's start, a `SubAgentActivity` item of kind `started`, is named `spawn_agent` with `{ agent_path, agent_thread_id, model, reasoning_effort }`. Its `completed` item is dropped, because it is not a call. A `CollabAgentToolCall` is named after its `tool` with `_agent` appended, so `wait` reads `wait_agent`, with `{ receiver_thread_ids }`. Another item type keeps its type as the name and the whole item as `input`. A native subagent writes its own rollout, whose `session_meta` has `parent_thread_id` set to its parent's id. The harness reads every rollout linked this way to the lead, grandchildren included, and adds its calls after the lead's with `sidechain: true`. `firstTurnInputTokens` is `input_tokens` of the first `token_usage_record`, which already counts cached input. `pendingQuestion` stays `null`.

With no reader for the provider, or no session file for the lead, `session`, `toolCalls` and `firstTurnInputTokens` are `null`, and stderr names the place it tried.

`threads` lists the lead first, with `parentThreadId` null. `t3 thread list` does not list `delegate_task` children, so the harness reads each `childThreadId` from the tool results of every reader's session files for the worktree: Claude's `tool_result` entries and Codex's `McpToolCall` results. A Codex lead's seats that run on Claude are found this way too. It adds a child once `t3 thread show` gives a `parentThreadId` already in `threads`, and repeats until nothing is added, so grandchildren in the folder are found too. A child's `waiting` is true when it has pending requests. A child isolated in its own worktree writes its session elsewhere, so its own children are found only when their ids appear in a tool result in a session file for the lead's worktree.

`wake` is `null` without `--wake`. With it, and once the lead completes, the harness reads `t3 thread show` at once and then every 10 seconds. The first run is the `runId` of the first message that has one, the run of the scenario message. A wake is an `assistant` message from any later `runId`, read once the thread has no `activeRunId`. T3 posts a wake as assistant messages under a new run with no user message, and `t3 thread start --wait` can return only after the wake run ends, so the first read can already hold the wake. When one arrives, `wake` is `"arrived"` and `wakes` holds the last message of each new run, with `at` set to the time the harness saw it. When none arrives in time, `wake` is `"none"`, `wakes` is empty and `status` stays `completed`. The harness then reads `threads`, `messages` and the session again, so they include the wake.

## Cleanup

Each step pushes its undo before it runs, and every undo ignores a step that never happened. One cleanup function runs the undos in reverse from `finally` and on SIGINT or SIGTERM. The `--wake` hold runs before `finally`, so cleanup waits for it to end. When the thread is not yet known, it finds the thread by title with `t3 thread list --project <project> --json` and reads its `worktreePath` with `t3 thread show --json`. It removes that worktree with `git worktree remove --force`, or the worktree on `orbit-lane/<slug>-<id>` when no thread was found. It deletes that branch and whatever branch the worktree had checked out, since orbit's Worktree gate renames it to `<type>/<slug>`. It deletes only branches that did not exist before `t3 thread start`, so a thread that checks out an existing branch never loses it. It removes the worktree's parent folder when that folder is empty, since T3 keeps one per project. Then it prunes worktrees. A Codex lane moves each folder that `codex-skills.json` lists back to its original path, then deletes `codex-skills.json`. If something new sits at a path by then, the harness keeps the new one and moves the saved copy next to the skills root as `orbit.orbit-lane-<id>`, such as `~/.codex/orbit.orbit-lane-<id>`, and prints that path. It never deletes that copy. It goes next to the root, not in it, because Codex loads a folder in a skills root under any name. If a move fails, `codex-skills.json` stays, and the harness keeps the run directory and prints its path. Last, it uninstalls the plugin, removes the marketplace and deletes the run directory. Orbit plugins enabled at user scope stay enabled, because only the lane commit's project settings turn them off.

`claude plugin` edits user settings by read, modify and write, so register and unregister run under a lock directory, `$TMPDIR/orbit-lane.lock`. A lock whose pid is dead is taken over. Before it registers, a run reaps leftovers. It removes each `orbit-head-*` marketplace whose `lane.pid` is missing or names a dead process, and first moves back each folder that the dead run's `codex-skills.json` records, the same way cleanup does. It never touches a marketplace with any other name.

Only one Codex lane at a time may hold the user-level orbit folders. Under the lock, a Codex lane fails before it starts a thread when another live lane's run directory holds `codex-skills.json`. A second Codex lane would otherwise find the folders already gone, and the first lane's cleanup would put them back mid-run.

The thread outlives the lane. A follow-up message after exit runs without the head orbit, because the worktree, branch and marketplace are gone. A thread that times out or is interrupted keeps running in T3. On timeout, stderr prints its link.

The `t3` CLI has no settle command. `t3 thread` has only `list`, `start`, `send` and `show`. So the agent that ran the lane settles each thread in `threads`, children included, with the T3 tool `t3_thread_organize`, action `settle`. Settle refuses a thread that waits on a question, so a thread whose `waiting` is true gets action `archive` instead. That keeps every thread listed in `threads` out of the operator's sidebar.

## Cost

Each lane is a real T3 session on the project's default model unless `--provider` and `--model` say otherwise. The `probe` scenario takes one tool call, about 50,000 first-turn input tokens with orbit loaded. This harness is not part of Check.
