# Changelog

## Version policy

Before 1.0.0, a change to a rule or a flow that changes what orbit does for you bumps the minor version. A fix bumps the patch version. From 1.0.0 on, a change of that kind will bump the major version.

## 0.79.0

### Breaking or behavior changes

- Orbit runs in T3 Code only. The host adapter (`plugin/docs/harness/t3-code.md`) maps every PR, CI, issue, worktree, wait, schedule, secret and HTML step to a T3 tool, and drops the "outside T3" and absent-column branches, the `/loop` and `Monitor` fallbacks, and `gh` as the forge. A T3 tool a thread lacks takes the adapter's **When a tool is absent** path.
- Babysit reads each PR with `pull_request_read` and names its verdict (`COMPLETE`, `BLOCKER`, `WAIT`, `READY`). gitops opens PRs with `pull_request_create`, replies with `pull_request_respond`, merges with `pull_request_merge`, and reads and reruns CI with `ci_logs` and `ci_rerun`. The Worktree gate calls `t3_worktree_handoff`.
- Remove `plugin/skills/playbook/scripts/` (the `watch-pr` watcher and its bun toolchain) and `plugin/skills/setup/scripts/antigravity-skills.mjs`. `/orbit:setup` drives the orbit CLI (`orbit doctor --json`, `orbit setup`, `orbit hosts sync`, `orbit models set`, `orbit init`), and `doctor.sh` checks only git, node, orbit, the repo and the Workflow block.
- All five roles (`advisor`, `judgment`, `code`, `verifier`, `gitops`) default to `inherit`. `judgment` no longer defaults to `opus`, `orbit:gitops` and `orbit:advisor` name no model, the advisor's Fable-to-Opus retry is gone, and skills name roles instead of `model: "opus"`. Orbit reads Models rows from `orbit models` or `~/.config/orbit/config.json`, then `.orbit/config.json` and AGENTS.md, and no longer reads `models.md` itself.

### CLI

- Port Antigravity skills registration to `cli/src/antigravity.ts`, imported statically, with its tests in `cli/test/antigravity.test.ts`. Convert the CLI tests to TypeScript and stage the plugin in `vite.config.ts`'s pack `onSuccess`, so no `.mjs` source is left in `plugin/` or `cli/`.
- `orbit models set interrogate|arena --effort` fails and points at per-seat `@<effort>`. `AGENTS.md` arena rows accept spaces around `judge =`, and malformed `interrogate` or `arena` entries show up as a project config error.
- `orbit hosts enable` registers the host before it saves `config.hosts`, so a failure on an external host leaves `config.json` untouched. Interactive `orbit setup` skips external hosts in its picker and says why. `orbit update` runs the new global CLI with stderr inherited, and through a shell on Windows.
- `orbit doctor` strips `@<effort>` only from `interrogate` and `arena` seats, so it agrees with `orbit models resolve` on a `provider/model@word` target.

## 0.78.0

- Make the `orbit` CLI a T3-first control plane with atomic `~/.config/orbit/current` symlink management (`install`, `update`, `use`, `link`, `unlink`, `uninstall`, `status`, `doctor --fix`).
- Add multi-host registration adapters (`antigravity`, `codex`, `agents`, `claude`, `grok`) under `orbit hosts`.
- Store user-wide task, panel, and work-type assignments in `~/.config/orbit/config.json` with named profiles (`orbit profile`), automatic one-time migration from `models.md`, project `.orbit/config.json` overrides, live `orbit models sync` via T3 ACP, deterministic `orbit models resolve`, and `orbit init`.
- Fix `### Models` parsing when `AGENTS.md` task names or cells are wrapped in backticks, and remove backticks from `plugin/skills/setup/workflow-block.md`.
- The lead and `/orbit:setup` read and write the CLI's `~/.config/orbit/config.json` (through `orbit models resolve` and `orbit models set` when `orbit` is on PATH) before `models.md`. The CLI uses rules.md's role names (`advisor`, `judgment`, `code`, `verifier`, `gitops`), `judgment` defaults to `opus`, and effort follows rules.md's levels plus the values a target model lists.
- Orbit CLI leaves a Claude Code or Grok orbit install it does not manage alone and reports it as `external`.
- `orbit update` takes the version as `[targetVersion]` or `--to`, and runs the new CLI from `npm prefix -g`. `orbit models set arena` validates its runners and `--judge`, panel seats accept `@effort`, `doctor` checks each roster and panel entry, `AGENTS.md` overrides reach `interrogate` and `arena`, and a malformed `.orbit/config.json` shows up in `status` and `doctor` instead of crashing.

## 0.77.1

- Say where a Models target wins without relying on an override sentence. A child whose cell holds a target skips the Where a child runs table, Shipping's diff review follows a `judgment` target, and a target on your own provider retries as other native spawns do.

## 0.77.0

- Add an interactive Orbit CLI to install and register an Orbit bundle for T3 Code without a Claude Code install, configure user-wide model assignments, and inspect effective project settings.
- Store Models preferences in `~/.config/orbit/models.md`. Existing preferences are read from the legacy file until the first save. User-wide work types can route units across projects.

## 0.76.0

Released 2026-11-23.

### Breaking or behavior changes

- Any Models row's Model cell, roles and work types alike, may hold one target, `<providerInstanceId>/<model>`, split at the first `/`. A `, <value> after <n> failed tries` value may be a target too. The `other-family` row keeps its ordered list.
- A target on the lead's own provider runs on the lead's own subagent tool with the target's model. Claude Code's `Agent` takes the alias that is a token of the model id, so `claude-opus-5-5` runs as `opus`.
- A target on another provider runs as a `delegate_task` child on it, when the lead runs in T3 with `delegate_task` and the provider passes a seat's checks. A child that shares the checkout, such as the advisor, gitops or a fix round, gets `isolation: "shared"`. A child that needs its own checkout runs as the adapter's Where a child runs says, on the target's provider. Otherwise the spawn runs as if the cell were empty, and the reply says `<cell> unavailable: <reason>`.
- A `shared` child on another provider runs in the lead's checkout by absolute path, and stops when its first `git -C <path> rev-parse --show-toplevel` does not print that path. A target child that errors, hits a limit or returns nothing reruns once as if the cell were empty, with an `unavailable` reply line.
- A `verifier` row with a target on another provider fills the verifier seat with that one entry. When it is unavailable, the lead asks before a native verifier runs, or holds the PR.

## 0.75.0

Released 2026-11-23.

### Breaking or behavior changes

- `/orbit:setup` adds Step 5 to check and offer to register orbit's canonical `skills` folder in `~/.gemini/config/skills.json` when it detects Antigravity (`agy`, `~/.gemini/config`, or an enabled `antigravity` provider in T3).
- `plugin/skills/setup/scripts/doctor.sh` prefers non-lane `orbit@*` install records over `orbit@orbit-head-*`, prints `orbit skills dir:`, and delegates read-only Antigravity config inspection to `plugin/skills/setup/scripts/antigravity-skills.mjs`.
- `plugin/skills/setup/scripts/antigravity-skills.mjs` updates `~/.gemini/config/skills.json` atomically after resolving symlinks. It preserves `inherits` and non-orbit entries, replaces stale orbit paths in place while keeping filters, and refuses to overwrite invalid JSON.

### CI and tests

- `tests/setup/antigravity-skills.test.mjs` runs in CI. `tests/provider-names.mjs` allowlists `plugin/skills/setup/scripts/doctor.sh` and `plugin/skills/setup/scripts/antigravity-skills.mjs` as setup data.

## 0.74.0

Released 2026-11-23.

### Breaking or behavior changes

- Shipping's diff review runs the advisor on the `judgment` model, Opus by default, instead of Fable. The advisor keeps Fable for the plan gate and forks. Only an advisor on Fable retries on Opus, so a review that fails on Opus retries on the session model.

## 0.73.0

Released 2026-11-23.

### Breaking or behavior changes

- A lead on any provider can run orbit. The `rules` skill no longer tells a lead outside Claude Code to stop. A lead without Claude Code's SessionStart hook gets orbit's rules from the `rules` skill, which also reads `~/.claude/rules/orbit-models.md`.
- The T3 Code adapter has an Any lead section. It maps each Claude Code tool, such as `Skill`, `Agent`, `EnterWorktree` and `TodoWrite`, to the lead's own equivalent by what the lead's tool list holds, never by provider. A tool that the lead's tool search can load counts as in its list, so a Claude Code lead keeps its deferred `EnterWorktree` and `Monitor`. A lead whose list lacks `Agent` or `Skill` reads that section before its first reply.
- Children stay on the lead's provider. A lead whose subagent tool cannot pick an orbit agent names the agent file in the brief. A lead with no subagent tool does gitops's work itself and sends every other child to a same-provider `delegate_task`. Only a seat on another family leaves the lead's provider.
- A lead without `EnterWorktree` passes the Worktree gate with `t3_worktree_handoff`, on a branch named `<type>/<slug>`. On `/orbit:session-pickup`, it works in an existing task worktree by absolute path and never calls `t3_worktree_handoff` again.
- To switch the thread's provider mid-task, run `/orbit:pause-safely`, switch with `t3_thread_configure` or the T3 model picker, then run `/orbit:session-pickup`. A lead with no auto memory directory writes and reads the resume note in Claude Code's memory directory for the main checkout, so a lead on either provider finds it. Pickup reads the note plus the prior thread, with `t3_thread_read`, when the note has no `originSessionId` or is newer than the newest other transcript.
- After a Stop, each delegated task that T3 reports as interrupted reruns as a fresh `delegate_task` when the goal still needs it. A lead that lost a child's task id in a compaction recovers it from the list that `task_status` returns for an unknown id.
- The family check counts `google` as the vendor word for `gemini`.

### CI and tests

- `tests/provider-names.mjs` fails CI when a provider name appears in `plugin/`, outside setup's provider ranking and the seat family words.
- The T3 lane and grader accept a lead on any provider. A lane whose lead is not Claude is graded on outcomes, because the grader reads only a Claude session transcript.

## 0.72.0

Released 2026-11-22.

### Breaking or behavior changes

- In T3 Code, gitops links a PR only right after its own `gh pr create`, or when the brief says to link it or take it over. It no longer links again after a push, a merge, a CI wait or a read, because a link persists across pushes.
- The lead calls no link tool and loads none, except for a PR it opened without gitops, a PR a `delegate_task` child opened, or after gitops reports a link failure. A PR the lead watches needs no link, because `watch_pull_request` links it.
- The lead's first gitops brief on a PR this thread did not open says to link it, unless the lead already armed a watch on it. The lead now reads the T3 Code adapter before the first step that opens, pushes to or waits on a PR, not only one that opens or waits on it.
- Before a handback, the lead unwatches only the PRs it armed and has not unwatched since. It skips a PR that merged or closed, or that T3 said it stopped watching, because its watch already ended.
- `t3_background_wait` takes only the id of a running `Bash` background task or `Monitor`. It never takes an `Agent` id and is never called without a running task's id.

### CI and tests

- The transcript audit has a `t3-wasted-calls` metric. It counts link, unwatch and background-wait calls that did nothing, out of all T3 link, watch, unwatch and background-wait calls.

## 0.71.0

Released 2026-11-20.

### Breaking or behavior changes

- A task's final reply now has four parts in a fixed order. They are the outcome in one or two sentences, the closed task list for a multistep plan, a `Heads-up:` list, and the `Next:` line.
- `Heads-up:` always shows, worst first. It names what was not done, each skipped or waived step, each check that failed, did not run, passed with parts unverified or ran on a fallback, unasked behavior changes, anything left behind, problems left outside the goal, and calls made in your place. With none, it says `Heads-up: nothing skipped, failed or left behind.`
- What ran as planned no longer appears in the reply. Passing checks get one clause in the outcome. Steps taken, passing output, default models and removed worktrees go in the PR body under Land `pr`, or nowhere.
- When no PR opens, as under the default Land `main`, what a flow sends to the PR body goes in the reply between the outcome and `Heads-up:`. So does a result that is the deliverable itself, such as an answer, a number, a plan or each PR's status.
- Principles that shaped a decision now go in the PR body's `## Tradeoffs`, which now holds them beside rejected alternatives, or in the reply when no PR opens.
- The feature, bug and shipping flows report less in the reply. Feature's rejected alternatives go in `## Tradeoffs`, and the throughput checkpoint stays in the todo list. Bug's repro output goes in a PR comment or file that `## Verification` links. Shipping names only what landed in the outcome, and lists a short run, a verdict other than a plain `PASS` with its notes, a fallback, an unfixed finding or a kept worktree as a Heads-up item.
- The reply names a seat's or reviewer's model only when it ran on a fallback.

## 0.70.0

Released 2026-11-20.

### Breaking or behavior changes

- Claude, through Claude Code, is now the only lead. Codex, Grok and other families run only as panel seats on another family and as the verifier seat. A lead that is not running in Claude Code now says that orbit leads only under Claude Code, and stops.
- `plugin/docs/harness/t3-other-lead.md` is gone, with every rule that forked on the lead's provider. The T3 lanes for Codex and Grok leads, and the `rules-load` and `code-child` lanes, are gone too.
- `/orbit:start` tracks steps with Claude's task tools only.
- `/orbit:setup` no longer links Codex, checks what Codex and Grok load, or offers an always-on rules line. Its provider ranking drops Claude and recommends the first three of Codex, Muse, Gemini and Grok that are enabled.

### Manual cleanup

- Remove the `~/.codex/skills/orbit` symlink if setup created it.
- Remove the orbit rules line from `~/.codex/AGENTS.md` and `~/.grok/AGENTS.md` if setup added it.
- An existing `~/.claude/rules/orbit-models.md` may still list `claudeAgent`. Seats skip it, and rerunning `/orbit:setup` rewrites the list.

## 0.69.2

Released 2026-11-20.

### Children and threads in T3 Code

- When `task_status` on a child's wake shows `working` or `waiting_for_children`, the lead now neither reads, settles nor polls the child, and waits for its wake. Before, no rule covered that state.

## 0.69.1

Released 2026-11-20.

### Children and threads in T3 Code

- The T3 tick rule that a lead never reads a running child's `task_status` now applies only until the child's wake, so it no longer contradicts reading the result on the wake.

## 0.69.0

Released 2026-11-20.

### Breaking or behavior changes

- In T3 Code, a Claude lead now keeps working after it starts a `delegate_task` child, and ends its turn only when no other work is left. T3 now delivers the child's result inside the running turn, beside the next tool result, so the lead reviews and settles the child in the same turn. It used to see the result only in a new run after its turn ended. A result that comes after the turn ended still arrives in a new run, so ending the turn stays safe. A Codex lead or another lead still gets the result in a new run.
- A child result that arrives in the middle of a step, such as a review or another child's cherry-pick, waits until that step is done. The lead handles each result once.

## 0.68.0

Released 2026-11-20.

### Breaking or behavior changes

- In T3 Code, a lead whose PR waits on someone else's merge, such as a merge queue, auto-merge or a person, no longer hands back. It keeps the PR watched and ends its turn, and it resumes when the PR merges or closes. orbit used to say a T3 watch never wakes on a merge, which was wrong.
- A watch passes `until: "merged"` when a merge queue or auto-merge holds the merge, or when you asked for a merge and it waits on checks or a named reviewer. The thread then stays in Working until the PR lands. A merge a person holds, or a review with no reviewer requested, passes `until: "checks"`, so the thread returns to your inbox and the merge still wakes it.
- A lead now arms a PR watch again after T3 ends it on a PR that is still open, such as after a reopen, 10 comment-only wakes in a row or 8 failed reads in a row. It still never re-arms on an ordinary wake.

## 0.67.0

Released 2026-11-20.

### Breaking or behavior changes

- gitops, the advisor, the verifier and comment-sicko now give each git command its own plain Bash call. They no longer chain git with `&&` or put a shell variable or `$(...)` in a git argument, which Claude Code's worktree guard refuses. While their session is isolated in a worktree, they run git only there, because the guard also refuses `git -C` or `cd` into another checkout. Otherwise gitops and the advisor use `git -C <path>` for a checkout their brief names. A ship loses less time to refused calls.
- A code-writing delegate now stops and reports to its lead before an irreversible write, such as a force-push to a shared branch, a deploy, a data deletion or a message to a customer. It no longer reads Task End's Always-pause list in `rules.md`.
- A prose delegate's brief names the `unslop` and `technical-writing` skills, which it no longer finds through `rules.md`'s triggers.
- An autopilot owner's brief names `rules-shared.md` beside `rules.md`, because an owner is a `general-purpose` agent that gets no SessionStart output.

### Token use

- A code-writing delegate reads 2,488 words of orbit's rules before it starts, in place of 5,660. It reads the playbook and the new `plugin/rules-shared.md` and skips `rules.md`, whose routing, shipping and delegation rules are for the lead.
- `rules-shared.md` holds the rules the lead and its delegates share. They are the one-plain-command Bash rule, Code Quality, Files and Comments, moved from `rules.md`. Only the `# Bash` heading and the first sentence of Comments are new, because that sentence pointed at the reply rules, which stay in `rules.md`.
- The lead still gets every rule. A fourth SessionStart hook prints `rules-shared.md`, and the `rules` skill reads it for a lead that is not Claude Code.

## 0.66.1

Released 2026-11-20.

### Token use

- In T3 Code, a Claude lead with no providers listed for seats on another family now reads 3,429 words of the T3 adapter in place of 6,144. Nothing orbit does changes.
- The seat rules moved to `plugin/docs/harness/t3-seats.md`. A session reads it only when the `other-family` Models row lists providers or the `verifier` row is `other-family` or `other-family, inherit`. The rules for a child's question, stopping and archiving stay in `t3-code.md`, because they hold for every child.
- The tool map for a lead that is not Claude Code, such as Codex or Grok, moved to `plugin/docs/harness/t3-other-lead.md`. Only such a lead reads it, through the `rules` skill and rules.md **Host tools.**

## 0.66.0

Released 2026-11-20.

### Breaking or behavior changes

- In T3 Code, a child that gets its own checkout now starts from the commit its brief names. T3 starts that checkout at HEAD of the thread's bound checkout, else of the project root, so it could miss the work the lead committed on the task branch. Each brief names the start SHA, the task head, the fetched `origin/<trunk>` or a stacked owner's parent PR tip, and the child resets its own branch there with `git reset --hard <start sha>`.
- Before that reset, the child runs `git rev-parse --show-toplevel` and stops without resetting when it is in the lead's checkout or the project root. A child that got no worktree never moves your branch or drops your edits.
- On the wake, the lead cherry-picks a child's commit only when it descends from that start SHA. One that does not is a failed try.

## 0.65.0

Released 2026-11-20.

### Breaking or behavior changes

- After a branch lands, Shipping first leaves the session's worktree with `ExitWorktree` and `keep`. Only then does gitops remove the task, verifier and owner worktrees and the local branch, by absolute path. The cleanup no longer trips Claude Code's worktree guard or a refused `ExitWorktree` `remove`.
- The lead never passes `remove` or `discard_changes` to `ExitWorktree` in Shipping. Discarding work is your call.
- Under Land `main`, gitops deletes the landed branch with `git branch -D` only when `git merge-base --is-ancestor <branch> origin/main` succeeds. It never switches, merges or fast-forwards your main checkout. A branch with commits that did not land stays, and the reply names it.
- A T3 thread whose working directory is the task worktree keeps that worktree and its branch after the land, and the reply names them. A session outside the worktree skips the exit, and gitops removes the worktree as usual.
- While a session is isolated in a worktree, it and its subagents run git only there. Git in another checkout waits until Shipping step 7 leaves with `ExitWorktree` and `keep`.

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
