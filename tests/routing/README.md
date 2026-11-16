# Routing eval

Proves that a real `/orbit:start` run routes each delegate through the project's Models table and keeps effort at or below `high`. A lead that is only asked to list its calls can say the right thing and still spawn the wrong thing, so this eval grades the spawns that actually happen.

## What it does

1. Builds a scratch game project at `$TMPDIR/skyforge-<random>`: a camera bug past 4x zoom, a goblin HP change, and an AGENTS.md with a Models table. A bare sibling repo, `skyforge-<random>-origin.git`, is its `origin` with `main` pushed, so the Worktree gate finds `origin/main`.
2. Runs `claude -p` there on this worktree's `plugin/`, with an ordinary user request and nothing that names the experiment. `--setting-sources project,local` keeps your user settings out (your plugins, hooks, permissions and model defaults). The `--settings` file and `--plugin-dir` still load, since they are their own sources. Your `~/.claude/CLAUDE.md`, auto memory and user MCP servers may still reach the lead, so a run on a machine with routing advice in those files is confounded.
3. Records the original input of every `Agent` call through a PreToolUse hook (`hook.mjs`). The hook allows each call but rewrites it to `model: "haiku"`, `effort: "low"`, so children run cheaply while the lead's choices stay on record. A PostToolUse record of each child's `resolvedModel` shows the rewrite took effect. The hook also records each T3 `delegate_task` call, without rewriting it.
4. Grades the lead's own calls (calls from children are counted, not graded) and prints PASS, FAIL or N/A per check.

A record belongs to the lead when it has no `agent_id` and its `session_id` matches the first record's. A T3 child runs as its own session in the same project, so its hook records carry no `agent_id` but a different `session_id`. Records without a `session_id`, from runs saved before the hook logged it, count as the lead's.

## Spawn counting

A spawn is a call to `Agent` or `Task`, or to a tool whose name ends in `delegate_task` (`/(^|__)delegate_task$/`), so any MCP server prefix matches. An INFO line prints `spawns: N (Agent a, delegate_task d)`, where `a` counts `Agent` and `Task` calls, and another lists each `delegate_task` spawn with its `target`. `delegate_task` spawns stay out of the effort and routing checks, because they carry no `subagent_type`, `model` or `effort` field to grade. A run that only delegates through T3 shows N/A on `effort-present` and FAIL on the routing checks.

A spawn's effective effort is the `effort` the call passes, else the `effort` in the frontmatter of the orbit agent it spawns (`plugin/agents/*.md`). `effort-present` and `effort-ceiling` grade effective effort. The routing checks grade only the `effort` the call passes, because each table row differs from the agent's frontmatter.

An `orbit:poteto-agent` brief belongs to the unit whose file, `camera.js` or `enemies.json`, appears on its `File:` or `Files:` lines, when only one of the two does. Otherwise it belongs to the file the brief names first, since a brief usually names its own file before any it is told to leave alone.

| Check | Passes when |
| --- | --- |
| `effort-present` | Every spawn has an effective effort |
| `effort-ceiling` | No spawn runs at `xhigh` or `max`, except an `xhigh` camera delegate after 2 earlier camera delegates |
| `camera-routing` | The first camera brief passes `opus`, `effort: "high"` and `Work type: shader-math` (backticks optional) |
| `enemies-routing` | The first enemies brief passes `sonnet`, `effort: "low"` and `Work type: data-tuning` (backticks optional) |
| `gitops-routing` | Every `orbit:gitops` call passes `effort: "medium"` from the `gitops` row (frontmatter is `low`) and runs on Sonnet, passed or from its frontmatter |

N/A means the run never reached the calls the check covers. INFO lines list every lead spawn, the spawns that passed no `effort`, briefs that name neither file, and whether gitops and the verifier were reached.

## Run it

```sh
node tests/routing/run.mjs                      # opus lead, 1 run
node tests/routing/run.mjs --model sonnet --runs 3
node tests/routing/run.mjs --model fable        # fable lead, to compare with opus
node tests/routing/run.mjs --keep               # keep the scratch projects
node tests/routing/run.mjs --grade <out-dir>    # regrade saved runs, no new session
node tests/routing/run.mjs --host t3            # lead in a T3 Code thread, on the project default
node tests/routing/run.mjs --host t3 --provider <id> --model <slug>
```

It exits non-zero on any FAIL, and when `--grade` finds no `spawns.jsonl` or `run-*/` in the directory. Ctrl-C sends SIGTERM to every lead's process group, waits for each to exit, removes the scratch projects unless `--keep`, and exits 1. With `--runs N`, the runs go in parallel and the summary prints each check as k/N. Each run writes `stream.jsonl` (the lead's stream-json output), `spawns.jsonl` (the hook log), `settings.json` and `stderr.log` to `$TMPDIR/orbit-routing-<timestamp>/run-<i>/`. Under `--host t3`, `lane.json` and `stdout.log` take the place of `stream.jsonl` and `settings.json`.

## Run the lead in T3 Code

`--host t3` runs each lead through the T3 lane harness (`tests/t3/lane.mjs`, see `tests/t3/README.md`) instead of `claude -p`:

1. The scratch project commits the hook as `.claude/settings.json`, since the lane builds its worktree from the project's `HEAD`.
2. `t3 project add <scratch>` registers the project. The CLI is `T3CODE_CLI_PATH`, else `t3` on `PATH`.
3. `node tests/t3/lane.mjs --head HEAD --scenario routing --message <prompt> --project <scratch> --out <run>/lane.json` runs the lead, with stdout and stderr in `stdout.log` and `stderr.log`.
4. On exit, Ctrl-C included, `t3 project remove --force <scratch>` removes the project and its threads. It removes only the project this run added, even with `--keep`.

`--provider` and `--model` reach the lane only when given. Otherwise the T3 project default runs. `--model` takes any value T3 accepts, since the `opus`, `sonnet` and `fable` check applies to `--host claude` only. The INFO line for the lead prints the lane's status, exit code and thread link from `lane.json`. On timeout or Ctrl-C, the lane gets 60 seconds to restore user settings before SIGKILL.

A T3 run differs from a `claude -p` run in four ways, so compare the two with care:

- No `--setting-sources`. Your user plugins, hooks and settings reach the lead.
- No `--max-turns`. Only the 25-minute timeout bounds the lead.
- Orbit loads from this repo's committed `HEAD`. Uncommitted edits under `plugin/` do not reach the lead.
- `delegate_task` children run on the target the lead chose. The hook records them but does not force them to a cheap model.

## Cost

Each run is a real session of up to 25 minutes, and under `--host claude` up to 80 turns. The lead runs on the chosen model. Every `Agent` child is forced to haiku at low effort. This eval is not part of Check.
