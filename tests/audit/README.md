# Transcript audit

`audit.mjs` reads Claude Code transcripts and prints one table of orbit metrics, so judging a fix takes one command, not a hand-built study. It reads local files only and has no dependencies. It is not part of Check, because the transcripts live only on your machine.

## Run it

```sh
node tests/audit/audit.mjs \
	--projects ~/.claude/projects/-Users-me-code-app ~/.claude/projects/-Users-me--t3-worktrees-app-* \
	--since 2026-11-09 [--until 2026-11-19] [--skip <session-id>,...] [--json report.json]
```

- `--projects` takes Claude Code project folders (`~/.claude/projects/<encoded cwd>`), as paths or quoted globs. T3 worktree sessions sit in their own `-Users-<you>--t3-worktrees-*` folders, so pass those too.
- `--since` and `--until` are UTC dates, both inclusive. Each main session and each subagent counts in the window that holds its first record.
- `--skip` drops session ids, such as the session that runs the audit.
- `--json` also writes the report, with every breakdown, to a file.

A run over 3.5 GB of transcripts takes about 6 seconds.

## Metrics

Each row gives a count, a rate against the population named in the `rate` column, and a breakdown. "Agent" means a main session or a subagent.

| Metric | Counts |
| --- | --- |
| `main-sessions` | Main session transcripts in the window |
| `subagents` | Subagent transcripts, by the `subagent_type` of the `Agent` call that spawned each one (a missing type is `general-purpose`). The `.meta.json` `agentType` is used only when the spawning call is missing |
| `guard-refusals` | Tool results that start with "This agent (or session) is isolated in the worktree", by the clause after "but": `too complex`, `git in complex form`, `value computed at runtime`, `git aimed elsewhere` (`-C` or a computed path), `cd before git`, `working dir in shared checkout`, `opaque program` (eval, `sh -c` text, `xargs`), `not provably git-free` |
| `guard-refusals-by-type` | The same refusals by agent type, plus how many agents of each type hit at least one |
| `exit-worktree` | `ExitWorktree` calls by `action`, `discard_changes` and outcome. A result that is an error or says "refus" is `refused` |
| `worktree-remove-refused` | Bash calls that run `git worktree remove`, refused by the guard, by Claude Code's removal safety check, or by git itself (a `fatal:` line for untracked files, a locked worktree, or a path that is not a worktree) |
| `read-rules`, `read-rules-shared` | Subagents that `Read` orbit's `rules.md` or `rules-shared.md` (any path with an `/orbit/` folder), by type as reads/agents |
| `playbook-loads` | `orbit:playbook` Skill calls in orbit-run main sessions (an `orbit:start` or `orbit:playbook` Skill call, or a `/orbit:start` command), by the flow argument |
| `verifier-verdicts` | Verifier subagents by the first `PASS+NOTES`, `PASS` or `FAIL` in their last message, else in the spawning call's result |
| `subagent-failures` | Subagents whose last message is an API error, whose spawning call came back interrupted, or that ended with no final text (killed, session ended, or still running) |
| `foreground-agent-calls` | `Agent` calls from main sessions. A call is background when it passes `run_in_background: true` or its result is the "Async agent launched" notice |
| `foreground-agent-wait-h` | Hours from a foreground `Agent` call to its result, each capped at 3 h, summed per subagent type |
| `user-corrections` | Main-session user prompts whose first 600 characters match a phrase below. Commands, `<...>` harness messages and "Update on pull request" notices are skipped |
| `orbit-issues` | Bash calls of `gh issue create` with `--repo` or `-R aayushbtw/orbit`, `filed` when the result holds an issue URL |

The correction phrases are in `CORRECTIONS` in `audit.mjs`:

- `use advisor` matches "use, ask or let (the) advisor".
- `don't ask me` matches "don't ask me", "dont ask me", "do not ask me" or "stop asking".
- `why did you` matches "why did, do, are or would you (or u)".
- `stop / hold` matches a line that starts with "stop" or "hold", or the phrases "hold up" and "stop and listen".
- `without my approval` matches "without my approval", "never agreed" or "didn't ask you to".

Project-specific checks, such as format failures of a project's own check script or its e2e hours, are left out.

## Gotchas

- `is_error` misses failures. `cmd | tail` exits with `tail`'s status, so a `fatal:` from git comes back with `is_error: false`. The script parses the result text instead.
- Guard refusals are matched at the start of the result. A file or grep output that quotes the refusal text is not a refusal.
- Subagent transcripts sit in `<session>/subagents/agent-<id>.jsonl`, and nested spawns sit there too. The spawning call is found by the meta file's `toolUseId`, else by the `agentId` in the call's result.
- Claude Code backgrounds an `Agent` call that omits `run_in_background`. Treating every call without the flag as foreground counts about 280 extra foreground calls in 2026-11-09..19. Their wait is near zero, so the hours do not change.
- A session is dropped when its folder or `cwd` contains `orbit-lane`, `orbit-ship`, `skyforge` or `greet-`, or sits under `$TMPDIR`. These are orbit's own lane and eval runs.
- Files last written before `--since` are not read.

## Baseline

The numbers come from one project's sessions, its main folder and its T3 worktree folders. The two windows bracket the fixes that followed the 2026-11-08 audit. This script produced the first two columns. The first column is `--since 2026-10-25 --until 2026-11-08`, the 2026-11-08 audit's window. The second is `--since 2026-11-09`, with `--skip` for the audit sessions and for the five sessions newer than the 2026-11-20 study's snapshot. The study's own scripts produced the third column over the same two windows. Where their definition differs, the cell names how.

| Metric | 2026-10-25..11-08 | 2026-11-09..19 | Study, old to new |
| --- | --- | --- | --- |
| Main sessions, subagents | 115, 2104 | 147, 1476 | 115, 2104 to 147, 1474 |
| Guard refusals per agent | 1.38 (3066 of 2219) | 0.42 (685 of 1623) | 3066 to 687 |
| Guard refusals, verifier | 1926, 186 of 247 refused | 284, 51 of 144 refused | 1926 to 284 |
| Guard refusals, `too complex` kind | 1835 | 301 | 1799 to 291 |
| `ExitWorktree` calls | 81, 1 refused | 122, 44 refused | 81 to 122, 1 to 43 refused |
| `ExitWorktree` with `discard_changes` | 0 | 21 | Not measured |
| `git worktree remove` refused | 2 of 74 | 35 of 285 (guard 25, git 9) | 6 to 53, counting any error in the command |
| poteto-agents that Read `rules.md` | 266 of 506 (53%) | 404 of 419 (96%) | 266 of 506 to 403 of 418 |
| Subagents that Read `rules-shared.md` | 0 | 0 | File added 2026-11-20 |
| Playbook loads per orbit session | 1.14 (79 sessions, max 3) | 1.76 (82 sessions, max 5) | 1.1 to 1.8 |
| Verifier verdicts PASS+NOTES, PASS, FAIL, none | 182, 24, 25, 16 | 106, 26, 11, 1 | 138, 21, 23, 80 to 64, 16, 7, 41, from spawn results only |
| Failed subagents | 28 | 10 | 18 to 3, foreground spawns only |
| Foreground, background `Agent` calls | 1083, 340 | 831, 452 | 1239, 184 to 1113, 168, flag only |
| Foreground `Agent` wait (h per main session) | 146.3 (1.27) | 42.7 (0.29) | 147.9 to 42.8 h |
| User corrections per main session | 0.06 (7) | 0.11 (16) | Other phrase list |
| Issues filed on orbit | 0 | 1 | 0 to 1 |

## Test

`audit.test.mjs` runs the script over the hand-built transcripts in `fixtures/`, with one case per counting path, and CI runs it.

```sh
node --test tests/audit/audit.test.mjs
```
