# Ship cleanup eval

`cleanup.mjs` proves that a real `/orbit:start` run lands a one-line fix under Land `main` and then cleans up its worktree and branch without tripping Claude Code's worktree guard. A lead that ran the Worktree gate is isolated in its worktree. The guard then refuses any git `-C` or `cd` into another checkout from that session and its subagents, and `ExitWorktree` with `remove` refuses a worktree whose branch moved past the session's starting commit. This eval grades what the lead and its subagents actually did at the end of Shipping.

## What it does

1. Builds a scratch project at `$TMPDIR/greet-<random>` with the `scaffold` in `tests/routing/lead.mjs`: an AGENTS.md whose Workflow block says `Check: node --test` and `Land: main`, one passing test, and a README.md with the typo "teh". A bare sibling repo, `greet-<random>-origin.git`, is its `origin` with `main` pushed.
2. Runs `claude -p` there through the lead launcher in `lead.mjs`, with the same orbit install and settings isolation as the routing eval (see `tests/routing/README.md`), the prompt `/orbit:start fix the typo "teh" in README.md`, at most 150 turns and a 45-minute timeout. No hook rewrites any call, so every subagent, the verifier included, runs on the model the lead picks.
3. After the lead exits and before the scratch project is removed, it records the end state in `state.json`: `main:README.md` and `git log` on `origin`, `git worktree list` with each worktree's branch and whether it has uncommitted changes, and the local branches. Worktree paths are relative to the project root.
4. Grades the lead's stream (`stream.jsonl`, stream-json with `--verbose`) and `state.json`. Subagent tool calls and results appear in the stream with `parent_tool_use_id` set to the `Agent` call that spawned them, so the grade covers them and names the subagent type.

| Check | Passes when |
| --- | --- |
| `landed` | `main:README.md` on `origin` has no "teh" and has "the" |
| `no-discard` | No `ExitWorktree` call passes `discard_changes: true` |
| `no-exit-refusal` | No `ExitWorktree` result is an error or says it refuses |
| `no-guard-refusal` | No tool result anywhere contains "is isolated in the worktree". A FAIL prints each call that caused one, with its command |
| `root-untouched` | No tool result contains "is not fully merged", and no Bash call from the restored checkout runs `git merge`, `checkout`, `switch`, `reset` or `pull` unless `-C` or `cd` aims it under `.claude/worktrees/`. A call is from the restored checkout when the lead makes it after its first `ExitWorktree` that was not refused, or a subagent spawned after that exit makes it |
| `clean-end` | `git worktree list` shows only the project root, and `main` is the only local branch. A FAIL prints each leftover |

`landed` is the prerequisite. When it fails, every other check is N/A, and its detail says the fix did not land. INFO lines print how the lead ended, its turns and cost, its spawns, and each `ExitWorktree` call with its result.

## Run it

```sh
node tests/ship/cleanup.mjs                          # this worktree's plugin/, opus lead, 1 run
node tests/ship/cleanup.mjs --ref origin/main        # orbit's plugin/ at a git ref, exported with git archive
node tests/ship/cleanup.mjs --plugin-dir <dir>       # any orbit plugin/ folder with a manifest.json
node tests/ship/cleanup.mjs --model sonnet --runs 3  # opus, sonnet, fable or haiku; runs go in parallel
node tests/ship/cleanup.mjs --keep                   # keep the scratch projects
node tests/ship/cleanup.mjs --grade <dir>            # regrade saved runs, no new session
```

Each run writes `stream.jsonl`, `stderr.log`, `settings.json`, `meta.json` (orbit's ref and SHA, the plugin dir, the model and prompt), `state.json` and `result.json` (meta, exit, checks and INFO) to `$TMPDIR/orbit-ship-<timestamp>/run-<i>/`. `--ref` exports the plugin to `orbit-<sha>/plugin/` in the same root. `--grade` takes a run directory or a root holding `run-*/`, and writes nothing. The script exits non-zero on any FAIL. With `--runs N`, the summary prints each check as k/N.

Each run is a real session. Shipping runs an advisor review and a verifier, so a run takes many turns. It is not part of Check.

## Grader test

`grade.test.mjs` grades the saved fixtures in `fixtures/` with no session, and CI runs it. Each fixture holds a trimmed `stream.jsonl`, with scratch paths replaced by `/tmp/`, its `state.json` and the statuses it expects in `expect.json`. Three come from one real run at orbit `d840cd4` (`--ref origin/main`):

- `red-origin-main` is that run, trimmed to the worktree calls, the spawns and the cleanup subagent's commands. The lead's `ExitWorktree` `remove` was refused, the gitops subagent hit two guard refusals, and after the exit gitops ran `git checkout main` and `git merge --ff-only origin/main` in the restored checkout.
- `pass` is the same stream without the refused calls, with the cleanup command rewritten to step 7's shape: `git worktree remove <absolute path>`, then `git branch -D` behind `git merge-base --is-ancestor`.
- `discard` is hand-built from it. It exits with `discard_changes: true`, and its end state leaves the verifier's worktree and branch behind.

`not-fully-merged` is one of three runs at orbit `1e187da`, trimmed the same way. The lead exited with `keep`, then gitops's `git branch -d` was refused as not fully merged, and gitops ran `git merge --ff-only origin/main` in the restored checkout.

```sh
node --test tests/ship/grade.test.mjs
```
