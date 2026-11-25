# T3 lane harness

`lane.mjs` starts one T3 Code thread at a commit, with orbit loaded from that commit instead of the installed plugin. It sends one scenario message, waits for the reply, writes the transcript and tool calls as JSON, and removes everything it set up once the thread is idle. Later PRs use it to prove orbit live in a T3 thread loaded from a PR head. `grade.mjs` then grades the saved JSON from its tool calls, with no session and no T3 (see Grade a lane).

## How a lane loads orbit from the head

1. `git archive <head> plugin` goes into a run directory, `$TMPDIR/orbit-lane-<id>/`, next to a copy of the head's `.claude-plugin/marketplace.json` renamed `orbit-head-<id>`. The run directory also holds `lane.pid`.
2. `claude plugin marketplace add` registers the run directory. `claude plugin install orbit@orbit-head-<id> --scope user`, then `claude plugin disable` at user scope, so no other session loads it.
3. A lane commit on top of the base adds `.claude/settings.json`, merged into the base's own file if it has one. Every `orbit@*` plugin enabled in the user settings or the base's project settings is set to `false`, and `orbit@orbit-head-<id>` is set to `true`. The commit also adds `.claude/settings.local.json` (see Memory). A temporary `GIT_INDEX_FILE` and `git commit-tree` build it, so no checkout or branch moves.
4. `t3 thread start <project> - --worktree <lane commit> --branch orbit-lane/<slug>-<id> --title "orbit lane <slug> <id>" --wait --json` reads the message on stdin.

T3 honored every step. In probe thread `mcp:5e8c67e4-fc75-4904-925f-7a9ebe2f3eed`, the agent quoted a marker that existed only in the head's `orbit:how` description and listed 19 orbit skills with no duplicates. After teardown, the user's `settings.json`, `known_marketplaces.json` and `installed_plugins.json` matched their backups except for key order.

The project must be the main checkout, the parent of `git rev-parse --git-common-dir`. `t3 thread start .` fails from a T3 worktree with "No T3 Code project matches '.'".

## A lane on the project root

With `--root`, step 4 drops `--worktree` and `--branch`, so the thread runs in the project folder, as a thread a user opens on a project does. T3 then binds the thread to no worktree, and orbit's Worktree gate runs `EnterWorktree` itself instead of being skipped. Before the thread starts, the lane checks out a new branch, `orbit-lane/<slug>-<id>`, at the lane commit in the project root, so the lead loads the head orbit and the memory setting from there. Cleanup checks the root's earlier branch back out with `git checkout -f` and puts back `.git/info/exclude`, where the Worktree gate may add `.claude/worktrees`.

`--root` moves the root's checkout for the whole lane, and its cleanup checks the root out with `-f` and force-removes the worktrees and branches made off the lane commit. So it runs only in a scenario project the lane built, which carries `orbit.laneProject = true` in its local git config, and refuses `--project` on any other repo, orbit's own checkout included. It also refuses a root that is dirty or not on a branch. Right before it moves the root, the lane checks that again under the lock, so a second `--root` lane in the same project fails instead of taking the root from the first. Any lane refuses a project whose root is on an `orbit-lane/` branch, because a `--root` lane holds it.

A thread on the root has no `worktreePath`. In T3 on 2026-11-20, Claude Code moved the lead's transcript to the folder of the worktree that `EnterWorktree` made and left the root's folder empty. So the harness looks for the lead's session, and for child ids, in the root's folder and in the folder of each worktree under the root's `.claude/worktrees`. Earlier lanes share those folders, and Claude Code keeps appending entries to their files, so a Claude session counts only when its first `user` entry is timestamped at or after the lane start. A file's change time does not decide it.

## Leads on any provider

A lane's lead can run on any provider instance, picked with `--provider` or the project's default. A provider instance id is Claude when it starts with `claude`, case ignored, such as `claudeAgent`. `--head` loads orbit from the head only for a Claude lead, because head loading goes through Claude Code's per-lane plugin marketplace, the one isolated loader the lane registers. So `--head` refuses an exact-head claim for any other provider. With a non-Claude `--provider`, the worker refuses before it stages the bundle or starts a thread. With no `--provider`, when the project default turns out to be a non-Claude provider, the lane fails after the run. Either refusal sets `revision.loader` to `unsupported`, exits 1 and tells you to pass `--installed`, which runs against the installed bundle and claims no exact head.

For a Claude lead, the lane proves which revision loaded. It stamps a marker unique to the lane, `orbit-lane-rev-<first 12 of sha>-<id>`, as an HTML comment at the end of the staged bundle's `rules.md` and `skills/rules/SKILL.md`. The SessionStart hook prints `rules.md` into the lead's session, so after the run the lane looks for that exact marker in the lead's session file, then in `reply` and `messages`. The run directory path and the `orbit-head-<id>` name are no proof, since another bundle could share them. When no session file holds the marker, `revision.proven` stays false and `grade.mjs` fails every check of the lane as an unproven Orbit revision. The proof covers the lead only, not child threads. A Claude lead's tool calls come from its session file, and every other lead's from T3 itself (see Tool calls from T3 activity). `threads` lists every lead's children, with each thread's provider and model (see Output).

Checks over seats grade against the lead's family, not against Claude. The family comes from `thread.providerInstanceId`, else `thread.model`: `claude` or `anthropic` is Claude, `codex`, `openai` or `gpt` is Codex, `antigravity`, `google` or `gemini` is Antigravity, and `grok` or `xai` is Grok. Any other id is a family of its own. A lane with no `thread`, as in an older fixture, counts as a Claude lead. So under a Codex lead, `seat-other-family` needs a seat off Codex, `seat-listed` takes `grok`, the first listed entry outside Codex, and a Codex review `delegate_task` is a native adversary.

## Why each run gets its own marketplace

The plan named one marketplace, `orbit-head`, whose run directory each run refreshes. Live lanes run in parallel at different SHAs, so a shared directory would be overwritten under a running lane. A marketplace per run also lets each run restore user settings on exit without counting how many lanes still use it.

## Memory

Claude Code keys auto memory by the main checkout, not the worktree. So a lane's thread writes into the operator's own memory folder, `~/.claude/projects/<project>/memory`, unless the lane moves it. A P10 lane wrote a resume note there. Every lane, `--installed` included, builds a lane commit that adds `.claude/settings.local.json`, merged into the base's tracked copy if it has one, with `autoMemoryDirectory` set to the lane's memory folder. Claude Code 2.1.326 reads that key from the local file in a non-interactive session. It ignores the key in the project's `.claude/settings.json`, and the user settings would move the operator's own sessions too, so the lane uses the local file only. The memory folder is `<out without .json>.memory`, next to the output JSON. The lane creates it before the thread starts and keeps it after the lane, because it is evidence.

## Run it

```sh
node tests/t3/lane.mjs --head HEAD --scenario probe
node tests/t3/lane.mjs --head <sha> --scenario probe --out head-marker.json
node tests/t3/lane.mjs --head HEAD --scenario docs-goal --message "/orbit:start fix the typo in README"
node tests/t3/lane.mjs --head HEAD --scenario probe --provider claudeAgent --model claude-sonnet-5
node tests/t3/lane.mjs --head HEAD --scenario seat-child --message "<task that starts a seat>" --wake 15
node tests/t3/lane.mjs --head HEAD --scenario parallel-units --wake 20 --wakes 2
node tests/t3/lane.mjs --head HEAD --scenario child-base --root --wake 20 --wakes 2
node tests/t3/lane.mjs --head HEAD --scenario provider-cells --installed --provider antigravity --model gemini-pro-orchestrator-neon --wake 20
```

| Flag | Meaning |
| --- | --- |
| `--head <ref>` | Commit to load orbit from, resolved with `git rev-parse --verify <ref>^{commit}` in this repo |
| `--scenario <slug>` | Names the thread, the branch and the default output file. A slug in `scenarios.mjs` sends that scenario's prompt. Other slugs need `--message` |
| `--message <text>` | Message to send. It replaces the scenario's prompt |
| `--out <file>` | Output JSON. Default `$TMPDIR/orbit-lane-<slug>-<id>.json` |
| `--project <dir>` | Run in another repo that is already a T3 project. The worktree base is that repo's `HEAD`. Default is the scenario's project when it has one (see Scenario projects), else orbit's main checkout, based on the head |
| `--installed` | Skip head loading, so orbit comes from the installed plugin. The lane commit still adds the memory setting (see Memory) |
| `--root` | Run the thread in the project root, with no T3 worktree, so the lead runs orbit's Worktree gate. Only in a scenario project the lane built (see A lane on the project root) |
| `--provider <id>`, `--model <slug>` | Passed to `t3` only when given. Otherwise the project default runs. `--provider` takes any instance (see Leads on any provider) |
| `--timeout <minutes>` | Default 30 |
| `--wake <minutes>` | After the lead completes, keep polling `t3 thread show` until a later run of the lead posts a reply, such as the wake after an async `delegate_task` child finishes, or until this many minutes pass. Off by default |
| `--wakes <n>` | With `--wake`, keep polling until `n` later runs have posted a reply, such as one wake per child of `parallel-units`. Default 1 |

The CLI is `T3CODE_CLI_PATH`, else `t3` on `PATH`.

`node tests/t3/lane.mjs` is the launcher. It starts the worker, which runs the lane, through a middle process that exits at once. So the worker has no parent left to stop with it. The launcher prints the worker's pid, streams the worker's log, `<out>.log`, to its own stderr and waits for the worker to exit. It then prints the output path on stdout and exits with the JSON's `exit`, or 1 when there is no JSON. The exit code is 0 when the agent completed, 2 when it asked a question back, and 1 otherwise. With no `--head` or `--scenario`, the launcher prints usage and exits 1 before it starts a worker. If another option is invalid, no T3 CLI runs or the ref does not resolve, the worker prints the cause, writes the JSON and exits 1 before it starts a thread or touches settings.

A SIGINT, SIGTERM or SIGHUP to the launcher does not touch the lane. The launcher prints that the worker keeps running and will write the JSON, and exits 1. Stopping a Bash command in Claude Code signals its whole process tree, and the worker is outside that tree, so a stopped subagent stops only the launcher. To stop the worker, run `kill <pid>` with the pid the launcher printed. The worker then stops waiting on `t3 thread start`, sets status `interrupted`, runs cleanup and writes the JSON with `threads` filled in. The thread keeps running in T3, so cleanup still waits for it to go idle (see Cleanup).

## Scenario projects

A scenario whose check depends on the project's Workflow block names a `project` in `scenarios.mjs`, and the lane runs there unless `--project` is given. `review-seat` and `verifier-seat` need one, because orbit's own `AGENTS.md` sets the `other-family` row to `inherit`, so a correct lead in orbit keeps every seat native and `seat-other-family` cannot pass. They share the `seats` project. Its `AGENTS.md` Models table has these rows, in the format of rules.md Workflow Defaults, Models:

```
| other-family | panel seat on another family | codex, claudeAgent | |
| verifier | runs the change before it lands | other-family | |
```

The Claude lead takes the `codex` seat. A second commit adds `median.mjs` and its test, which the two prompts name as the change to review or verify.

`parallel-units` runs in the `units` project and `autopilot-owners` in the `docs-queue` project. Each `AGENTS.md` sets Check to `node --test` and Land to `main`, with no Models table, so every child runs on the lead's provider. `units` adds `sum.mjs` and its test in a second commit. `docs-queue` holds `README.md` with "teh" and `NOTES.md` with "recieve", the two queue items. `child-base` runs in the `child-base` project, which has the same commits as `units` in a folder of its own, because a `--root` lane holds its project's root.

`provider-cells` runs in the `provider-cells` project. Its `AGENTS.md` has the same Check and Land, and a Models table whose cells name targets, `<providerInstanceId>/<model>` (`plugin/docs/harness/t3-code.md`, A cell that names a provider):

```
| code | code units | claudeAgent/claude-opus-5-5 | medium |
| advisor | plan gate and forks | claudeAgent/claude-fable-5-2 | |
| writing | docs and prose | antigravity/gemini-4-neon | |
```

It also holds `README.md`, `# Stats`, and a second commit adds `sum.mjs` and its test as in `units`. `providerCells` in `scenarios.mjs` is the one table that builds these rows and the scenario's checks. Its checks are `state` checks relative to the lead's `providerInstanceId`, so they grade a lead on any provider. Under a Claude lead, code and advisor run as native `Agent` spawns on `opus` and `fable`, and only writing becomes a child, on `antigravity`. Under an Antigravity lead, such as `--provider antigravity --model gemini-pro-orchestrator-neon`, code and advisor become `claudeAgent` children and writing runs on the lead's provider. The lane assumes `antigravity` and `claudeAgent` hold on the machine that runs it.

`models-resolve` runs in the `models-resolve` project. Its `AGENTS.md` Models table has `| writing | docs and prose | antigravity/gemini-4-neon | high |`, and its `.orbit/config.json` sets the `writing` work type to `codex/gpt-6.1-sol`. `.orbit/config.json` wins cell by cell, so `orbit models resolve writing --json` gives `codex/gpt-6.1-sol` from `.orbit/config.json` and Effort `high` from `AGENTS.md`, and a correct lead runs the README unit there. A second commit adds `sum.mjs` as in `units`. The lane assumes `orbit` is on `PATH` and `codex` holds on the machine that runs it.

`seat-listed`, `seat-empty` and `seat-all-fail` each run the `review-seat` prompt in a project of their own. `seatsProject` in `scenarios.mjs` builds every seat project from one value, the `other-family` cell, so the projects differ only in that row:

| Project | `other-family` Model | What a correct lead does |
| --- | --- | --- |
| `seats-listed` | `codex, grok` | The lead takes `codex`, the first listed entry |
| `seats-empty` | no Models table, so no row | No seat on another family. The code adversary runs native, as a same-provider `delegate_task` under a lead with `delegate_task` |
| `seats-all-fail` | `cursor, muse` | No seat and no native code adversary. Only the judgment adversary runs |

`verifier-all-fail` runs the `verifier-seat` prompt in the `seats-verifier-all-fail` project, whose `other-family` Model is `cursor, muse, inherit` and whose `verifier` Model stays `other-family`. The trailing `inherit` covers panel seats, not the verifier. So when every entry fails, a correct lead starts no seat and no native verifier, and asks the user. Asking ends the lane with status `waiting`, which the grader accepts for this scenario alone (see Grade a lane).

`seat-all-fail` and `verifier-all-fail` assume the `cursor` and `muse` providers are disabled on the machine that runs the lane, as they were on 2026-11-17. On a machine where either holds, the lead rightly takes that seat and `no-seat` fails.

`seat-empty` assumes the user file `~/.claude/rules/orbit-models.md` has no `other-family` row. A project with no Models table falls through to that file, and `lane.mjs` does not move it aside. On a machine whose file has the row, the lead rightly takes that seat and `no-seat` fails.

A project's spec is a name and a list of commits, each a message and its files. The lane builds it once at `$TMPDIR/orbit-lane-project-<name>-<hash>`, where the hash covers the commits, so a changed spec gets a new folder. It builds the repo in a sibling folder and renames it into place, so a crashed build never leaves a half-made project. It sets `orbit.laneProject` to `true` in the project's local git config, which `--root` requires. It then runs `t3 project add` when `t3 thread list --project <dir>` does not find the project. Both steps run under the lock. The folder and the T3 project stay for the next lane, because removing a T3 project also deletes its threads.

## Output

```
{ scenario, message, head: { ref, sha }, project, laneCommit, orbit: "head" | "installed", marketplace, memoryDir,
  exit, status: "completed" | "failed" | "waiting" | "timeout" | "interrupted" | "error", reply, error,
  wake: null | "arrived" | "none", wakes: [{ at, text }],
  pendingQuestion: [{ name, input }] | null,
  thread: { threadId, link, providerInstanceId, model, runtimeMode, branch, worktreePath } | null,
  threads: [{ threadId, link | null, waiting, parentThreadId | null, worktreePath | null, providerInstanceId | null, model | null }],
  messages: [{ role, text }], session, firstTurnInputTokens, activitySource: "claude-jsonl" | "t3-activity" | null,
  toolCalls: [{ name, input, sidechain }] | null,
  branches: [{ ref, born, tip, worktree | null, child, adds? }] | null,
  kept: { worktree, branch, marketplace, runDir, rootBranch } | null,
  revision: { requestedSha, mode: "head" | "installed", provider | null,
    loader: "claude-marketplace" | "installed" | "unsupported", marker | null, proven, evidence | null } | null }
```

`revision` records which orbit revision the lead loaded (see Leads on any provider). `requestedSha` is the resolved `--head` commit. `provider` is the lead's `providerInstanceId`, else `--provider`. `marker` is the string stamped into the staged bundle, and `null` unless `loader` is `claude-marketplace`. `proven` is true only when that marker shows in the lead's session or messages, and `evidence` says where it was seen or why not. An `--installed` lane sets `loader` to `installed` and `proven` to false, because it claims no exact head. `revision` stays `null` when the lane fails before it stages the bundle or reads the thread, unless a refusal set it.

`branches` lists every branch the lane made, which is every branch that did not exist before the thread started and whose oldest reflog entry is the lane commit or a commit after it. From the thread start until cleanup, the harness reads them every 5 seconds, or every `ORBIT_LANE_POLL_MS` when that is shorter, so a child branch the lead deletes after its cherry-pick is still listed. `born` is the oldest reflog entry, the commit T3 or `EnterWorktree` created the branch at. `tip` is the last tip seen. `worktree` is the last worktree seen on it. T3 creates each child branch as `t3/<id>` and renames it, so a branch whose reflog records a rename replaces the entry of its old name. `child` is true when that worktree is a child thread's `worktreePath` and not the lead's, since a child with `isolation: "shared"` works in the lead's checkout. When the scenario names a `prerequisite` path, `adds` is the oldest commit in `tip`'s history that adds that path, or `null`. `branches` stays `null` when the lane never started a thread.

`memoryDir` is the lane's memory folder (see Memory). `kept` is `null` unless cleanup found the thread still running and undid nothing (see Cleanup). Then it names what the lane left, with `marketplace` and `runDir` `null` for an `--installed` lane. `rootBranch` is the branch to check out again in the project root after a `--root` lane, else `null`.

`t3 thread show` returns message text only. A Claude lead's tool calls, token usage and pending question come from its session file, which the `claude` reader in `sessions.mjs` reads, and `activitySource` is `claude-jsonl`. `lane.mjs`, `grade.mjs` and `fixtures/make.mjs` all use it. Every other lead's tool calls come from T3 activity, and `activitySource` is `t3-activity`.

The session file is under `$CLAUDE_CONFIG_DIR/projects/` (default `.claude/projects/` in the home directory), in a folder named after the worktree path. Children that share the checkout write their sessions to the same folder, so the lead's session is the file whose first `user` entry is the scenario message. When several match, it is the one whose first `user` entry is newest. A message that starts with a slash command matches in the `<command-message>` form Claude records it in. Subagent calls carry `sidechain: true`. `firstTurnInputTokens` sums the input, cache creation and cache read tokens of the first assistant entry.

### Tool calls from T3 activity

When the lead is not Claude, or is Claude with no session file, the harness reads `t3_thread_read` with `view: "activity"` over `/mcp`, as it lists threads. It reads the lead with `sidechain: false` and then each descendant in `threads` with `sidechain: true`, 100 items a page from `afterPosition: -1`, then from each page's `nextPosition` while `hasMore` holds. Each item is `{ position, itemId, type, status, text, textTruncated, nextTextOffset }`. An item whose `textTruncated` is true is read again by `itemId` and `textOffset` until its text is whole, at most 50 reads. The readers in `sessions.mjs` turn items into calls:

- `command_execution`. `text` starts with `$ <command>`, then its output. The call is `Bash` with that command. A Codex `/bin/zsh -lc "<cmd>"` or `bash -lc '<cmd>'` wrapper is unwrapped to `<cmd>`, and a quoted command may span lines.
- `dynamic_tool` or `mcp_tool_call`. `text` is JSON `{ toolName, input }`, or `{ server, tool, arguments }`. `t3-code.<tool>`, `mcp_t3-code_<tool>` and `mcp__t3-code__<tool>` all become `mcp__t3-code__<tool>`. Other names, such as `Agent`, `Skill` or `ask_question`, stay as they are.
- Any other item, or text that does not parse, is skipped.

`session` and `firstTurnInputTokens` stay `null`. For a waiting lead, `pendingQuestion` lists the lead's calls whose `status` is not finished, else one `request_user_input` per id that `t3_pending_request` lists, else `null`. `t3_pending_request` lists user questions and never approvals. When the read fails, `toolCalls` and `activitySource` stay `null`, stderr says why, and only `state` checks can pass.

`threads` lists the lead first, with `parentThreadId` null. `t3 thread list` does not list `delegate_task` children, and `t3 thread show` names no children. The T3 tool `t3_thread_list` with `includeSubagents: true` does list them, each with its `parentThreadId`, `providerInstanceId` and `model`. So the harness calls it over `/mcp`, the way it settles threads (see Cleanup), for the lead's `projectId`, 100 threads a page, and keeps every thread whose parent chain reaches the lead. This works under a lead on any provider. It also reads each `childThreadId` from the `tool_result` entries of the Claude session files for the worktree, so a Claude lead's children still count when the tool call fails, and stderr then says so. It shows each candidate with `t3 thread show`, adds a child once its `parentThreadId` is already in `threads`, and repeats until nothing is added, so grandchildren are found too. Every entry, the lead included, records the `providerInstanceId` and `model` that `t3 thread show` gives. A child's `waiting` is true when it has pending requests.

`wake` is `null` without `--wake`. With it, and once the lead completes, the harness reads `t3 thread show` at once and then every 10 seconds. The first run is the `runId` of the first message that has one, the run of the scenario message. A wake is an `assistant` message from any later `runId`, read once the thread has no `activeRunId`. T3 posts a wake as assistant messages under a new run with no user message, and `t3 thread start --wait` can return only after the wake run ends, so the first read can already hold the wake. The harness stops polling once `--wakes` wake runs have arrived, or when the `--wake` minutes pass. When at least one arrives, `wake` is `"arrived"` and `wakes` holds the last message of each new run, with `at` set to the time the harness first saw that run. When none arrives in time, `wake` is `"none"`, `wakes` is empty and `status` stays `completed`. The harness then reads `threads`, `messages` and the session again, so they include the wake.

## Grade a lane

`scenarios.mjs` holds each scenario's prompt and its checks. Each check is one expectation over the lead's raw `toolCalls`. An expectation says that `some` call, or `none`, matches a tool name, an input shape and who made it, `lead`, `child` or `any`. A `some` expectation may set `min`, the number of calls that must match, default 1, such as two `delegate_task` children. `atMostOne` passes when the matching calls share one value of a key it reads from each call's input, so a retry of the same call counts once. `anyOf` passes when any expectation it lists passes. A shape names only the input keys it checks. Each leaf is a literal, a RegExp that tests a string or any string in an array, `ABSENT` for a missing key, or a function of the value and `{ leadFamily }`. A `state` expectation is a function of the whole lane that returns `{ ok, why }`, for an end state the tool calls cannot show, such as the lane's `branches`. So the table is the one place that says what the lead must call.

| Scenario | Checks | Passes when |
| --- | --- | --- |
| `probe` | `ran-pwd`, `loaded-no-skill` | The lead runs `pwd` and loads no skill |
| `gitops-native` | `gitops-native-child`, `no-child-thread` | gitops runs as a native child, an `Agent` with `orbit:gitops`. Under a lead outside Claude, whose native spawn is no lead call, a child that calls `list_thread_pull_requests` passes instead. No `delegate_task` |
| `foreground` | `delegate-ran`, `every-agent-foreground` | The code child runs native, as an `Agent` with `orbit:poteto-agent`. Under a lead outside Claude, a child `Bash` or `Read` call that names `agents/poteto-agent.md` passes instead. Every lead `Agent` call passes `run_in_background: false` |
| `verifier-seat` | `verifier-ran`, `seat-other-family` | A verifier runs, and it is a `delegate_task` seat on another family in a worktree |
| `review-seat` | `seat-other-family`, `request-id` | The lead calls `delegate_task` with `role: "review"`, `mode: "async"`, no `runtimeMode` and a provider of another family, and that same call has a `clientRequestId` |
| `seat-listed` | `seat-on-first-listed`, `only-listed-seats`, `one-seat`, `no-native-code-adversary` | The lead's review seat targets the first listed provider, `codex`, by its exact `providerInstanceId`, so `codex-proxy` fails. The seat's `target.model` is set and is not Claude's. Split at `-`, `/`, `.` and `:`, it holds no `claude` or `anthropic` token. An opaque `auto` or `default` model fails, because its family is unverified. No lead `delegate_task` targets a provider other than `codex`, `grok` and Claude. The lead's review seats on another family all target one provider, because the listed entries are fallbacks for one seat, not more reviewers. No native code adversary runs, which is an `Agent` `general-purpose` whose `model` is not `opus`, or a Claude `delegate_task` with `role: "review"` whose `target.model` is absent or not an opus model |
| `seat-empty` | `no-seat`, `session-family-seat` | No `delegate_task` targets a provider of another family. The lead runs the native code adversary, an `Agent` `general-purpose` whose `model` is not `opus`, or a Claude review `delegate_task` whose `target.model` is absent or not opus |
| `seat-all-fail` | `caps-read`, `no-seat`, `no-native-replacement`, `judgment-adversary-ran` | The lead calls `orchestrator_capabilities`, so a lane that skipped the seat without checking the providers fails. No `delegate_task` targets a provider of another family. Exactly one native review adversary runs, the judgment one. A native review adversary is a lead `Agent` `general-purpose`, or a lead review `delegate_task` on the lead's family or with no target. Calls that share a `clientRequestId` count as one adversary, so a retry passes. Calls with no `clientRequestId` or an empty one each count as their own |
| `verifier-all-fail` | `caps-read`, `no-seat`, `no-native-verifier` | The lead calls `orchestrator_capabilities`. No `delegate_task` targets a provider of another family. `no-native-verifier` is a `state` check. It fails a lead `Agent` with `orbit:verifier`, and a lead `delegate_task` with `role: "test"` on the lead's family or with no target. When the lane records `threads`, it also fails any child thread whose family, from its `providerInstanceId` else its `model`, is the lead's or unknown. Without `threads`, under a lead outside Claude, it fails any child call unless a lead `delegate_task` targets another family, because such a lead's native child shows only as child calls |
| `watch-pr-wait` | `lead-watches`, `no-child-watches`, `no-legacy-watcher` | The lead calls `watch_pull_request` on a PR URL, and no child does. No call runs `watch-pr` or `gh pr` in Bash |
| `babysit-wait` | `pr-read`, `no-legacy-watcher`, `lead-watches`, `unwatch-at-ready`, `no-child-watches` | The lead reads the PR with `pull_request_read`. No call, lead or child, runs `watch-pr` or `gh pr` in Bash, since 0.79.0 removed the watcher and `gh` as the forge. The lead calls `watch_pull_request` on a PR URL and, after the wake at `READY`, `unwatch_pull_request`. No child watches |
| `schedule-loop` | `bound-to-thread`, `interval-min-60s` | `schedule_task` has `bindToCurrentThread: true`, and no interval is under 60000 ms |
| `schedule-only` | `scheduled`, `prompt-not-run`, `no-run-now` | The lead calls `schedule_task` with `bindToCurrentThread: true`. It never counts the commits itself, with `git rev-list` or `git log` piped to `wc -l`, and never calls `run_scheduled_task_now` |
| `parallel-units` | `own-checkout-children`, `no-worktree-agent`, `no-shell-worktree`, `cherry-picked`, `children-settled` | The lead starts at least two `delegate_task` children with `isolation: "worktree"`, `mode: "async"` and a `clientRequestId`. No `Agent` call passes `isolation: "worktree"`, and no shell runs `git worktree add`. At least two `git cherry-pick` commands run, and the lead settles at least two threads with `t3_thread_organize` |
| `child-base` | `own-checkout-children`, `brief-pins-base`, `no-pick-conflict`, `children-on-prerequisite` | Run with `--root`. The lead starts two `delegate_task` children as in `parallel-units`. Every lead `delegate_task` with `isolation: "worktree"` has a `task` that runs `git reset --hard`, `git checkout`, `git switch` or `git merge --ff-only` on a SHA and names `--show-toplevel`, the guard that stops a child in the lead's checkout or the project root, so a first try whose brief only checks for the prerequisite fails though its retry pins the base. The check assumes the fix puts the base in the brief. No call runs `git cherry-pick` with `--abort`, `--continue`, `--skip` or `--quit`, the signs of a conflict, as a command of its own at the start of the text or after `;`, `&&` or a newline. One after `||` runs only if the pick failed and calls carry no results, so this check misses a conflict hidden behind `||`, and `children-on-prerequisite` covers the base instead. In `branches`, at least two child branches are listed, a branch that is not a child's adds `lib/round.mjs`, and each child's `adds` is that same commit. So each child's commit descends from the lead's pre-spawn commit. A child that wrote its own `lib/round.mjs` fails, though its brief may pass |
| `provider-cells` | `targets-off-provider-ran`, `no-unlisted-child`, `mean-committed` | All `state` checks. For each Models target whose provider differs from the lead's, some child in `threads` has that `providerInstanceId` and `model`, and a failure names each missing row and target. Every child is on the lead's provider or on one of the three targets. A branch in `branches` that is not a child's adds `mean.mjs`, the code unit, which the scenario names as its `prerequisite`. No check covers the README unit, because `branches` records one path |
| `models-resolve` | `ran-resolve`, `config-target-ran`, `agents-row-shadowed` | The lead runs `orbit models resolve writing`. Two `state` checks. Unless the lead runs on `codex`, some child runs on `codex/gpt-6.1-sol`, the `.orbit/config.json` target. No child runs on `antigravity/gemini-4-neon`, the `AGENTS.md` target that `.orbit/config.json` overrides |
| `autopilot-owners` | `owners-are-children`, `no-worktree-agent`, `no-shell-worktree`, `tick-bound` | Each of the two owners is a `delegate_task` child as in `parallel-units`, with the same two worktree checks. The lead arms `schedule_task` with `bindToCurrentThread: true` |

The `watch-pr-wait` prompt is the hillclimb wake lane's, with its PR URL replaced. The `babysit-wait` prompt holds `<PR URL>`, and the lane does not fill it in. Run it with `--message` set to the prompt with a scratch PR's URL whose checks are still pending, and with `--wake`, so the wake at `READY` and its `unwatch_pull_request` land in the lane. The rest are drafts that live lanes may tune.

Under a T3 lead with `delegate_task`, an interrogate adversary needs its own checkout. So each native adversary runs as a same-provider `delegate_task` with `role: "review"`, and a native verifier as one with `role: "test"` (`plugin/docs/harness/t3-code.md`, Where a child runs). Only a `delegate_task` whose `target.providerInstanceId` is of another family is a seat. A `delegate_task` with no `target.providerInstanceId` runs on the lead's provider, so it counts as native. `gitops-native` keeps `no-child-thread`, which fails any `delegate_task`, because gitops shares the checkout.

`seat-all-fail` does not tell the adversaries apart. It counts distinct native review adversaries, deduped by `clientRequestId`, and passes exactly one, so it grades a lead on any provider. It keeps `Agent` and `delegate_task` as the calls it counts, because each adversary needs its own worktree.

In `seat-listed` and `seat-empty`, the grader tells interrogate's two adversaries apart by `model` only. The judgment adversary passes `model: "opus"` to `Agent`, or an opus `target.model` to `delegate_task`. Any other lead `Agent` `general-purpose` or same-family review `delegate_task` counts as the code adversary. So a native code adversary spawned on opus passes `no-native-code-adversary`. A model-less `general-purpose` spawn for other work, such as a gitops helper, counts as the code adversary, so it passes `session-family-seat` and fails `no-native-code-adversary`. Under an Opus lead, `inherit` resolves the code adversary to the session's opus id, so a lead that pins `target.model` to that id instead of omitting it fails `session-family-seat` although both adversaries ran. One of 9 `seat-empty` lanes on 2026-11-19 did this, at `a256471`. The lead had resolved `inherit` to opus and wrote the result, and the child ran `claude-opus-5-5` as the omitting lanes' children did. Rerun such a lane before treating it as a regression. The `seat-listed` and `seat-empty` checks count no spawns. `one-seat` counts only the providers that the lead's review seats on another family target.

A check sees only tool calls, so it cannot grade what the reply says. For `seat-empty`, `seat-all-fail` and `verifier-all-fail`, read the lane's `reply`, `messages` and `pendingQuestion` fields by hand.

- `seat-empty`: the reply says that no seat on another family is configured.
- `seat-all-fail`: the reply says that every listed entry failed and the seat was skipped.
- `verifier-all-fail`: the reply holds one `<entry> unavailable: <reason>` line per entry, `cursor` and `muse`, before the question or the hold. A question offers the native verifier without marking it recommended. With no user to ask, the reply says the PR is held.

```sh
node tests/t3/grade.mjs tests/t3/fixtures/*.json
node tests/t3/grade.mjs "$TMPDIR"/orbit-lane-gitops-native-*.json
```

For each lane, `grade.mjs` prints `<file>  <scenario>`, then one line per check with `PASS` or `FAIL`, the check and why. A `PASS` names the matching call by its position, counted from 1, or every matching call when `min` is over 1. A `FAIL` names the call it missed and the nearest call with that name. Under `min`, it also says how many calls matched of how many it needs, and names those that matched. A lane whose `orbit` is `head` fails every check with `unproven Orbit revision` unless `revision.proven` is true, `revision.marker` is set and `revision.requestedSha` equals `head.sha`. Fixtures and `--installed` lanes skip that gate. A lane whose `status` is not `completed` fails every check. The one exception is a `verifier-all-fail` lane whose `status` is `waiting` and whose `pendingQuestion` lists only the lead's own question calls, `AskUserQuestion`, `ask_question` or `request_user_input`. A pending approval or any other tool still fails. Asking the user is a correct outcome there, so its tool calls are graded. A lane whose `toolCalls` is `null` fails every check except a `state` one.

The exit code is 0 when no check fails and 1 when any check fails. It is 2 when a file cannot be graded, because it is not valid JSON, names an unknown scenario, has no `toolCalls` key, or has a `toolCalls` that is neither `null` nor a list of calls that each have a string `name`. stderr then names the file and the reason. Exit 2 wins over exit 1.

## Fixtures

`fixtures/*.json` are graded lanes. Each keeps `scenario`, `message`, `status`, `thread` with `providerInstanceId` and `model`, `toolCalls` and `fixture`. A waiting lane also keeps `pendingQuestion`, with each call's `name` only. A lane with `branches` keeps them, with `worktree` scrubbed like the calls. `fixture` has these fields.

- `origin` is `real` for calls read from a session file, and `hand-built` for a copy edited by hand.
- `source` names the session file or lane folder of a real fixture, or the fixture a hand-built one was copied from. It is never an absolute path.
- `relabeled` is true when `message`, the prompt the session ran, differs from the scenario's prompt.
- `note` says what the lane shows.
- `expect` maps every check of the scenario to `PASS` or `FAIL`.

`fixtures/make.mjs` builds a real fixture from a session file.

```sh
node tests/t3/fixtures/make.mjs --provider claudeAgent --session ~/.claude/projects/<worktree folder>/<id>.jsonl \
  --scenario gitops-native --out tests/t3/fixtures/claude-gitops-native.json --source <lane folder> --note "<what it shows>"
```

It reads the calls with the reader `lane.mjs` uses, and the message and model from the session. It keeps only the input keys some shape in `scenarios.mjs` names, plus `subagent_type` and `command`. It cuts a string over 200 characters to its first 60, and rewrites the temp folder to `$TMPDIR` and the home folder to `~`. It grades the raw calls and the kept calls, and writes nothing when a verdict differs. So a lane whose long briefs pass `brief-pins-base` cannot become a real fixture this way, because the cut drops the pin. `expect` holds the verdicts of the kept calls, so read them before you commit. `--source` replaces the default, the session file's name. Pass the lane folder, because a Claude session's file name is a bare id. `--provider` must name a Claude instance. `status` is `completed` unless `--lane` names the lane's JSON, which then gives `status` and `pendingQuestion`. The lane is the record to trust, because a session can change after the lane ends. Archiving the `verifier-all-fail` thread wrote a rejection as the result of its pending question.

| File | Origin | Source | Shows |
| --- | --- | --- | --- |
| `claude-autopilot-owners.json` | real | `orbit-lane-autopilot-ow-cff988755608d4fb` | Two owners as `delegate_task` worktree children and a 1-minute tick bound to the thread, which fired once while an owner ran |
| `claude-parallel-units.json` | real | `orbit-lane-parallel-uni-d6e0bf5348221ec2` | Two `delegate_task` worktree children, two cherry-picks by gitops and two settles |
| `claude-parallel-units-agent-worktree.json` | hand-built | none | Two `Agent` calls with `isolation: "worktree"` and no child thread. `own-checkout-children`, `no-worktree-agent` and `children-settled` fail |
| `claude-probe.json` | real | `orbit-lane-probe-fa8172` | A Claude lead runs `pwd` and loads no skill |
| `claude-child-base.json` | hand-built | none | A lead on the project root commits `round.mjs` in its worktree, and both child briefs run the checkout guard and reset to that commit. Both children's commits descend from it |
| `claude-child-base-pre-t3-child-base.json` | real | `orbit-lane-child-base-7307a46c` | At 7686e86, T3 starts both try-1 children at the root's commit, without the lead's `round.mjs` commit, and both stop. The try-2 briefs run `git merge --ff-only` on it. `brief-pins-base` and `children-on-prerequisite` fail. Its `toolCalls` and `branches[].child` were read again offline from the session, because the lane looked for the session in the root's folder only |
| `claude-child-base-self-recovered-pre-t3-child-base.json` | real | `orbit-lane-child-base-9b7b5893` | At 7686e86, T3 starts both children at the root's commit again. The briefs neither pin nor check the base, and each child fast-forwards to the lead's commit on its own. `brief-pins-base` fails and `children-on-prerequisite` passes |
| `claude-gitops-native.json` | real | `orbit-lane-gitops-native-c1ab0a` | A Claude lead spawns `orbit:gitops` as an `Agent` |
| `codex-gitops-native.json` | real | `orbit-lane-gitops-nativ-d27e7b852b89628c` | At 4e64940, a Codex lead spawns gitops natively, so no lead `Agent` call shows. The child reads `agents/gitops.md` and calls `list_thread_pull_requests`. Its `toolCalls` come from T3 activity, slimmed by hand to `command`, because `make.mjs` reads only Claude sessions |
| `claude-review-seat-pre-1f80b16.json` | real, relabeled | `orbit-lane-interrogate--5b3974d12a498483` | A seat on Grok with no `clientRequestId`, before 1f80b16 asked for one. `request-id` fails |
| `claude-review-seat.json` | hand-built | the fixture above | The same seat call with a `clientRequestId` |
| `claude-schedule-loop.json` | real, relabeled | `orbit-lane-hillclimb-wa-2d6d996f1cc0dfc1` | A `once` `schedule_task` bound to the thread |
| `claude-seat-all-fail.json` | real | `orbit-lane-seat-all-fail-6e36596a` | With `cursor, muse` listed, the lead reads `orchestrator_capabilities` and starts no seat and no native code adversary. Only the opus adversary runs |
| `claude-seat-all-fail-34fdaae.json` | real | `orbit-lane-seat-all-fai-ad1514ff68422c42` | At 34fdaae, the same outcome with the opus adversary as a same-provider review `delegate_task` on `claudeAgent` |
| `claude-seat-empty-34fdaae.json` | real | `orbit-lane-seat-empty-a-8662b7b4b5c63a6e` | At 34fdaae, both adversaries run as same-provider review `delegate_task` children on `claudeAgent`, the code one with `target.model` omitted. No seat on another family |
| `claude-seat-listed-34fdaae.json` | real | `orbit-lane-seat-listed--c6a7bebcd18112e3` | At 34fdaae, the opus adversary runs as a same-provider review `delegate_task`, and the one seat on another family targets `codex` with `model: "gpt-6.1-sol"` |
| `claude-seat-empty-pre-seat-selection.json` | real, relabeled | `orbit-lane-interrogate--5b3974d12a498483` | A lead that started a seat on Grok. The source does not record its Models cell. Under the rule an empty cell starts no seat. The name points at `feat/t3-seat-selection`, the change that adds the rule. Both checks fail, since the only native adversary is the opus one |
| `claude-seat-empty.json` | real | `orbit-lane-seat-empty-f1cb6630` | With no Models table, the lead starts no seat and spawns the native code adversary, an `Agent` with `model` omitted |
| `claude-seat-listed.json` | real | `orbit-lane-seat-listed-80cc9af8` | One review seat on `codex` with `model: "gpt-6.1-sol"`, the first listed entry, and only the opus adversary native |
| `claude-verifier-seat-pre-79ebe0b.json` | real, relabeled | `orbit-lane-verifier-t3--018b867cd5f861e4` | The native verifier, before 79ebe0b put it on another family. `seat-other-family` fails |
| `claude-verifier-seat.json` | hand-built | the fixture above | A verifier seat on Codex in a worktree |
| `claude-verifier-all-fail-leak.json` | hand-built | `claude-verifier-seat-pre-79ebe0b.json` | The native verifier runs although only the `other-family` list ends with `inherit`, with no `orchestrator_capabilities` call. `caps-read` and `no-native-verifier` fail |
| `claude-verifier-all-fail.json` | real | `orbit-lane-verifier-all-fail-5c32073a` | The lead reads `orchestrator_capabilities`, starts no seat and no native verifier, and waits on its `AskUserQuestion`. Read by hand, the reply misses the per-entry lines and marks the native verifier recommended |
| `claude-watch-pr-wait-pre-3ef46e7.json` | real, relabeled | `orbit-lane-hillclimb-wa-8d91928f07af12fb` | The lead runs the `watch-pr` watcher, then arms `watch_pull_request`. `no-legacy-watcher` fails |
| `claude-watch-pr-wait.json` | hand-built, relabeled | the fixture above | The same lane with one `pull_request_read` in place of the watcher runs |

A real session that ran before a rule landed is named for the commit that added the rule, or for the change's branch when its squash commit is not yet known, and a hand-built copy that follows the rule passes. `fixtures/invalid/truncated.json` is the first 400 bytes of `claude-probe.json`, so `grade.mjs` exits 2 on it. The `invalid` folder keeps it out of `fixtures/*.json`.

`grade.test.mjs` runs in CI. Each fixture must grade to its `expect`, name every check of its scenario, and set `relabeled` correctly. Every check needs one expectation. No fixture may hold a home or temp path, an email address or a token. The test also tests the CLI exit codes, and prints a `no fixture:` line for each scenario that no fixture exercises.

## Cleanup

Each step pushes its undo before it runs, and every undo ignores a step that never happened. One cleanup function runs from `finally` and on a SIGINT or SIGTERM to the worker. The `--wake` hold runs before `finally`, so cleanup waits for it to end. When the thread is not yet known, it finds the thread by title with `t3 thread list --project <project> --json` and reads its `worktreePath` with `t3 thread show --json`.

Before any undo, cleanup reads the run state of the thread and of each child in `threads` from `t3 thread show --json`, because the undos remove the children's worktrees too. The lane is idle only when every one of them is. A thread's state is `waiting` while `thread.pendingRequestCount` is above 0, else `running` while `thread.activeRunId` is set, `idle` when it is not, and `unknown` when the show fails. A thread parked on a question keeps its run open, but a lane never answers it, so cleanup treats `waiting` as `idle`. A thread outlives `t3 thread start --wait`, and the CLI cannot interrupt one, so a lane that times out or is interrupted would otherwise remove the worktree under a running thread. Cleanup reads the state again every 10 seconds, or every `ORBIT_LANE_POLL_MS` milliseconds when that is set, until the thread is idle, for at most `--timeout` minutes. When the thread goes idle, or no thread was found, the undos run in reverse. When it is still not idle at the end, cleanup runs no undo at all, because the running thread still loads the head plugin from the run directory. It sets `kept` to the worktree, branch, marketplace and run directory it left, and prints one warning that names them. After a `--root` lane, the warning also names the branch to check out again in the project root. The next lane's reaper removes the marketplace once this worker's pid is dead. The worktree and branch need `git worktree remove` and a branch delete by hand. Cleanup never removes a worktree whose thread is running.

The worktree undo removes the thread's worktree with `git worktree remove --force --force`, since `EnterWorktree` locks the worktree it makes, or the worktree on `orbit-lane/<slug>-<id>` when no thread was found, never the project root. It also removes every worktree that did not exist before the thread started and whose `HEAD` is the lane commit or a commit after it, or whose branch is one this lane made (see the branch rules below). A child that resets its branch to trunk leaves the lane commit's history but keeps its branch's reflog, so the branch rule still finds its worktree. Those are the lead's `EnterWorktree` worktree under `.claude/worktrees` and the `delegate_task` children's worktrees that the lead left. After each removal it removes the worktree's parent folder when that folder is empty, since T3 keeps one per project and `EnterWorktree` keeps `.claude/worktrees`. After a `--root` lane it also removes the root's `.claude` folder when it is empty.

Before `t3 thread start` the lane records every branch, and it refuses to start when `orbit-lane/<slug>-<id>` matches one of them with case ignored. Cleanup then deletes each branch that `git for-each-ref refs/heads` lists when both of these hold, so a thread that checks out an existing branch never loses it:

- No branch recorded before the thread started matches it with case ignored. On a case-insensitive disk, git resolves `refs/heads/Main` to the file of `refs/heads/main`, but lists only `main`, so a `HEAD` pointed at `refs/heads/Main` or `refs/tags/v1` deletes nothing.
- The oldest entry of its reflog, or its tip when it has no reflog, is the lane commit or a commit after it, as `git merge-base --is-ancestor` says. The lane commit is new in each lane, so only this lane's branches qualify: the lane branch, which orbit's Worktree gate may rename to `<type>/<slug>` (a rename keeps the reflog), the lead's `EnterWorktree` branch and each child's branch. A branch the thread creates at an older commit, such as the base, is kept.

It deletes with `git update-ref --no-deref -d <ref> <sha>`, so a symbolic ref loses only itself and a branch that moved since the check is kept. `lane.test.mjs` runs these cases against a stub `t3` and a throwaway repo, a `--root` lane among them. Then it prunes worktrees. Last, it uninstalls the plugin, removes the marketplace and deletes the run directory. Orbit plugins enabled at user scope stay enabled, because only the lane commit's project settings turn them off.

`claude plugin` edits user settings by read, modify and write, so register and unregister run under a lock directory, `$TMPDIR/orbit-lane.lock`. A lock whose pid is dead is taken over. Before it registers, a run reaps leftovers. It removes each `orbit-head-*` marketplace whose `lane.pid` is missing or names a dead process. It never touches a marketplace with any other name.

The thread outlives the lane. A follow-up message after exit runs without the head orbit, because the worktree, branch and marketplace are gone. A thread that times out or is interrupted keeps running in T3. While cleanup waits on it, stderr prints its link.

`lane.test.mjs` also covers the launcher and the idle gate against the stub `t3`. Its stub starts the agent in the background and reports `activeRunId` until the agent ends. A lane whose launcher is killed still completes, and a lane that times out removes the worktree only after the agent ends. A lane whose agent outlasts the grace keeps the worktree and branch.

After it writes the JSON, the lane ends each thread in `threads`, children included, with the T3 tool `t3_thread_organize`. It settles an idle thread, archives one that waits on a question, which dismisses the question unanswered because settle refuses it, and leaves a running one alone. The `t3` CLI has no organize command, so the lane calls the server's `/mcp` endpoint the way `t3 thread` does, with a 5-minute `mcp-client` session from `t3 auth session issue` that it revokes after, and prints a warning instead of failing when that does not work.

## Cost

Each lane is a real T3 session on the project's default model unless `--provider` and `--model` say otherwise. The `probe` scenario takes one tool call, about 50,000 first-turn input tokens with orbit loaded. Lanes are not part of Check. `grade.mjs` and its tests read only saved JSON, so they cost no session.
