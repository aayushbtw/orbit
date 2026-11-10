# Make orbit fit your project

Orbit's defaults assume a [Vite+](https://viteplus.dev) project that lands each change straight onto `main`. When your project differs, you write the difference down once, in files that Claude and its subagents read on their own.

## Write the differences in a Workflow block

An instruction you type in chat lasts one session. A fresh subagent sees only the brief Claude writes for it, so your instruction reaches the subagent only if Claude carries it over. A `## Workflow` block in the project's AGENTS.md holds the difference for every task. Every flow reads it, and Claude copies the entries for a delegate's paths into that delegate's brief.

Without a block, orbit uses these defaults:

- **Check.** `vpr check`, then `vpr build` and `vpr test` if those scripts exist.
- **Land.** `main`. Each change gets its own worktree off `origin/main`, and Shipping fast-forwards `main` to it.
- **Review.** `/orbit:interrogate` runs before shipping when the design is contested.
- **Parallel.** 4. At most 4 agents that build, test or run the app run at once, counted across the whole tree of subagents. Read-only agents don't count.
- **Models.** No work types. Prose delegates, such as a docs unit, run on the `judgment` model, which is Opus. Code delegates tier by difficulty, so the hardest also run on the `judgment` model and the rest on the `code` model, which is your session model or `CLAUDE_CODE_SUBAGENT_MODEL` when it is set. The `judgment` model also runs one side of each two-model panel, autopilot owners, the `how` explainer and the `why` synthesizer. The `code` model also runs the other side, swarm workers and explorers. gitops runs on Sonnet at `low`, the verifier on your session model at `high`, and the advisor on Fable at `high`, each from its agent file.

The block lists only what differs. Start from [`templates/workflow-block.md`](../../templates/workflow-block.md), paste it into AGENTS.md, and delete every line that doesn't apply. The template says not to create a CLAUDE.md for it. Here is a block for a project that opens PRs, has two folders with their own conventions, and routes two kinds of work to their own models:

```md
## Workflow

- Check: `vpr check`, `vpr test`, then `vpr e2e`.
- Land: `pr`, rebase merge.
- Before code: `src/db/: docs/migrations.md`; `src/ui/: docs/components.md`
- Review also checks: `docs/security.md`.

### Models

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| `migrations` | Schema changes and data migrations under `src/db/` | opus | high |
| `ui-copy` | Text and style edits inside one component | sonnet | low |
| `code` | | sonnet | |
```

Each line does one job:

| Line | What it sets | Who reads it |
| --- | --- | --- |
| Check | The command that proves a change is sound | The flows' verify steps. Under Land `main`, Shipping runs it in place of CI. |
| Land | `pr` to land through pull requests, plus the merge method if it isn't squash | Opening a PR opens the PR, Babysit drives it to merge-ready, and Shipping merges it. Under either setting, a fresh verifier passes the change before it lands. |
| Before code | Guidance for writing code under a path, as `<path>: <source>` entries separated by `;`. A source is a file to read, or a command that prints a skill or its path. | Each code delegate under that path, copied word for word into its brief. Also the plan gate and `/orbit:interrogate`. |
| Review also checks | Docs to read before planning and at review only. Scope one to a path with `src/server/: <source>`. | The plan gate and `/orbit:interrogate` |
| Parallel | How many agents that build, test or run the app run at once, 4 by default. Read-only agents and an agent that only waits on its children don't count. Write `Parallel: 1` for a light machine. | Every fan-out, such as parallel delegate units, swarm workers, arena runners, hillclimb attempts and autopilot owners |
| Models | A `### Models` table with Task, Use for, Model and Effort columns. Each row is a work type of your own, or one of orbit's roles: `gitops`, `verifier`, `advisor`, `judgment` and `code`. An empty cell keeps the default. | Every subagent Claude spawns, except Comment Sicko and a step that names its own model or effort, such as `/orbit:recall`. [Route work by work type](#route-work-by-work-type) explains how Claude picks a row. |

Before code is the line that goes into the brief of the agent writing the code. Put guidance there that code under a path must follow. Put a doc in Review also checks when it matters for the plan and the review but not for each edit.

Your own CLAUDE.md and `settings.json` stay yours. Orbit's rules load on their own at the start of every session, and the Workflow block adjusts them for one project.

## Route work by work type

Without work types, Claude decides which units are hard, and only those go to the `judgment` model. A Models table lets the project name its own kinds of work, called work types, and give each one a model and an effort. Here is the table from a game project, which sends shader math to Opus and number tuning to Sonnet at a low effort:

```md
### Models

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| `shader-math` | Shader and camera math, render bugs | opus | high, xhigh after 2 failed tries |
| `look-review` | Reviewing screenshots and judging the look | opus | medium |
| `data-tuning` | Skill, item and enemy Resources, numbers, the input map | sonnet | low |
| `docs` | Docs and plan edits | sonnet | low |
| `phase-planning` | Phase planning and design calls | opus | high |
| `cross-file-system` | A system across files: combat, enemy AI, saving, skill tree, collision layers | opus | high |
| `single-file-feature` | A feature inside one file: interact key, dummy, HUD | sonnet | medium |
```

Each column does one job:

- **Task** names the row in kebab case. Five names belong to orbit's roles: `gitops`, `verifier`, `advisor`, `judgment` and `code`. A row with one of those names changes only that role. Every other row is a work type.
- **Use for** names the work the row covers. Claude reads it to match a unit to a row.
- **Model** is `opus`, `sonnet`, `haiku`, `fable` or `inherit`. `inherit` passes no model, so the spawn runs on `CLAUDE_CODE_SUBAGENT_MODEL` when it is set, else on your session model. On the `gitops` and `advisor` rows, `inherit` keeps the model in the agent file. `fable` is Fable 5.2 from Claude Code 2.1.321 on, and Fable 5.1 before it. Fable's safeguards block most cybersecurity work, such as penetration testing and exploit generation, and an older Opus answers in its place. On a security project, set the `advisor` row's Model to `opus` and keep `fable` off rows whose work is security.
- **Effort** is `low`, `medium`, `high`, `xhigh` or `max`.

An empty cell keeps the default. The game has no role rows, so its roles keep orbit's defaults. Commits already run on Sonnet at `low` from gitops's agent file. A role row changes only the cells it fills, as the `code` row in [Give the panels a second model](#give-the-panels-a-second-model) shows.

### See which row a spawn takes

Before each spawn, Claude asks three questions in order. The first yes decides the spawn's model and effort, and with no yes the unit tiers by difficulty.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/guide-models-dark.svg">
  <img alt="Claude asks three questions before each spawn, with a fallback when every answer is no. If the step picks its own model or effort, such as recall's haiku or multi-phase-plan's live lanes at high, the spawn keeps it. Else, if the spawn names a role (gitops, verifier, advisor, judgment or code), it takes that role's row, where an empty cell keeps the default. Else, if a work type fits the poteto-agent unit, it takes that work type's row, which can step up after n failed tries. Else Claude tiers by difficulty, with the hardest change or prose on judgment and the rest on code, and when the project has work types the reply names the unit so you can add a row." src="../diagrams/guide-models-light.svg">
</picture>

1. A step that names its own model or effort keeps it. `/orbit:recall` runs on Haiku, the trail reviewer in `show-me-your-work` picks its own tier, and multi-phase-plan's live lanes run at `high`.
2. A spawn that names a role takes that role's row. gitops, the verifier and the advisor each take their own row. Interrogate's adversaries, arena's runners, swarm workers, autopilot owners, multi-phase-plan explorers, and the subagents of `/orbit:how`, `/orbit:why` and `/orbit:reflect` each name `judgment` or `code`. A skill that spawns with `model: "opus"` names the `judgment` role, so a `judgment` row reaches it. A two-model panel never takes a work type, so its sides follow only the `judgment` and `code` rows. Comment Sicko takes no row, so it keeps its agent file's effort and runs on the default subagent model.
3. Any other `orbit:poteto-agent` spawn takes the work type whose Use for fits its unit. That covers code delegates and their fix rounds.
4. A unit that no work type fits runs as it does with no table. A prose unit, such as docs or a written explanation, runs on the `judgment` model. A code unit tiers by difficulty. The hardest change, such as a cross-cutting design or a subtle algorithm, runs on the `judgment` model, and the rest run on the `code` model. When a `code` row makes that model cheaper than your session model, only trivial mechanical edits go to it, and the rest run on your session model. When the project has work types, Claude's reply names each unit that none of them fit, so you can add a row.

A row reaches subagents only. Claude plans in your session, on the model you picked with `/model`. The game's `phase-planning` row reaches the subagents Claude spawns for planning work, not the planning in your chat.

Each brief and each todo item names the row it ran on, as `Work type: shader-math`, or as `Role: judgment` or `Role: code` for a tiered unit.

### Split a unit that fits two rows

A unit can fit two work types. In the game, a HUD feature that also adds an item Resource fits both `single-file-feature` and `data-tuning`. If each part can be checked on its own, Claude splits the unit in two, and each part runs on its own row. If not, the unit runs as the type of its hardest part, here `single-file-feature`.

Row order breaks any tie that is left, so the first row that fits wins. Put narrow rows above broad ones. A unit that turns out to fit another type mid-work is briefed again under that type, and its try count starts over.

### Set an exact effort, with a step up

An Effort cell is the level Claude passes, as written. Claude adds no judgment of its own on top. With no Effort cell, gitops, the verifier, the advisor and Comment Sicko keep the level in their agent files. For any other spawn, Claude picks `high` for hard and judgment work, and `medium` or `low` for routine work. It passes `xhigh` or `max` only when a step, a row or you name them.

A work type's cell can add a step with `after <n> failed tries`. A failed try is a delegate whose work on the unit fails Claude's review or the check, or that crashes or returns nothing. Parallel attempts, such as arena runners, count no tries, and each part of a split unit starts at zero. In the game, a `shader-math` unit runs at `high` for its first two delegates. If both fail, the third runs at `xhigh`. The unit's todo item carries its try count. The step works in a Model cell too, such as `sonnet, opus after 2 failed tries`. A cell of `opus, fable after 2 failed tries` keeps a work type on Opus and moves a unit to Fable once Opus has failed it twice.

If the `Agent` tool rejects a row's model, Claude passes no model and says so. If the advisor can't run on Fable, because your account lacks it or its usage limit is reached, Claude retries it once on Opus and says so. If the tool rejects a level, Claude tries no other level. It uses the row's level or the one in the agent file, and says so.

If `CLAUDE_CODE_EFFORT_LEVEL` is set in your environment, Claude Code applies it to every spawn, over every Effort cell in the table.

### Give the panels a second model

In an Opus session under the defaults, the `judgment` and `code` models are both Opus. Interrogate's two adversaries and arena's two runners then run on one model, arena skips its judge, and a panel loses its second opinion. Work types don't help here, because panels never take one. One row fixes it:

```md
| `code` | | sonnet | |
```

The row moves every spawn on the `code` role to Sonnet. That covers one side of each panel, swarm workers and `how` explorers. In an Opus session, the same row makes all of those spawns cheaper. The row doesn't move gitops, the verifier, the advisor or Comment Sicko.

Code delegates are the catch. Without a guard, a Sonnet `code` row would also move every code delegate that no work type fits and isn't the hardest, so most of your code would be written on Sonnet. Orbit guards it. When the `code` row is cheaper than your session model, only trivial mechanical edits go to it, and every other code delegate runs on your session model. To put more code on Sonnet on purpose, add a work type for that kind of work.

## Put folder rules next to the code

A rule that only matters for one folder goes in an AGENTS.md (or CLAUDE.md) inside that folder, such as `src/payments/AGENTS.md`. When the plan gate runs, it reads every such file in the folders a change touches and in the folders above them. It also reads each `.claude/rules/` file whose `paths` match.

The plan gate runs when a change adds a module or touches more than 3 files. For a rule that every code delegate under a path must load, use a Before code entry instead.

## Fix a repeated mistake with /orbit:correct

Correcting Claude in chat fixes the current session. The next session can make the same mistake again. `/orbit:correct` puts a guard in the repo, so the mistake stops for every session after this one.

```text
/orbit:correct agents keep importing moment even though the project uses date-fns
```

It adds the guard at the highest level that works, taking the first one that fits:

1. Architecture that removes the cause, such as one owner per piece of state or one way to do each task. It deletes the old way an agent would copy.
2. A type or lint rule that makes the mistake impossible. The lint error names what to use instead.
3. A test that fails when the mistake happens.
4. One line in the nearest AGENTS.md, or in DESIGN.md, ARCHITECTURE.md, or DOCS.md if the project has them. This level is for judgment calls only, because nothing fails when an agent skips a doc.

For the first three levels, it runs the guard against the bad code and shows it fail. It adds one guard per run and shows you the diff.

It also keeps a "Mistakes made before" table in the nearest AGENTS.md, which pairs each rule with what enforces it. When a rule is already in the table and nothing enforces it, the mistake counts as a repeat, and `/orbit:correct` adds a guard at the highest level that works in the same change. A rule leaves the table once its mistake can't happen.

Run it with no argument and it reads recent commits, reverts, and review comments for a mistake that happened twice. If none repeats, it asks you which one to fix.

## Learn from a whole session with /orbit:reflect

`/orbit:correct` fixes one mistake in your repo. `/orbit:reflect` looks at a whole session and improves the skills Claude used in it.

```text
/orbit:reflect
```

It reads the transcript of the current session and its subagents, and no other session. Three reviewers read it in parallel, one each for judgment, tooling, and divergent ideas, and a synthesizer sorts their findings into Accepted, Rejected, and Backlog.

Accepted items are skill edits. Reflect shows you the full list and waits for your approval, because a skill edit changes every future session that uses that skill. You pick the subset to apply. It edits a plugin skill in that plugin's source repo, never the cached copy that an update would overwrite.

Backlog items are lessons that a lint, a script, or a check would enforce better than prose. They come back as `/orbit:correct` candidates.

## Capture your style with /orbit:automate-me

Orbit's rules describe one general way of working. `/orbit:automate-me` writes a skill for yours, named after you, such as `jay-mode`.

```text
/orbit:automate-me update my mode skill. I stopped wanting a test plan in PR bodies.
```

It mines your recent transcripts in the current workspace only, split into slices that parallel subagents read. A pattern that shows up in two or more slices counts. A lone signal is usually dropped. Then it asks you a few multiple-choice questions and one open question, to catch what the history missed.

The new skill goes in `.claude/skills/<handle>-mode/SKILL.md`, or in `~/.claude/skills/<handle>-mode/` if you want it personal. It runs when you type `/<handle>-mode`, not on every turn, unless you ask otherwise. It lands from a worktree through a PR, never by a push to `main`. On a later run, it reads only the history since the skill last changed and keeps every section you haven't contradicted.

## Copy gitignored files into each worktree

A new worktree holds only tracked files. If your Check needs a gitignored file, such as `.env.local`, list its pattern in a `.worktreeinclude` file at the repo root, one pattern per line. Claude Code copies matching files into each new worktree. When Claude finds the Check needs a file the list lacks, it adds the pattern and copies the file in once.

```text
.env.local
.claude/settings.local.json
```

## Clean up old worktrees

Every change gets its own worktree under `.claude/worktrees/`, so parallel sessions never share a checkout. When a change lands, Shipping removes its worktree, the verifier's and owners' worktrees, and its branch. A worktree with uncommitted changes stays, and the reply names it. Worktrees from abandoned or unshipped tasks still add up on disk. `/orbit:worktree-cleanup` removes them, and it also runs when you ask Claude to clean up worktrees or free up space.

```text
/orbit:worktree-cleanup
```

It records free disk space, then runs an audit script that classifies each worktree by size, age, merge state, uncommitted work, PR state, and the newest chat that touched it. The audit only suggests what to remove. Claude asks you which sessions are still active and checks each candidate against your answer.

It pauses on a worktree a session is still using. It also pauses on uncommitted tracked edits, shows you the diff, and waits for your decision, since that work would be gone for good. It never removes a worktree that a live Claude Code session has locked. Branch refs survive the removal, so no commits are lost. It can also delete stale iOS simulators and clear caches you haven't said to keep. The reply shows free disk space before and after.

## Keep orbit up to date

Claude Code leaves auto-update off for third-party marketplaces, so orbit stays on the version you installed. [Auto-update](../usage.md#auto-update) lists the steps to turn it on. To update once by hand, run `claude plugin update orbit@orbit`.

Back to the [guide index](./README.md)
