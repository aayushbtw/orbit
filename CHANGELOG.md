# Changelog

## Version policy

From 1.0.0 on, a change to a rule or a flow that changes what orbit does for you bumps the major version. A fix bumps the patch version. Before 1.0.0, a change of that kind bumped the minor version.

## 1.0.0

Released 2026-11-17.

### Setup

- `/orbit:setup` runs on any host, not only in T3 Code. It checks `git`, `gh` and its login, `node`, `bun`, `jq`, the git repo, `origin/main`, the Workflow block, install drift, the Codex link and Grok, and prints the fix for each problem ([#43](https://github.com/aayushbtw/orbit/pull/43)).
- Setup collects every change it could make and asks you once at the end. It offers a filled Workflow block when a project has none, and its Models write keeps your other lines in the file ([#43](https://github.com/aayushbtw/orbit/pull/43)).
- In T3 Code, setup recommends a ranked provider list for seats on another family. A second question asks whether a native verifier may run when every listed provider fails ([#51](https://github.com/aayushbtw/orbit/pull/51)).

### T3 Code seats and providers

- A panel seat on another family runs only on a provider you listed, at most three, in list order. The reply says when no seat is configured, and it gives one `<entry> unavailable: <reason>` line for each listed provider that fails ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- The family check reads the model id, so a Claude lead refuses a Claude model on the Codex provider. `auto`, `default` and an unknown vendor are reported as `family unverified` ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- A Codex lead now follows the adapter's delegate rows. It reads the adapter in two parts, and every `delegate_task` call carries `mode: "async"` and a `clientRequestId` ([#74](https://github.com/aayushbtw/orbit/pull/74)).
- When every verifier entry fails, the lead sends one unavailable line per entry before its question ([#74](https://github.com/aayushbtw/orbit/pull/74)).

### Children and threads in T3 Code

- Every `Agent` call in T3 Code runs in the foreground, and parallel spawns go out as several calls in one message ([#48](https://github.com/aayushbtw/orbit/pull/48)).
- Owners, parallel delegates, arena runners, interrogate adversaries, writing swarm workers and the native verifier run as T3 child threads through `delegate_task`, each in its own worktree. Read-only children stay foreground `Agent` calls ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- Autopilot's tick fires while owners build, and it judges each owner by its trail and git ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- Parallel delegates take one path on every host. Each commits its own unit, and gitops cherry-picks the kept commit ([#74](https://github.com/aayushbtw/orbit/pull/74)).
- A code delegate runs at medium effort, even for a small change. Low effort is only for an edit that writes no logic ([#74](https://github.com/aayushbtw/orbit/pull/74)).
- The verifier never uses T3's preview browser. It drives a UI through the control skill's headless browser ([#49](https://github.com/aayushbtw/orbit/pull/49)).
- Ketchup draws a chart through `html_preview`, then `html_render`, when T3 provides them ([#49](https://github.com/aayushbtw/orbit/pull/49)).

### PR waits

- `watch-pr --once` reads a PR's status once and never sleeps. A pending PR returns `TIMEOUT pending-checks` in about 3 s ([#52](https://github.com/aayushbtw/orbit/pull/52)).
- In T3 Code, babysit reads once, calls `watch_pull_request` and ends the turn, then unwatches each PR before it hands back. A child never watches a PR ([#52](https://github.com/aayushbtw/orbit/pull/52)).
- A stacked PR whose CI runs only on PRs into `main` reads as `no CI` and reaches `READY`, instead of `TIMEOUT` ([#31](https://github.com/aayushbtw/orbit/pull/31)).
- `/orbit:pause-safely` unwatches the thread's PRs and names them in the resume note. Session pickup sends each one to babysit, which watches it again ([#49](https://github.com/aayushbtw/orbit/pull/49)).

### Hooks

- The trailer hook blocks only a real `git commit` or `git commit-tree`. An `echo` or `rg` that mentions them passes, and the hook reads the message file that `-F` names ([#45](https://github.com/aayushbtw/orbit/pull/45)).
- A plugin path with `&`, `|` or a space loads orbit's rules. When the rules file cannot be read, the hook prints an `orbit:` warning ([#45](https://github.com/aayushbtw/orbit/pull/45)).
- The rules load in three parts, so Claude Code's 10,000-character limit on hook output no longer cuts them ([#48](https://github.com/aayushbtw/orbit/pull/48)).

### Skills

- The vendored pstack skills move to `e1cc031`. Babysit, opening-a-pr and multi-phase-plan have shorter steps ([#47](https://github.com/aayushbtw/orbit/pull/47)).

### CI and tests

- CI runs the Check, the hook tests, the version guard and the T3 lane grader on every push. A flow eval and live T3 lanes on Claude, Codex and Grok leads record what each lead passes ([#40](https://github.com/aayushbtw/orbit/pull/40), [#44](https://github.com/aayushbtw/orbit/pull/44), [#46](https://github.com/aayushbtw/orbit/pull/46), [#73](https://github.com/aayushbtw/orbit/pull/73)).

### Breaking or behavior changes

- The `orchestrate` flow is removed. Program-scale work routes to `/orbit:figure-it-out`. A program already running under `orbit-orchestrate/` loses its playbook, and its `notes.md` stays on disk ([#67](https://github.com/aayushbtw/orbit/pull/67)).
- A seat on another family runs only on providers you list. Nothing falls back to native unasked, and with no `other-family` row you lose the seat that orbit picked for you before ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- `/orbit:setup` recommends no to a native verifier fallback. With no, the lead asks you or holds the PR when every listed verifier fails ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- A `verifier` row that reads `other-family` loses the automatic native verifier. The lead asks you instead, until you rerun `/orbit:setup` and answer yes ([#51](https://github.com/aayushbtw/orbit/pull/51)).
- In T3 Code, children that need their own checkout and long-running owners run as T3 child threads through `delegate_task` ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- In T3 Code with `delegate_task` off, owners run one at a time, and the autopilot tick cannot fire meanwhile ([#61](https://github.com/aayushbtw/orbit/pull/61)).
- gitops no longer waits up to 120 s. It reads PR status once with `watch-pr --once` ([#52](https://github.com/aayushbtw/orbit/pull/52)).
- "Wait on CI" now runs babysit in `drive` mode ([#52](https://github.com/aayushbtw/orbit/pull/52)).

### Known limits

- Grok as a lead is unproven. Its live runs stopped on the provider's usage quota in testing ([#73](https://github.com/aayushbtw/orbit/pull/73)).
- Each live scenario has one passing run per lead, so a result that passes only some of the time would not show ([#73](https://github.com/aayushbtw/orbit/pull/73)).
- An install from a directory marketplace updates only when you run `claude plugin update orbit@orbit`. Auto-update is off for third-party marketplaces, as the [README](README.md#install) says.
