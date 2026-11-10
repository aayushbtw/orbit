# Routing eval

Proves that a real `/orbit:start` run routes each delegate through the project's Models table and keeps effort at or below `high`. A lead that is only asked to list its calls can say the right thing and still spawn the wrong thing, so this eval grades the spawns that actually happen.

## What it does

1. Builds a scratch game project at `$TMPDIR/skyforge-<random>`: a camera bug past 4x zoom, a goblin HP change, and an AGENTS.md with a Models table. A bare sibling repo, `skyforge-<random>-origin.git`, is its `origin` with `main` pushed, so the Worktree gate finds `origin/main`.
2. Runs `claude -p` there on this worktree's `plugin/`, with an ordinary user request and nothing that names the experiment. `--setting-sources project,local` keeps your user settings out (your plugins, hooks, permissions and model defaults). The `--settings` file and `--plugin-dir` still load, since they are their own sources. Your `~/.claude/CLAUDE.md`, auto memory and user MCP servers may still reach the lead, so a run on a machine with routing advice in those files is confounded.
3. Records the original input of every `Agent` call through a PreToolUse hook (`hook.mjs`). The hook allows each call but rewrites it to `model: "haiku"`, `effort: "low"`, so children run cheaply while the lead's choices stay on record. A PostToolUse record of each child's `resolvedModel` shows the rewrite took effect.
4. Grades the lead's own calls (calls from children are counted, not graded) and prints PASS, FAIL or N/A per check.

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
node tests/routing/run.mjs --keep               # keep the scratch projects
node tests/routing/run.mjs --grade <out-dir>    # regrade saved runs, no new session
```

It exits non-zero on any FAIL, and when `--grade` finds no `spawns.jsonl` or `run-*/` in the directory. Ctrl-C kills every lead's process group, removes the scratch projects unless `--keep`, and exits 1. With `--runs N`, the runs go in parallel and the summary prints each check as k/N. Each run writes `stream.jsonl` (the lead's stream-json output), `spawns.jsonl` (the hook log), `settings.json` and `stderr.log` to `$TMPDIR/orbit-routing-<timestamp>/run-<i>/`.

## Cost

Each run is a real session of up to 80 turns and 25 minutes. The lead runs on the chosen model. Every child is forced to haiku at low effort. This eval is not part of Check.
