# Routing eval

Proves that a real `/orbit:start` run routes each delegate through the project's Models table and keeps effort at or below `high`. A lead that is only asked to list its calls can say the right thing and still spawn the wrong thing, so this eval grades the spawns that actually happen.

## What it does

1. Builds a scratch game project at `$TMPDIR/skyforge-<random>`: a camera bug past 4x zoom, a goblin HP change, and an AGENTS.md with a Models table.
2. Runs `claude -p` there on this worktree's `plugin/`, with an ordinary user request and nothing that names the experiment.
3. Records the original input of every `Agent` call through a PreToolUse hook (`hook.mjs`). The hook allows each call but rewrites it to `model: "haiku"`, `effort: "low"`, so children run cheaply while the lead's choices stay on record. A PostToolUse record of each child's `resolvedModel` shows the rewrite took effect.
4. Grades the lead's own calls (calls from children are counted, not graded) and prints PASS, FAIL or N/A per check.

Each check grades a spawn's effective effort. That is the `effort` the call passes, else the `effort` in the frontmatter of the orbit agent it spawns (`plugin/agents/*.md`).

| Check | Passes when |
| --- | --- |
| `effort-present` | Every spawn has an effective effort |
| `effort-ceiling` | No spawn runs at `xhigh` or `max`, except an `xhigh` camera delegate after 2 earlier camera delegates |
| `camera-routing` | The first `orbit:poteto-agent` brief naming `camera.js` uses `opus`, `high` and `Work type: shader-math` |
| `enemies-routing` | The first `orbit:poteto-agent` brief naming `enemies.json` uses `sonnet`, `low` and `Work type: data-tuning` |
| `gitops-effort` | Every `orbit:gitops` call runs on Sonnet at `low`, whether passed or from its frontmatter |

N/A means the run never reached the calls the check covers. INFO lines list every lead spawn, the spawns that passed no `effort`, briefs that name neither file or both, and whether gitops and the verifier were reached.

## Run it

```sh
node tests/routing/run.mjs                      # opus lead, 1 run
node tests/routing/run.mjs --model sonnet --runs 3
node tests/routing/run.mjs --keep               # keep the scratch projects
```

It exits non-zero on any FAIL. With `--runs N`, the runs go in parallel and the summary prints each check as k/N. Each run writes `stream.jsonl` (the lead's stream-json output), `spawns.jsonl` (the hook log), `settings.json` and `stderr.log` to `$TMPDIR/orbit-routing-<timestamp>/run-<i>/`.

## Cost

Each run is a real session of up to 80 turns and 25 minutes. The lead runs on the chosen model. Every child is forced to haiku at low effort. This eval is not part of Check.
