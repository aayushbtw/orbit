# Make orbit fit your project

Orbit's defaults assume a [Vite+](https://viteplus.dev) project that lands each change straight onto `main`. When your project differs, you write the difference down once, in files that Claude and its subagents read on their own.

## Write the differences in a Workflow block

An instruction you type in chat lasts one session. A fresh subagent sees only the brief Claude writes for it, so your instruction reaches the subagent only if Claude carries it over. A `## Workflow` block in the project's AGENTS.md holds the difference for every task. Every flow reads it, and Claude copies the entries for a delegate's paths into that delegate's brief.

Without a block, orbit uses these defaults:

- **Check.** `vpr check`, then `vpr build` and `vpr test` if those scripts exist.
- **Land.** `main`. Each change gets its own worktree off `origin/main`, and Shipping fast-forwards `main` to it.
- **Review.** `/orbit:interrogate` runs before shipping when the design is contested.
- **Models.** `code=inherit; judgment=opus; gitops=sonnet`. The `code` model runs delegates, swarm workers, explorers and the verifier, and `inherit` means your session model. The `judgment` model runs the hardest delegates, one side of each two-model panel, autopilot owners and the advisor. The `gitops` model runs gitops.

The block lists only what differs. Start from [`templates/workflow-block.md`](../../templates/workflow-block.md), paste it into AGENTS.md, and delete every line that doesn't apply. The template says not to create a CLAUDE.md for it. Here is a block for a project that opens PRs and has two folders with their own conventions:

```md
## Workflow

- Check: `vpr check`, `vpr test`, then `vpr e2e`.
- Land: `pr`, rebase merge.
- Before code: `src/db/: docs/migrations.md`; `src/ui/: docs/components.md`
- Review also checks: `docs/security.md`.
- Models: `code=sonnet; judgment=opus`
```

Each line does one job:

| Line | What it sets | Who reads it |
| --- | --- | --- |
| Check | The command that proves a change is sound | The flows' verify steps. Under Land `main`, Shipping runs it in place of CI. |
| Land | `pr` to land through pull requests, plus the merge method if it isn't squash | Opening a PR opens the PR, Babysit drives it to merge-ready, and Shipping merges it. Under either setting, a fresh verifier passes the change before it lands. |
| Before code | Guidance for writing code under a path, as `<path>: <source>` entries separated by `;`. A source is a file to read, or a command that prints a skill or its path. | Each code delegate under that path, copied word for word into its brief. Also the plan gate and `/orbit:interrogate`. |
| Review also checks | Docs to read before planning and at review only. Scope one to a path with `src/server/: <source>`. | The plan gate and `/orbit:interrogate` |
| Models | The model for each role, as `code=<model>; judgment=<model>; gitops=<model>`. A value is `opus`, `sonnet`, `haiku`, `fable` or `inherit`. A key you leave out keeps its default. | Every subagent Claude spawns, except the few that pick their own model, such as `/orbit:recall`. When `code` and `judgment` are the same model, the two-model panels lose their diversity. |

Before code is the line that goes into the brief of the agent writing the code. Put guidance there that code under a path must follow. Put a doc in Review also checks when it matters for the plan and the review but not for each edit.

Your own CLAUDE.md and `settings.json` stay yours. Orbit's rules load on their own at the start of every session, and the Workflow block adjusts them for one project.

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

## Clean up old worktrees

Every change gets its own worktree under `.claude/worktrees/`, so parallel sessions never share a checkout. Worktrees stay after their change lands, and they add up on disk. `/orbit:worktree-cleanup` removes them, and it also runs when you ask Claude to clean up worktrees or free up space.

```text
/orbit:worktree-cleanup
```

It records free disk space, then runs an audit script that classifies each worktree by size, age, merge state, uncommitted work, PR state, and the newest chat that touched it. The audit only suggests what to remove. Claude asks you which sessions are still active and checks each candidate against your answer.

It pauses on a worktree a session is still using. It also pauses on uncommitted tracked edits, shows you the diff, and waits for your decision, since that work would be gone for good. It never removes a worktree that a live Claude Code session has locked. Branch refs survive the removal, so no commits are lost. It can also delete stale iOS simulators and clear caches you haven't said to keep. The reply shows free disk space before and after.

## Keep orbit up to date

Claude Code leaves auto-update off for third-party marketplaces, so orbit stays on the version you installed. [Auto-update](../usage.md#auto-update) lists the steps to turn it on. To update once by hand, run `claude plugin update orbit@orbit`.

Back to the [guide index](./README.md)
