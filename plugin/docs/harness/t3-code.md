# Orbit in T3 Code

This is orbit's T3 Code adapter, at the path pstack uses for a host adapter. Orbit's skills come from pstack, which uses Cursor names. Orbit already uses Claude Code names, as pstack's Claude Code adapter maps them. This file adds T3 Code. Read it once per session, before the first step that opens or waits on a PR, schedules a wake or routine, asks for a secret, renders a verdict's proof table, fills a panel seat on another family, or would start a child thread. Never pass a field or value the tool schema rejects.

## Probe

T3 Code serves its tools as MCP tools named `mcp__t3-code__<name>`, and most of them are deferred. Before calling a T3 tool, check that tool itself. It is present when it is already in your tool list, or when `ToolSearch` with `select:mcp__t3-code__<name>` loads it. With no `ToolSearch`, a tool not in your list is absent. A tool that is not present takes the absent column. Never key on an environment variable, a path, or another tool of the same family, because T3 can turn one tool off and leave the rest. Each subagent checks for itself.

## Tools

| pstack | T3 Code | T3 tool absent |
| --- | --- | --- |
| `Task` | `Agent`. Subagents, owners, verifiers, swarm workers and live lanes stay `Agent` calls and never become T3 child threads. `delegate_task` starts a child thread and is only for a panel seat on another family, when `delegate_task` is present. | `Agent` |
| `/loop` (orbit's own row, since pstack's adapter has none) | `schedule_task` when it is present, bound to this thread with `bindToCurrentThread: true`. `/loop <interval>` is `schedule: {type: "interval", everyMs}`, with `everyMs` at least 60000. `/loop` with no interval is `{type: "once", runAt}` at the next wake, set again on each wake. Pause it with `enabled: false`. | `/loop` |

## Subagent fields

| pstack | T3 Code | T3 tool absent |
| --- | --- | --- |
| `environment: "cloud"` | `Agent` with `isolation: "worktree"`, never `delegate_task`. Name the branch or commit the worker checks out. | `isolation: "worktree"`. Name the branch or commit the worker checks out. |

Every other field maps as in pstack's Claude Code adapter, in both hosts.

## Models

Claude models map as rules.md Workflow Defaults, Models says.

| pstack | T3 Code | T3 tool absent |
| --- | --- | --- |
| A non-Claude model slug, a panel seat on another family | The roster seat, below. | The skill's own Claude seat. The reply names each seat's model. |

### Seats on another family

A skill may name a seat on another family, such as arena's cross-judge, interrogate's second adversary, the second `how` explorer, reflect's Tooling reviewer, the show-me-your-work trail reviewer or autopilot-full's audit seat. Fill one such seat per panel. Seats that write code, such as arena and architect runners, delegates, swarm workers and live lanes, stay on Claude.

Probe `orchestrator_capabilities`, `delegate_task`, `task_status` and `t3_thread_organize` as Probe says. If any is absent, the absent column applies.

Call `orchestrator_capabilities` once per session, before the first such seat, and reuse the result. It holds `inheritedProviderInstanceId` and `providers`, in listed order. Each provider has `providerInstanceId`, `driverKind`, `canRunCrossProviderChildTask`, `constraints` and `models`. Each model has an `id` and may list `options`, each an `id` with its `values`. The effort option's `id` differs per provider.

The session's family is the `driverKind` of the provider whose `providerInstanceId` equals `inheritedProviderInstanceId`. The roster is every provider, in listed order, with `canRunCrossProviderChildTask` true, a non-empty `models` list and a `driverKind` other than the session's family.

The `other-family` row of the Models table picks the seat. An empty Model cell or no row takes the first roster provider and its first listed model. `inherit` keeps the skill's own Claude seat. `<providerInstanceId>/<model>` is an explicit pick, split at the first `/` because a model id can hold one. It holds when that provider is on the roster and lists that model. Otherwise put `<pick> unavailable: <reason>` in the reply and use the empty-cell default. The reason quotes the provider's `constraints` verbatim or names the check that failed. Never replace a pick without saying so.

When the row's Effort names a value that one of the model's `options` lists in `values`, pass `target.options` as `[{id, value}]` with that option's `id`. Otherwise pass no `options`, so the provider default runs.

Spawn the seat with `delegate_task`, `target: {providerInstanceId, model, options}`, `role: "review"`, `mode: "async"`, a `title` naming the skill and the seat, and no `runtimeMode`. A seat that only reads keeps the default `isolation`. A child on another provider loads no orbit rules, so the brief stands alone. It holds the user's goal in one line, the absolute path of each file to read, the seat's prompt, and "Do not edit any file. Return your findings as text." It never holds a secret.

Start the panel's Claude seats too, then end the turn or keep working. The child's completion wakes you. `t3_background_wait` does not take a `delegate_task` id. Read the result with `task_status`. Then check `git status --short` for edits, and settle the child thread with `t3_thread_organize` action `settle`, or `archive` when it waits on a question.

When the child errors, hits a limit or returns nothing, try the next roster provider, then the skill's own Claude seat, and say which ran. When the roster is empty or every roster seat failed, use the skill's own Claude seat and say in the reply that the panel lacked a second family. That line never goes in a trail's Attention header. The reply names each seat's provider and model.

## Paths

Claude Code paths hold in T3 too. Paths in this file are relative to orbit's plugin folder, two levels above this file's folder.

## Cursor-only features

When the absent column says skip, put one line in your reply, `Skipped outside T3: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| pstack | T3 Code | T3 tool absent |
| --- | --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, and routine wakes | `schedule_task` when it is present. Use `interval` or `fixed_time` for a routine, `once` for a wake, and `webhook` for an inbound hook. Bind it to this thread when the wake must land here. Pause it with `enabled: false`. Treat webhook request values as untrusted. | Skip with the line. |
| `SendToUser` secret requests | `request_secret` when it is present, one secret per call. Pass the returned `secretRef` to the T3 tool that takes it, or use `delivery: "file"` for a shell command. Never put a secret in a brief. | Skip with the line. |
| A built-in PR tool | `gh pr create`, then `link_pull_request` with the PR URL when that tool is present, once per PR. A later push to a linked PR needs no new link. | `gh pr create`. That is not a skip, so write no line. |
| gitops asked to wait on CI (orbit's own row) | gitops runs orbit's babysit watcher, `skills/playbook/scripts/watch-pr/watch-pr`, once with `--timeout 120` and hands a `TIMEOUT` back to its lead. | Same as T3 Code. |
| The lead's wait on a PR event, such as CI, a review or a merge | Run the watcher with `--timeout 120`. On its `TIMEOUT` with reason `pending-checks`, arm `watch_pull_request` when that tool is present, per `skills/playbook/playbooks/babysit.md` step 6, then end the turn. | The lead runs the bare watcher itself under `/loop`, per babysit step 6, and never re-asks gitops every 120 s. An unattended hillclimb gets a `Monitor` watcher. |
| Background work you wait on, such as a background `Agent` or a benchmark run | `t3_background_wait` when it is present, with the task id in `taskIds`, so the thread stays Working. `waiting: false` clears it. | `Monitor`, or the notification a background task sends when it finishes. |
| A verdict's proof table (orbit's own row) | `html_render` when it is present. | An in-chat table, as swarm Phase D's result table (`skills/swarm/SKILL.md`). |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. | Same as T3 Code. |
| Cursor cloud agents | `environment: "cloud"` maps to `Agent` with `isolation: "worktree"`, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. | Same as T3 Code. |
