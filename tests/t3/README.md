# T3 lane harness

`lane.mjs` starts one T3 Code thread at a commit, with orbit loaded from that commit instead of the installed plugin. It sends one scenario message, waits for the reply, writes the transcript and tool calls as JSON, and removes everything it set up. Later PRs use it to prove orbit live in a T3 thread loaded from a PR head.

## How a lane loads orbit from the head

1. `git archive <head> plugin` goes into a run directory, `$TMPDIR/orbit-lane-<id>/`, next to a copy of the head's `.claude-plugin/marketplace.json` renamed `orbit-head-<id>`. The run directory also holds `lane.pid`.
2. `claude plugin marketplace add` registers the run directory. `claude plugin install orbit@orbit-head-<id> --scope user`, then `claude plugin disable` at user scope, so no other session loads it.
3. A lane commit on top of the base adds `.claude/settings.json`, merged into the base's own file if it has one, with `orbit@orbit` set to `false` and `orbit@orbit-head-<id>` set to `true`. A temporary `GIT_INDEX_FILE` and `git commit-tree` build it, so no checkout or branch moves.
4. `t3 thread start <project> - --worktree <lane commit> --branch orbit-lane/<slug>-<id> --title "orbit lane <slug> <id>" --wait --json` reads the message on stdin.

T3 honored every step. In probe thread `mcp:5e8c67e4-fc75-4904-925f-7a9ebe2f3eed`, the agent quoted a marker that existed only in the head's `orbit:how` description and listed 19 orbit skills with no duplicates. After teardown, the user's `settings.json`, `known_marketplaces.json` and `installed_plugins.json` matched their backups except for key order.

The project must be the main checkout, the parent of `git rev-parse --git-common-dir`. `t3 thread start .` fails from a T3 worktree with "No T3 Code project matches '.'".

## Why each run gets its own marketplace

The plan named one marketplace, `orbit-head`, whose run directory each run refreshes. Live lanes run in parallel at different SHAs, so a shared directory would be overwritten under a running lane. A marketplace per run also lets each run restore user settings on exit without counting how many lanes still use it.

## Run it

```sh
node tests/t3/lane.mjs --head HEAD --scenario probe
node tests/t3/lane.mjs --head <sha> --scenario probe --out head-marker.json
node tests/t3/lane.mjs --head HEAD --scenario docs-goal --message "/orbit:start fix the typo in README"
```

| Flag | Meaning |
| --- | --- |
| `--head <ref>` | Commit to load orbit from, resolved with `git rev-parse --verify <ref>^{commit}` in this repo |
| `--scenario <slug>` | Names the thread, the branch and the default output file. `probe` has a built-in message that asks for `pwd` and every `orbit:` skill with its description. Other slugs need `--message` |
| `--message <text>` | Message to send |
| `--out <file>` | Output JSON. Default `$TMPDIR/orbit-lane-<slug>-<id>.json` |
| `--project <dir>` | Run in another repo that is already a T3 project. The worktree base is that repo's `HEAD`. Default is orbit's main checkout, based on the head |
| `--installed` | Skip head loading, so orbit comes from the installed plugin |
| `--provider <id>`, `--model <slug>` | Passed to `t3` only when given. Otherwise the project default runs |
| `--timeout <minutes>` | Default 30 |

The CLI is `T3CODE_CLI_PATH`, else `t3` on `PATH`. stdout is the output path. The exit code is 0 when the agent completed, 2 when it asked a question back, and 1 otherwise. If no T3 CLI runs or the ref does not resolve, the harness prints the cause, writes the JSON when `--out` is given, and exits 1 before it starts a thread or touches settings.

## Output

```
{ scenario, message, head: { ref, sha }, project, laneCommit, orbit: "head" | "installed", marketplace,
  exit, status: "completed" | "failed" | "waiting" | "timeout" | "error", reply, error,
  pendingQuestion: [{ name, input }] | null,
  thread: { threadId, link, providerInstanceId, model, runtimeMode, branch, worktreePath } | null,
  messages: [{ role, text }], session, firstTurnInputTokens, toolCalls: [{ name, input, sidechain }] }
```

`t3 thread show` returns message text only. Tool calls, token usage and a pending question come from the Claude session file under `$CLAUDE_CONFIG_DIR/projects/` (default `.claude/projects/` in the home directory), in a folder named after the worktree path. Subagent calls carry `sidechain: true`. `firstTurnInputTokens` sums the input, cache creation and cache read tokens of the first assistant entry. On another provider, or when the file is missing, `session`, `toolCalls` and `firstTurnInputTokens` are `null`, and stderr names the folder it tried.

## Cleanup

Each step pushes its undo before it runs, and every undo ignores a step that never happened. One cleanup function runs the undos in reverse from `finally` and on SIGINT or SIGTERM. It removes the worktree with `git worktree remove --force`, deletes the branch, prunes worktrees, uninstalls the plugin, removes the marketplace and deletes the run directory. `orbit@orbit` stays enabled at user scope, because only the lane commit's project settings turn it off.

`claude plugin` edits user settings by read, modify and write, so register and unregister run under a lock directory, `$TMPDIR/orbit-lane.lock`. A lock whose pid is dead is taken over. Before it registers, a run reaps leftovers. It removes each `orbit-head-*` marketplace whose `lane.pid` is missing or names a dead process. It never touches a marketplace with any other name.

The thread outlives the lane. A follow-up message after exit runs without the head orbit, because the worktree, branch and marketplace are gone. A thread that times out or is interrupted keeps running in T3. On timeout, stderr prints its link.

## Cost

Each lane is a real T3 session on the project's default model unless `--provider` and `--model` say otherwise. The `probe` scenario takes one tool call, about 50,000 first-turn input tokens with orbit loaded. This harness is not part of Check.
