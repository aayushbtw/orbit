# Changelog

## Version policy

Before 1.0.0, a change to a rule or a flow that changes what orbit does for you bumps the minor version. A fix bumps the patch version. From 1.0.0 on, a change of that kind will bump the major version.

## 0.64.0

Released 2026-11-20.

### Breaking or behavior changes

- Before the lead asks you which approach to take, it briefs the advisor with every open fork, acts on the advisor's pick and reports it. The reply says in plain words what you could tell it to do instead.
- The lead still asks you for an irreversible write, a gate you named, a pick that drops or changes what you asked for, and a skill's own questions, such as `/orbit:setup`'s. It finishes the work that doesn't depend on the answer first.
- Before the verifier runs, Shipping has the advisor review each PR's diff, on Fable by default. A blocking finding gets a fix round first, and the reply names the model that reviewed the diff.
- In a multi-phase plan, a fork that no prototype settles goes to the advisor, not to you.

## 0.63.0

Released 2026-11-19.

### Task progress

- `/orbit:start` tracks its step list with the session's native task tools. That is `TaskCreate` and `TaskUpdate` or `TodoWrite` under Claude, `update_plan` under Codex, and the native equivalent under another provider. In T3 Code, these updates show as task progress ([#77](https://github.com/aayushbtw/orbit/pull/77)).
- A skipped or waived step stays in the list with its `skip: <reason>` and is marked completed. On resume, the lead updates the existing list and does not create a second one ([#77](https://github.com/aayushbtw/orbit/pull/77)).

### Breaking or behavior changes

- Without a native task tool, the lead tracks the step list silently and never prints it ([#81](https://github.com/aayushbtw/orbit/pull/81)).
- The reply's task list shows your tasks, such as `[x] Fix the login redirect`, never the playbook's steps. It appears once at the start. After that, a task's line appears again only when its state changes, and the final reply shows the closed list ([#79](https://github.com/aayushbtw/orbit/pull/79), [#81](https://github.com/aayushbtw/orbit/pull/81)).
- The reply shows a task list only when the goal holds two or more separate tasks. One change, built, reviewed and landed, gets a line of progress instead ([#82](https://github.com/aayushbtw/orbit/pull/82)).

## 0.62.0

Released 2026-11-17.

### Setup

- `/orbit:setup` runs on any host, not only in T3 Code. It checks `git`, `gh` and its login, `node`, `bun`, `jq`, the git repo, `origin/main`, the Workflow block, install drift, the Codex link and Grok, and prints the fix for each problem ([#43](https://github.com/aayushbtw/orbit/pull/43)).
- Setup collects every change it could make and asks you once at the end. It offers a filled Workflow block when a project has none and Vite+ is missing, and its Models write keeps your other lines in the file ([#43](https://github.com/aayushbtw/orbit/pull/43)).
- In T3 Code, setup recommends a ranked provider list for seats on another family. A second question asks whether a native verifier may run when every listed provider fails ([#51](https://github.com/aayushbtw/orbit/pull/51)).

### T3 Code seats and providers

- A panel seat on another family runs only on a provider you listed, at most three, in list order. The reply says when no seat is configured, and it gives one `<entry> unavailable: <reason>` line for each listed provider that fails ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- The family check reads the model id, so a Claude lead refuses a Claude model on the Codex provider. A seat on an `auto` or `default` model, or under a lead whose family is unknown, is reported as `family unverified` ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- A Codex lead now follows the adapter's delegate rows. It reads the adapter in two parts, and every `delegate_task` call carries `mode: "async"` and a `clientRequestId` ([#74](https://github.com/aayushbtw/orbit/pull/74)).
- When every verifier entry fails, the lead sends one unavailable line per entry before its question ([#74](https://github.com/aayushbtw/orbit/pull/74)).

### Children and threads in T3 Code

- Every `Agent` call in T3 Code runs in the foreground, and parallel spawns go out as several calls in one message ([#48](https://github.com/aayushbtw/orbit/pull/48)).
- When the lead has `delegate_task`, parallel delegates, arena runners, interrogate adversaries, swarm workers that write, the native verifier and each autopilot owner's build round run as T3 child threads, each in its own worktree. An owner's later rounds, and read-only children, stay foreground `Agent` calls ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- Autopilot's tick fires while owners build, and it judges each owner by its trail and git ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- Parallel delegates take one path on every host. Each commits its own unit, and gitops cherry-picks the kept commit ([#74](https://github.com/aayushbtw/orbit/pull/74)).
- A code delegate runs at medium effort, even for a small change. Low effort is only for an edit that writes no logic ([#74](https://github.com/aayushbtw/orbit/pull/74)).
- Outside T3 Code, a Codex or Grok lead with no native worktree option runs units that need their own checkout one at a time, never with `git worktree add`. The same holds in T3 Code when `delegate_task` is off ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- A lead in plan mode passes `interactionMode: "plan"` on every `delegate_task` ([#49](https://github.com/aayushbtw/orbit/pull/49)).
- The lead reads a thread with `t3_thread_read` before it answers about it. When you only ask to schedule, it calls `schedule_task` without running the prompt. It follows T3's `request_secret` sudo flow. It reads `orchestrator_capabilities` once per thread ([#48](https://github.com/aayushbtw/orbit/pull/48)).
- Hillclimb passes a `Monitor` task to `t3_background_wait` ([#49](https://github.com/aayushbtw/orbit/pull/49)).
- The verifier never uses T3's preview browser. It drives a UI through the control skill's headless browser ([#49](https://github.com/aayushbtw/orbit/pull/49)).
- Ketchup draws a chart through `html_preview`, then `html_render`, when T3 provides them ([#49](https://github.com/aayushbtw/orbit/pull/49)).

### PR waits

- `watch-pr --once` reads a PR's status once and never sleeps. A pending PR returns `TIMEOUT pending-checks` in about 3 s ([#52](https://github.com/aayushbtw/orbit/pull/52)).
- In T3 Code, babysit reads once with `--once`. While checks or a review are pending, it calls `watch_pull_request` and ends the turn. It unwatches each PR before it hands back. A child never watches a PR ([#52](https://github.com/aayushbtw/orbit/pull/52)).
- A stacked PR whose CI runs only on PRs into `main` reads as `no CI` and reaches `READY`, instead of `TIMEOUT` ([#31](https://github.com/aayushbtw/orbit/pull/31)).
- `watch-pr --once` ends at `TIMEOUT status-unavailable` (exit 5) when checks are not registered yet, and a missing PR is a `not-found` BLOCKER (exit 7) ([#52](https://github.com/aayushbtw/orbit/pull/52)).
- In T3 Code, gitops links each PR it creates, takes over or pushes to, with `link_pull_requests` for several ([#52](https://github.com/aayushbtw/orbit/pull/52)).
- `/orbit:pause-safely` unwatches the thread's PRs and names them in the resume note. Session pickup sends each one to babysit, which watches it again ([#49](https://github.com/aayushbtw/orbit/pull/49)).

### Hooks

- The trailer hook blocks only a real `git commit` or `git commit-tree`. An `echo` or `rg` that mentions them passes, and the hook reads the message file that `-F` names ([#45](https://github.com/aayushbtw/orbit/pull/45)).
- A plugin path with `&`, `|` or a space loads orbit's rules. When the rules file cannot be read, the hook prints an `orbit:` warning ([#45](https://github.com/aayushbtw/orbit/pull/45)).
- The rules load in three parts, so Claude Code's 10,000-character limit on hook output no longer cuts them ([#48](https://github.com/aayushbtw/orbit/pull/48)).

### Skills

- The vendored pstack skills move to `e1cc031`. Babysit, opening-a-pr and multi-phase-plan have shorter steps ([#47](https://github.com/aayushbtw/orbit/pull/47)).
- The reply links each file it cites or produces by its absolute path ([#48](https://github.com/aayushbtw/orbit/pull/48)).

### CI and tests

- CI runs the Check, the hook, worktree-audit, diagram drift, link, version and T3 grader tests on every push. A flow eval and live T3 lanes record each lead's result ([#40](https://github.com/aayushbtw/orbit/pull/40), [#44](https://github.com/aayushbtw/orbit/pull/44), [#46](https://github.com/aayushbtw/orbit/pull/46), [#73](https://github.com/aayushbtw/orbit/pull/73)).

### Breaking or behavior changes

- The `orchestrate` flow is removed. Program-scale work routes to `/orbit:figure-it-out`. A program already running under `orbit-orchestrate/` loses its playbook, and its `notes.md` stays on disk ([#67](https://github.com/aayushbtw/orbit/pull/67)).
- A seat on another family runs only on providers you list. Nothing falls back to native unasked, and with no `other-family` row you lose the seat that orbit picked for you before. A list that ends with `inherit` still runs the session-family seat for panels ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- `/orbit:setup` recommends no to a native verifier fallback. With no, the lead asks you or holds the PR when every listed verifier fails ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- A `verifier` row that reads `other-family` loses the automatic native verifier. The lead asks you instead, until you rerun `/orbit:setup` and answer yes ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- In T3 Code with `delegate_task`, children that need their own checkout and each autopilot owner's build round run as T3 child threads ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- In T3 Code with `delegate_task` off, owners run one at a time, and the autopilot tick cannot fire meanwhile ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- gitops no longer waits up to 120 s. It reads PR status once with `watch-pr --once` ([#52](https://github.com/aayushbtw/orbit/pull/52)).
- "Wait on CI" now runs babysit in `drive` mode ([#52](https://github.com/aayushbtw/orbit/pull/52)).

### Known limits

- Grok as a lead is unproven. Its live runs stopped on the provider's usage quota in testing ([#73](https://github.com/aayushbtw/orbit/pull/73)).
- On the Claude and Codex leads, each live scenario has one graded passing run, so a result that passes only some of the time would not show ([#73](https://github.com/aayushbtw/orbit/pull/73)).
- Auto-update is off for third-party marketplaces, so orbit updates when you run `claude plugin update orbit@orbit` or turn auto-update on, as the [README](README.md#install) says.
