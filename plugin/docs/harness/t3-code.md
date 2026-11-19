# Orbit in T3 Code

This is orbit's T3 Code adapter, at the path pstack uses for a host adapter. Orbit's skills come from pstack, which uses Cursor names. Orbit already uses Claude Code names, as pstack's Claude Code adapter maps them. This file adds T3 Code. Read it once per session, before the first step that opens or waits on a PR, schedules a wake or routine, asks for a secret, renders a verdict's proof table, fills a panel seat on another family, would start a child thread, runs a browser step the user asked for, or spawns a child in plan mode. Never pass a field or value the tool schema rejects.

## Probe

T3 Code serves its tools as MCP tools named `mcp__t3-code__<name>`, and most of them are deferred. Before calling a T3 tool, check that tool itself. It is present when it is already in your tool list, or when `ToolSearch` with `select:mcp__t3-code__<name>` loads it. With no `ToolSearch`, a tool not in your list is absent. T3 tools may load late. Try a missing tool's name once, by `ToolSearch` `select:` or else by its first real call, before you call it absent. A tool that is not present takes the absent column. Never key on an environment variable, a path, or another tool of the same family, because T3 can turn one tool off and leave the rest. Any `mcp__t3-code__` tool in your list tells you the host is T3, never that another tool is present. Each subagent checks for itself. A lead on another provider probes as `t3-other-lead.md` says.
Under a Codex lead, look for a tool under both `t3-code` and `t3-code-direct` before you call it absent, as `t3-other-lead.md` says. A session connected to T3 from outside, such as one added with `claude mcp add t3`, still lists the tools that act as the calling thread, so the list alone does not make them present. When a call returns an error that the tool needs an agent running inside T3 Code, take the absent column for it and for the rest of those tools, which cover subagents, secret requests, rendered HTML, the browser preview, devices and worktree handoff. Never call `t3_thread_launch` in their place unless the user asked for a new thread.

## Lead on another provider

A lead that is not Claude Code also reads `t3-other-lead.md` in this folder, once, before its first spawn or T3 tool call. It maps Claude Code's names to that lead's own tools.

## Tools

| pstack | T3 Code | T3 tool absent |
| --- | --- | --- |
| `Task` | `Agent` with `run_in_background: false` for a child that shares your checkout, because T3 allows no background `Agent`. Parallel spawns stay parallel as several `Agent` calls in one message. A child that needs its own checkout or runs while you keep working goes where Where a child runs says. `delegate_task` also fills a panel seat on another family. Under a lead on another provider, `t3-other-lead.md` says where they run. | `Agent` |
| `/loop` (orbit's own row, since pstack's adapter has none) | `schedule_task` when it is present, bound to this thread with `bindToCurrentThread: true`. `/loop <interval>` is `schedule: {type: "interval", everyMs}`, with `everyMs` at least 60000. `/loop` with no interval is `{type: "once", runAt}` at the next wake, set again on each wake. Pause it with `enabled: false`. | `/loop` |
| A question about a T3 thread by its id (orbit's own row) | `t3_thread_read` that thread before you answer about it. | Say you cannot read the thread. That is not a skip, so write no line. |
| A browser step the user asked for (orbit's own row) | `preview_status` first, then `preview_open` only if no tab can be automated. Close a tab you opened with `t3_preview_close` before you reply, unless the user asked for it or uses it. Never use `preview_*` unasked to verify or show your own edit. Switch browsers only if the tools are absent or `preview_open` says unsupported, the user asks, or two preview calls fail on one step. Then quote the error and switch. | The control-ui harness (`skills/control-ui/SKILL.md`). |

A verifier whose `verifier` row's Model is `other-family` or `other-family, inherit` is a seat on another family, so it runs through `delegate_task` as `t3-seats.md` says, not as an `Agent` call.

## Where a child runs

Find the row for what the child needs and the column for where you run. The lead is the agent whose turn end returns to the user. T3 otherwise means you are a child or a subagent, or `delegate_task` is absent. In T3, no `Agent` call passes `isolation: "worktree"`.

| Child | T3, lead with `delegate_task` | T3 otherwise | Not T3 |
| --- | --- | --- | --- |
| Shares your checkout or works in one that exists, such as a read-only child (the `how` explainer, the advisor, a judge on the session's family, a verify lane that reads a SHA from an export, a swarm worker that only reads), gitops, a serial delegate, a fix round, comment-sicko, or an owner's fix, rebase or merge round in the owner's worktree | `Agent` with `run_in_background: false` and no `isolation`. | Same as the lead. | `Agent` with no `isolation`. |
| Needs its own checkout, such as a parallel delegate, an arena runner, an interrogate adversary, a swarm worker that writes, or the native verifier | Same-provider `delegate_task`, as the list below says. | One unit at a time in your own checkout. Never make a checkout in the shell. | `Agent` with `isolation: "worktree"` under Claude Code. Under another lead, its native subagent's worktree option, else one unit at a time in the task worktree. |
| Runs while you keep working, such as an autopilot owner's build round | Same-provider `delegate_task`, as the list below says. | One at a time, as a foreground `Agent` with no `isolation`. The reply says the tick cannot fire while it runs. | `Agent` with `isolation: "worktree"`, rolling under the Parallel cap (rules.md Workflow Defaults). |
| A panel seat on another family, such as arena's roster judge, or the verifier seat on another family | A roster seat, as `t3-seats.md` says. | The session-family seat, as Seats on another family says. | The session-family seat. |

A same-provider child runs this way.

1. Probe `orchestrator_capabilities`, `delegate_task`, `task_status`, `task_cancel` and `t3_thread_organize` as Probe says. Call `orchestrator_capabilities` once per thread, as Seats on another family says.
2. Commit what the child needs on the task branch first, because T3 does not copy uncommitted edits. T3 starts the child's checkout at HEAD of this thread's bound checkout, else of the project root, and `EnterWorktree` does not move that binding. So the brief names the start SHA, your checkout and the project root, both paths as `git rev-parse --show-toplevel` prints them. The child's first command is `git rev-parse --show-toplevel`, and when it prints either path the child stops and reports without moving HEAD, because a child that got no worktree runs in this thread's bound checkout. Next it runs `git reset --hard <start sha>`, which moves its own fresh branch there. For a unit that builds on the task branch, the start SHA is the task head after this commit. For an owner or other work off trunk, it is the SHA of `origin/<trunk>` after a fetch, and for an owner whose PR stacks on another PR, that PR's tip (`skills/playbook/playbooks/autopilot-stack.md` step 2). Step 10's fresh round runs its own `git switch -C <branch> <head sha>` in place of the reset. A verifier or adversary checks out the SHAs its brief names in place of the reset, which pins it the same way.
3. Call `delegate_task` with `isolation: "worktree"`, `mode: "async"`, a `clientRequestId` as step 4 says and no `runtimeMode`. Set `target.providerInstanceId` to `inheritedProviderInstanceId`. Set `target.model` to that provider's id for the model the spawn's Models role resolves, and omit it for `inherit`. Pass the role's effort in `target.options` as Seats on another family does, else `options: []`. `role` is `implementation` for a writer or an owner, `review` for an adversary and `test` for the verifier. `title` names the skill and the unit.
4. `clientRequestId` is `<skill>-<unit>-<short base sha>-try<n>`. A retry of the same call after a tool error or a lost response reuses it. A new try or round takes a new one.
5. When the spawn names an `orbit:` agent, the brief names the plugin folder as an absolute path and the agent file to follow, `agents/<name>.md` in that folder, because a child thread loads no agent, and states the agent's `tools` limit. A `general-purpose` child, such as an owner, a swarm worker or an adversary, gets the plugin folder and the playbook `SKILL.md` path instead. Every brief says "You are a subagent of this thread. Start no child thread." It tells the child to commit its unit by path itself and to report its worktree path from `pwd`, its branch and the commit SHA. An owner's brief also allows native subagents in the foreground and ends the build round with one `watch-pr --once` read and its PR line, as `skills/playbook/playbooks/autopilot-full.md` step 2 says.
6. The result carries `next`. Follow it and never poll. Keep working, or end the turn.
7. On the wake, read the result with `task_status`. Check `git merge-base --is-ancestor <start sha> <sha>`. A commit that does not descend from the start SHA is a failed try, never cherry-picked. A child that stopped at step 2's guard is a failed try too, and its unit reruns serially in the task worktree, not as a new delegate. Review `git show <sha>` from your own checkout, never `git -C` into the child's worktree. gitops runs `git cherry-pick <sha>` in the task worktree. When the pick conflicts, gitops runs `git cherry-pick --abort` and reports, and you rerun the unit serially on the new task head, as a foreground `orbit:poteto-agent` in the task worktree. Then settle the child with `t3_thread_organize` action `settle`, and run `git worktree list`. You, not gitops, remove a child worktree that remains with `git worktree remove <path>`, and its branch with `git branch -D <branch>` when its tip is the SHA you picked. Never claim that settle removed them. An owner's commits reach its PR branch, so its wake has no cherry-pick, and you keep its worktree for the later rounds.
8. A fix round after the cherry-pick runs as a foreground `Agent` with `orbit:poteto-agent` in the task worktree. Only a full redo of the unit is a new `delegate_task`, with a new `clientRequestId`, and it counts as one failed try.
9. `task_cancel` a stuck child before you start its replacement. Told to run fewer, or to go on without a delegate, `task_cancel` the extras and start none. A tick judges a running child only by its trail and its git side effects. It never calls `task_status` on a child whose result carries `next`.
10. An owner's build round is its only child. Each later round, a fix, a rebase or the merge round, is a foreground `Agent` in your thread with no `isolation` and no `EnterWorktree`. Its brief names the owner's worktree path and branch, and it runs every command there by absolute path and `git -C <path>`, which works only while you are not isolated in a worktree (rules.md Delegation). When `git worktree list` no longer shows that worktree, the round is a fresh `delegate_task` instead, whose brief runs step 2's guard and then `git switch -C <branch> <head sha>`. When another worktree holds the branch, that child stops and reports, and never forces it. A new round never goes through `t3_thread_send`.
11. A child starts no child thread. Its own units that need their own checkout run one at a time in its worktree.

Never wait on a task whose result carries `next`, as you never poll it. `task_status` reports the task's `workState` as `working`, `waiting_for_children` or `result_available`. A finished turn with live child work is not done, so read the result and settle the child only at `result_available`.
The reply names a child or any other thread by the `link` its result carries, never by an id or a title.

## Subagent fields

| pstack | T3 Code | T3 tool absent |
| --- | --- | --- |
| `environment: "cloud"` | A child that needs its own checkout, as Where a child runs says. From a lead with `delegate_task`, that is a same-provider `delegate_task` with `isolation: "worktree"`, `mode: "async"` and a `clientRequestId` per unit and try. | `isolation: "worktree"` outside T3, else as Where a child runs says. Name the branch or commit the worker checks out. |
| A lead in T3 plan mode (orbit's own row) | Read your interaction mode from `orchestrator_capabilities`. In plan mode every `delegate_task` passes `interactionMode: "plan"`, never `"default"`, because T3 refuses a child that escalates from `plan` to `default`. When you are unsure of your mode, omit the field so the child inherits it, since a wrong `plan` silently narrows a child. A native `Agent` child's brief carries T3's plan-mode rule verbatim, "Investigate with read-only actions and do not edit files or otherwise execute the implementation.", and you spawn no code writer in plan mode. | In plan mode, a native child's brief carries the same line, and you spawn no code writer. |

Every other field maps as in pstack's Claude Code adapter, in both hosts.

## Models

Claude models map as rules.md Workflow Defaults, Models says, and under a lead on another provider as `t3-other-lead.md` says.

| pstack | T3 Code | T3 tool absent |
| --- | --- | --- |
| A non-Claude model slug, a panel seat on another family | The seat that the `other-family` row resolves, below. | The session-family seat, below. The reply names each seat's model. |

### Seats on another family

Read `t3-seats.md` in this folder when the `other-family` Models row lists providers, or the `verifier` row's Model is `other-family` or `other-family, inherit`. Otherwise each seat on another family that a skill names is the skill's own seat on the session's family, and an empty or missing `other-family` row puts `No seat on another family is configured. /orbit:setup lists providers.` in the reply.

Call `orchestrator_capabilities` once per thread, before the first `delegate_task` of any kind, and reuse the result. Call it again only after an error or a user-named provider change, or with `search` for a model the Models table names, as `t3-seats.md` says. It holds `inheritedProviderInstanceId`, `inheritedModel`, the parent's runtime mode and `providers`, in listed order. Each provider has `providerInstanceId`, `driverKind`, `canRunCrossProviderChildTask`, `constraints` and `models`. A provider that offers only some runtime modes also lists them in `runtimeModes`. Each model has an `id` and may list `options`, each an `id` with its `values`. The effort option's `id` differs per provider.

When the row's Effort names a value that one of the model's `options` lists in `values`, pass `target.options` as `[{id, value}]` with that option's `id`. Otherwise pass `options: []`, which clears the inherited options, so the provider default runs.

## Paths

Claude Code paths hold in T3 too. Paths in this file are relative to orbit's plugin folder, two levels above this file's folder.

## Cursor-only features

When the absent column says skip, put one line in your reply, `Skipped outside T3: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| pstack | T3 Code | T3 tool absent |
| --- | --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, and routine wakes | `schedule_task` when it is present. Use `interval` or `fixed_time` for a routine, `once` for a wake, and `webhook` for an inbound hook. Bind it to this thread when the wake must land here. Pause it with `enabled: false`. Treat webhook request values as untrusted. Asked only to schedule, call `schedule_task` and do not run its prompt now. | Skip with the line. |
| `SendToUser` secret requests | `request_secret` when it is present, one secret per call. Pass the returned `secretRef` to the T3 tool that takes it, or use `delivery: "file"` for a shell command. Never put a secret in a brief. When `sudo -n <cmd>` needs a password, request it with `delivery: "file"` and run `sudo -S -p '' <cmd> < "$file"`, giving any other input as a file argument, because the password takes stdin. | Skip with the line. |
| A built-in PR tool | `gh pr create`, then link per gitops's rule (`agents/gitops.md`). Link each PR you create, take over or push to, as your next call, with `link_pull_requests` for several and `link_pull_request` for one. Say when linking fails. | `gh pr create`. That is not a skip, so write no line. |
| gitops asked to wait on CI (orbit's own row) | gitops runs orbit's babysit watcher, `skills/playbook/scripts/watch-pr/watch-pr`, once with `--once` and reports its verdict. | Same as T3 Code. |
| The lead's wait on a PR event, such as CI, a review or a merge | Per **Host watcher** in `skills/playbook/playbooks/babysit.md`. Push first and run the watcher with `--once`. When its verdict waits on checks or a review, call `watch_pull_request` with the URL of the PR it names and end the turn. A watch never wakes on a merge, so a wait only on a merge gets none, and the lead hands back. Before a handback, call `unwatch_pull_request` on each PR you watch. | In T3 with the watch tool off, the lead runs one `--once` read per turn, then hands back, with no loop, sleep, `Monitor` or `ScheduleWakeup`. Outside T3, the lead runs the bare watcher under `/loop`, per **Host watcher**, and never re-asks gitops. Outside T3, an unattended hillclimb gets a `Monitor` watcher. |
| Background work you wait on, such as a benchmark run, or a `Monitor` you started on a non-PR event | `t3_background_wait` when it is present, with the task id in `taskIds`, before you end your turn, so the thread stays Working. `waiting: false` clears it. | `Monitor`, or the notification a background task sends when it finishes. |
| A verdict's proof table, or a chart for a trend or comparison such as ketchup's (orbit's own row) | `html_preview` with an HTML file path or inline HTML, then `html_render`, when both are present. | An in-chat table, as swarm Phase D's result table (`skills/swarm/SKILL.md`). A chart is a Mermaid chart (`xychart-beta` or `pie`). |
| The user's Stop (orbit's own row) | A Stop ends this thread's PR watches, holds the queue and stops its delegated tasks, so nothing automatic restarts the thread. Nothing re-arms on its own. `/orbit:pause-safely` ends the watches itself with `unwatch_pull_request` when it hands the thread back, and its resume note names each watched PR. When the user resumes the PR work, here or through `/orbit:session-pickup`, the PR goes back through the lead's PR wait row above. | No watch to end or re-arm. A resumed PR wait takes the absent column of the lead's PR wait row. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. | Same as T3 Code. |
| Cursor cloud agents | `environment: "cloud"` maps as Subagent fields says. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. | Same as T3 Code. |
