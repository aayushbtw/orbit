# Routing eval

This folder holds two evals. `run.mjs` grades delegate routing, and `flows.mjs` grades flow selection. Both share the lead launcher in `lead.mjs` and the hook in `hook.mjs`.

`run.mjs` proves that a real `/orbit:start` run routes each delegate through the project's Models table and keeps effort at or below `high`. A lead that is only asked to list its calls can say the right thing and still spawn the wrong thing, so this eval grades the spawns that actually happen. The sections up to [Flow selection](#flow-selection) cover `run.mjs`.

## What it does

1. Builds a scratch game project at `$TMPDIR/skyforge-<random>`: a camera bug past 4x zoom, a goblin HP change, and an AGENTS.md with a Models table. A bare sibling repo, `skyforge-<random>-origin.git`, is its `origin` with `main` pushed, so the Worktree gate finds `origin/main`.
2. Runs `claude -p` there on this worktree's `plugin/`, with an ordinary user request and nothing that names the experiment. `--setting-sources project,local` keeps your user settings out (your plugins, hooks, permissions and model defaults). The `--settings` file and `--plugin-dir` still load, since they are their own sources. Your `~/.claude/CLAUDE.md`, auto memory and user MCP servers may still reach the lead, so a run on a machine with routing advice in those files is confounded.
3. Records the original input of every `Agent` call through a PreToolUse hook (`hook.mjs`). The matcher is anchored, `^(Agent|Task|.*delegate_task)$`, so tools such as `TaskStop` and `ListAgents` never reach the hook. The hook allows every call it matches, so a session without bypass permissions never stalls on one. It rewrites only `Agent` and `Task` calls, to `model: "haiku"`, `effort: "low"`, so children run cheaply while the lead's choices stay on record. A PostToolUse record of each child's `resolvedModel` shows the rewrite took effect. The hook also records each T3 `delegate_task` call, without rewriting it. The hook command runs the same `node` binary as `run.mjs`, so a T3 app launched without `node` on `PATH` still runs it.
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

Before the lead starts, each run writes `meta.json`, `{ sha, dirty }`. `sha` is orbit's `HEAD`, and `dirty` is true when `git status --porcelain` in this repo prints anything. The summary prints `orbit <sha>`, with ` (dirty)` after it for a dirty tree. A live run also writes `summary.json` to the output root, with the SHA, host, model, run count and each check's pass count. `--grade` writes nothing. It prints `orbit unrecorded` for runs saved before `meta.json` existed.

## Run the lead in T3 Code

`--host t3` runs each lead through the T3 lane harness (`tests/t3/lane.mjs`, see `tests/t3/README.md`) instead of `claude -p`:

1. The scratch project commits the hook as `.claude/settings.json`, since the lane builds its worktree from the project's `HEAD`.
2. `t3 project add <scratch>` registers the project. The CLI is `T3CODE_CLI_PATH`, else `t3` on `PATH`.
3. `node tests/t3/lane.mjs --head HEAD --scenario routing --message <prompt> --project <scratch> --out <run>/lane.json --timeout 23` runs the lead, with stdout and stderr in `stdout.log` and `stderr.log`.
4. On exit, Ctrl-C included, `t3 project remove --force <scratch>` removes the project and its threads. It removes only the project this run added, even with `--keep`.
5. The lane writes `lane.json` on completion, on its own timeout and on Ctrl-C. When the removal fails, stderr logs `t3 project remove ...`. Then the agent running the eval settles each thread in that run's `lane.json` `threads`, `delegate_task` children included, with the T3 tool `t3_thread_organize`, action `settle`. A thread whose `waiting` is true gets action `archive`, since settle refuses a thread that waits on a question.

`--provider` and `--model` reach the lane only when given. Otherwise the T3 project default runs. `--model` takes any value T3 accepts, since the `opus`, `sonnet` and `fable` check applies to `--host claude` only. The INFO line for the lead prints the lane's status, exit code and thread link from `lane.json`. The lane's `--timeout` is 2 minutes below the 25-minute kill, so the lane times out first and records the thread itself. On the kill or Ctrl-C, the lane gets 60 seconds to restore user settings and write `lane.json` before SIGKILL.

A T3 run differs from a `claude -p` run in four ways, so compare the two with care:

- No `--setting-sources`. Your user plugins, hooks and settings reach the lead.
- No `--max-turns`. Only the lane's 23-minute timeout bounds the lead.
- Orbit loads from this repo's committed `HEAD`. Uncommitted edits under `plugin/` do not reach the lead, so a run marked `(dirty)` still ran the recorded SHA.
- `delegate_task` children run on the target the lead chose. The hook records and allows them but does not force them to a cheap model.

## Flow selection

`flows.mjs` proves which route `/orbit:start` picks for each of the 14 prompts in `flows.json`. Each prompt targets one row of the table in `docs/guide/01-start-a-task.md`. Each row of `flows.json` names the route it expects in `expect`.

Each route runs one lead on its own scratch project, the same project `run.mjs` builds, with at most 12 turns and a 12-minute timeout:

1. `claude -p` expands the slash command, so the lead's first route decision is a `Skill` call. The hook matcher is `^(Skill|Agent|Task|.*delegate_task)$`.
2. `hook.mjs` runs in `stop` mode. It logs every matched call. On the first route `Skill` call or spawn, it returns `continue: false`, so the lead stops after that turn.
3. `orbit:start` and `orbit:rules` are not routes. The hook allows them and the grade skips them.
4. The grade reads the lead's first route `Skill` call or spawn. A spawn grades as `spawn before Skill`. A run with neither grades as `no route`.

The route id is `orbit:playbook <first word of args>` for a playbook call, such as `orbit:playbook bug`, and the bare skill name otherwise, such as `orbit:ship`. A row passes when its route id equals `expect`. A `--prompt` run has no `expect`, so it prints N/A.

Each route writes to `$TMPDIR/orbit-flows-<timestamp>/<route>/`. `run.json` holds the prompt, `expect`, `sha`, `dirty`, host and model, and after the run the measured `turns`, `cost`, `cache_read` and `cache_creation`. `spawns.jsonl` is the hook log and `stream.jsonl` is the lead's output. A live run also writes `summary.json` at the root, with one row per route and the total cost. Under `--host t3` there is no `stream.jsonl`, so these fields are null and the cost is reported as unknown. A route with no cost prints `cost=-`, and when any route lacks a cost, the total line prints `cost unknown` and `summary.json` records `"cost": null`.

```sh
node tests/routing/flows.mjs                              # all 14 routes, opus lead, 4 at a time
node tests/routing/flows.mjs --route bug,ship             # only these routes
node tests/routing/flows.mjs --prompt "/orbit:start ..."  # one ad hoc prompt, graded N/A
node tests/routing/flows.mjs --model haiku                # opus, sonnet, fable or haiku
node tests/routing/flows.mjs --jobs 2                     # leads at once, default 4
node tests/routing/flows.mjs --keep                       # keep the scratch projects
node tests/routing/flows.mjs --grade-only <dir>           # regrade every run.json under <dir>
node tests/routing/flows.mjs --host t3 --route bug        # lead in a T3 Code thread
```

`--host t3` needs `--route` or `--prompt`. Each route is its own T3 lane thread, and a PR may run at most 4.

It exits 0 only when every row meets its `want`, which defaults to PASS. N/A rows always meet it. A fixture's `run.json` carries `want`, so a fixture can require a FAIL. `fixtures/flows/` holds one refactor capture, its hook line rebuilt from a real probe's output, graded three ways. `pass/` expects `orbit:playbook refactor`, and `fail/` expects `orbit:playbook feature` with `want: "FAIL"`. `t3/` is the `pass/` capture with null `turns` and `cost`, as a T3 run records it, so the total prints `cost unknown`. This command regrades all three with no session:

```sh
node tests/routing/flows.mjs --grade-only tests/routing/fixtures
```

Only Claude leads are graded. Codex and Grok leads fire no `Skill` hook, so their route decision never reaches the log.

## Cost

Each `run.mjs` run is a real session of up to 25 minutes, and under `--host claude` up to 80 turns. The lead runs on the chosen model. Every `Agent` child is forced to haiku at low effort.

A `flows.mjs` route measured on opus costs $0.17 to $0.18, so all 14 cost about $2.50. Each session writes about 20.6k tokens to the cache at the 1-hour TTL and reads about 24.1k. The cache write is the first user message, which holds the skills list, the SessionStart rules and the expanded start skill. Routes don't share it, so each route pays for it again.

Neither eval is part of Check.

## Release

Before each orbit release, run both evals from a clean tree:

```sh
node tests/routing/run.mjs --runs 3
node tests/routing/flows.mjs
```

Copy each `summary.json` into `docs/trails/`, as `routing-<version>.json` and `flows-<version>.json`, and commit both with the release. One run per lead can't tell a flake from a regression, so `run.mjs` runs 3. The stored summary ties each result to the SHA it ran.
