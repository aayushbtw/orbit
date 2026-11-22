# Transcript audit

`audit.mjs` reads Claude Code transcripts and prints one table of orbit metrics, so judging a fix takes one command, not a hand-built study. It reads local files only and has no dependencies. It is not part of Check, because the transcripts live only on your machine.

## Run it

```sh
node tests/audit/audit.mjs \
	--projects ~/.claude/projects/-Users-me-code-app ~/.claude/projects/-Users-me--t3-worktrees-app-* \
	--since 2026-11-09 [--until 2026-11-19] [--skip <session-id>,...] [--json report.json]
```

- `--projects` takes Claude Code project folders (`~/.claude/projects/<encoded cwd>`), as paths or quoted globs. T3 worktree sessions sit in their own `-Users-<you>--t3-worktrees-*` folders, so pass those too. A session started inside a Claude Code worktree sits in a `-Users-<you>-code-app--claude-worktrees-*` folder, and counts only when you pass that glob as well.
- `--since` and `--until` are UTC dates, both inclusive. Each main session and each subagent counts in the window that holds its first record.
- `--skip` drops session ids, such as the session that runs the audit.
- `--json` also writes the report, with every breakdown, to a file.

A run over 3.5 GB of transcripts takes about 6 seconds.

## Metrics

Each row gives a count, a rate against the population named in the `rate` column, and a breakdown. "Agent" means a main session, a T3 child thread or a subagent. Every subagent row also counts T3 child threads.

| Metric | Counts |
| --- | --- |
| `main-sessions` | Top-level transcripts in the window that are not T3 child threads |
| `t3-children` | Top-level transcripts that T3's `delegate_task` started. Their first prompt starts "Act as the `<role>` sub-agent for this task." Each is typed by the orbit agent file its brief names (`agents/verifier.md` is `verifier`), else as `t3:<role>` |
| `subagents` | Subagent transcripts, by the `subagent_type` of the `Agent` call that spawned each one (a missing type is `general-purpose`), plus T3 child threads by their type. The `.meta.json` `agentType` is used only when the spawning call is missing |
| `guard-refusals` | Tool results that start with "This agent (or session) is isolated in the worktree", by the clause after "but": `too complex`, `git in complex form`, `value computed at runtime`, `git aimed elsewhere` (`-C` or a computed path), `cd before git`, `working dir in shared checkout`, `opaque program` (eval, `sh -c` text, `xargs`), `not provably git-free` |
| `guard-refusals-by-type` | The same refusals by agent type, plus how many agents of each type hit at least one |
| `exit-worktree` | `ExitWorktree` calls by `action`, `discard_changes` and outcome. A result that is an error or says "refus" is `refused` |
| `worktree-remove-refused` | Bash calls that run `git worktree remove` in command position (at the start or after `;`, `&`, `\|`, `(` or `$(`, never inside quotes), refused by the guard, by Claude Code's removal safety check, or by git itself (a `fatal:` line for untracked files, a locked worktree, or a path that is not a worktree) |
| `read-rules`, `read-rules-shared` | Subagents that `Read` orbit's `rules.md` or `rules-shared.md` (any path with an `/orbit/` folder), by type as reads/agents |
| `playbook-loads` | `orbit:playbook` Skill calls in orbit-run main sessions (an `orbit:start` or `orbit:playbook` Skill call, or a `/orbit:start` command), by the flow argument |
| `verifier-verdicts` | Verifier subagents by the first `PASS+NOTES`, `PASS` or `FAIL` in their last message, else in the spawning call's result |
| `subagent-failures` | Subagents whose last message is an API error, whose spawning call's result starts with a harness failure ("Agent terminated early due to an API error", "API Error:", "Prompt is too long", "[Tool call interrupted", "[Request interrupted", "Request was aborted"), or that ended with no final text (killed, session ended, or still running) |
| `foreground-agent-calls` | `Agent` calls from main sessions. A call is background when it passes `run_in_background: true` or its result is the "Async agent launched" notice |
| `foreground-agent-wait-h` | Hours a main session waits on at least one foreground `Agent` call, from each call to its result, capped at 3 h per call. Parallel calls count once, as the union of their spans per session, and the same per subagent type. `summed over calls` adds each call's span, so it counts overlap twice |
| `user-corrections` | Main-session user prompts whose first 600 characters match a phrase below. Commands, `<...>` harness messages and "Update on pull request" notices are skipped. T3 child threads are left out, because the lead writes their prompts |
| `orbit-issues` | Bash calls of `gh issue create` with `--repo` or `-R aayushbtw/orbit`, `filed` when the result holds an issue URL |
| `t3-wasted-calls` | T3 MCP calls that did nothing, out of all `link_pull_request(s)`, `watch_pull_request`, `unwatch_pull_request` and `t3_background_wait` calls, walked in time order per session (a main session or T3 child thread with its subagents). `relink` is a PR the result calls `alreadyLinked`, else one linked earlier in the session. `unwatch already unwatched` and `unwatch never watched` are unwatches whose result says `wasWatching: false`, else whose PR the session did not watch since its last unwatch, split by whether the session ever watched it. `background-wait no match` is a result with `"matched":[]`, and `background-wait error` an error result or one that says `invalid`, `Missing key` or `Failure`. A `waiting: false` call clears and never counts. `calls by tool` gives the denominator per tool |

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
- A session is dropped when its folder or `cwd` contains `orbit-lane`, `orbit-ship` or `skyforge`, holds a `greet-` folder directly under a `T` or `tmp` folder, or sits under `$TMPDIR`. These are orbit's own lane and eval runs. A `feat-greet-x` worktree stays.
- T3 marks a child thread only for a `role` other than `general`. A `general` child gets no wrapper, so it counts as a main session.
- Files last written before `--since` are not read.

## Baseline

The numbers come from one project's sessions, its main folder and its T3 worktree folders. Its 21 sessions in `--claude-worktrees-*` folders over both windows are left out, as the command above leaves them out unless you pass that glob. The two windows bracket the fixes that followed the 2026-11-08 audit. This script produced the first two columns. The first column is `--since 2026-10-25 --until 2026-11-08`. The second is `--since 2026-11-09 --until 2026-11-20`, with no `--skip`, so it holds sessions up to the day of the run. The 2026-11-08 audit recorded 97 sessions and 2920 refusals for the first window from an older snapshot, so its numbers do not match. The 2026-11-20 study reran its scripts over both windows and produced the third column. Those scripts count a T3 child thread as a main session, and their second window ends at the study's snapshot. Where their definition differs further, the cell names how.

| Metric | 2026-10-25..11-08 | 2026-11-09..20 | Study, old to new |
| --- | --- | --- | --- |
| Main sessions, T3 children, native subagents | 101, 14, 2104 | 83, 69, 1592 | 115, 2104 to 147, 1474, children as main sessions |
| Guard refusals per agent | 1.38 (3066 of 2219) | 0.41 (709 of 1744) | 3066 to 687 |
| Guard refusals, verifier | 1926, 186 of 247 refused | 284, 51 of 172 refused | 1926 to 284 |
| Guard refusals, `too complex` kind | 1835 | 315 | 1799 to 291 |
| `ExitWorktree` calls | 81, 1 refused | 127, 46 refused | 81 to 122, 1 to 43 refused |
| `ExitWorktree` with `discard_changes` | 0 | 21 | Not measured |
| `git worktree remove` refused | 2 of 71 | 36 of 291 (guard 26, git 9, safety check 1) | 6 to 53, counting any error in the command |
| poteto-agents that Read `rules.md` | 266 of 506 (53%) | 440 of 457 (96%) | 266 of 506 to 403 of 418 |
| T3 implementation children that Read `rules.md` | 0 of 14 | 13 of 31 | Not measured |
| Subagents that Read `rules-shared.md` | 0 | 3 | File added 2026-11-20 |
| Playbook loads per orbit session | 1.11 (70 sessions, max 3) | 1.98 (64 sessions, max 5) | 1.1 to 1.8 |
| Verifier verdicts PASS+NOTES, PASS, FAIL, none | 182, 24, 25, 16 | 126, 32, 12, 2 (21 from T3 children) | 138, 21, 23, 80 to 64, 16, 7, 41, from spawn results only |
| Failed subagents | 29 | 16 | 18 to 3, foreground spawns only |
| Foreground, background `Agent` calls | 999, 338 | 773, 360 | 1239, 184 to 1113, 168, flag only |
| Foreground `Agent` wait, h (per main session) | 132.2 (1.31), 143.8 summed over calls | 39.6 (0.48), 41.8 summed over calls | 147.9 to 42.8 h, summed over calls |
| User corrections per main session | 0.07 (7) | 0.18 (15) | Other phrase list |
| Issues filed on orbit | 0 | 1 | 0 to 1 |

## Test

`audit.test.mjs` runs the script over the hand-built transcripts in `fixtures/`, with one case per counting path, and CI runs it.

```sh
node --test tests/audit/audit.test.mjs
```
