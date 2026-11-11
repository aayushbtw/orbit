# Build a change

Once the design is settled, Claude builds the change through a fixed set of gates. Each gate catches one kind of mistake at the point where it is cheapest to fix. [Start a task](./01-start-a-task.md#the-todo-list-is-the-playbook) shows the whole run as one diagram.

A typical goal names the behavior and what must not move:

```text
/orbit:start add CSV export to the reports page. the JSON endpoint keeps its current response, and the parser lands before the UI.
```

The feature, bug, refactor, perf and hillclimb flows, and `/orbit:figure-it-out` runs, all pass through the gates below. The investigate and prototype flows build nothing to ship, so they skip them.

## Give each change its own worktree

Before the first edit, Claude calls `EnterWorktree` and moves into a new git worktree under `.claude/worktrees/`. The worktree is named `<type>-<slug>`, and its branch is renamed to `<type>/<slug>`, where `<type>` is the commit type of the change, such as `feat`, `fix`, `refactor` or `perf`. When the project has a lockfile, Claude runs `vp install` so the check can run there. Gitignored files the check needs, such as `.env.local`, come in through the project's `.worktreeinclude` ([Copy gitignored files into each worktree](./08-make-it-fit.md#copy-gitignored-files-into-each-worktree)).

A worktree exists so that parallel sessions never share a checkout. You can run two tasks at once, or keep working in your main checkout, and neither sees the other's half-finished edits. The worktrees stay out of your main checkout's `git status`.

If the session is already in a clean worktree, Claude reuses it. If that worktree holds unrelated work or is in a bad state, Claude starts a fresh one with a new slug. When the change lands, Shipping removes its worktree and branch. `/orbit:worktree-cleanup` removes worktrees from tasks that never landed.

## Check a large plan before writing it

A plan that adds a module or touches more than 3 files goes through the plan gate. Claude first reads the project's guidance for the paths the plan touches:

- the Workflow block's "Review also checks" sources and its `Before code` entries for those paths
- every AGENTS.md or CLAUDE.md in those folders and the folders above them
- each `.claude/rules/` file whose `paths` match

Then it briefs the advisor with the plan and those sources. The advisor runs on Fable at `high` effort unless an `advisor` row in your Models table changes it, reads the repository itself, and edits nothing. It returns a verdict of `proceed`, `proceed with changes` or `stop`, with concrete recommendations, and Claude acts on it.

The gate exists because a wrong shape is cheapest to fix before any code depends on it. A second model checks a multi-file plan against the project's own rules at that point, not after review. You can also ask for the advisor at any other time:

```text
before you touch anything, get the advisor's read on this migration plan.
```

## Keep the author and the reviewer apart

The delegate gate splits the work in two. Claude plans, reviews and verifies. A fresh `orbit:poteto-agent` writes the code, one verifiable unit per delegate.

Each delegate's brief holds the worktree path, the file paths, the named data shape, the behavior to reach or hold, the check that proves it, and every `Before code` entry from your Workflow block for those paths, copied word for word. The delegate reads orbit's playbook and rules in full, loads those entries, writes the unit, and reports its changed paths and the check it ran. It never commits.

Claude then reviews the diff, confirms the changed paths match the brief, and runs the check itself. Only then does gitops commit that unit by path. Units that share a file run one after another, and the next delegate starts after that commit.

No code is reviewed by the agent that wrote it. The gate holds for a one-line change too, because the gain is the separate review, not fewer lines in the main session. A fix round goes to a fresh delegate with the original brief, every later instruction, Claude's findings and the current diff. Claude does not ask the first delegate to patch its own work.

Each delegate runs on its unit's work type, the row of your Workflow block's Models table whose Use for fits the unit, at that row's model and effort ([Route work by work type](./08-make-it-fit.md#route-work-by-work-type)). With no work types, or none that fits the unit, a prose delegate, such as a docs unit, runs on the `judgment` model, which is Opus by default. Code delegates tier by difficulty. Delegates for the hardest changes also run on the `judgment` model. Those are cross-cutting design, tricky concurrency and subtle algorithms. Trivial mechanical edits run on the `code` model, which is your session model by default. So does every other delegate, unless a `code` row sets that model to `sonnet` or `haiku`. Then those delegates run on your session model.

Two kinds of delegates run in parallel. Units the feature flow's throughput checkpoint marks independent, with disjoint files, run side by side. So do arena runners and parallel hillclimb or figure-it-out attempts. Each works in its own worktree, and all of them stay under the Parallel cap of 4 agents at once ([Make orbit fit your project](./08-make-it-fit.md#write-the-differences-in-a-workflow-block)). For each unit or attempt worth keeping, gitops commits it there and cherry-picks it onto the task branch.

Every delegate's brief also says it runs on your machine, not a VM. It runs the app headless or windowless when the project allows it, and never opens a window that takes focus or plays sound unless you agreed.

## Build in small units with ordered commits

Before it fans out, the feature flow writes a throughput checkpoint as four todo items. The items cover the steps that block everything else, the workstreams that can run in parallel, any state two workers might both write, and the smallest safe split. A dimension that does not apply stays on the list as `n/a: <reason>`.

The work then goes out in small units that each end in a check. The sequence-verifiable-units principle drives this. Claude builds, verifies and commits each unit before it starts the next, so each step is proven before the next one builds on it.

gitops writes each commit as `type(scope): subject`, with a body that says why the change exists. A fix that belongs in an unpushed unit folds into it with `--fixup` and `--autosquash`. Before Shipping, gitops rebases the unpushed units into small, ordered commits, so fix rounds don't clutter the history. It never rewrites a pushed commit.

A bug fix follows the same pattern. When the bug has a cheap local test path, the bug flow points to the `tdd` skill, and the failing reproduction lands as its own commit before the fix.

## Clean the diff before anyone reads it

Opening a PR, the last step of every change flow, runs three cleanup passes. The delegate gate leaves these cleanup fixes to Claude.

- **`/orbit:deslop`** reads the diff for AI-generated slop and removes it. That means comments that break local style, defensive checks or `try`/`catch` blocks on trusted paths, `any` casts that only silence the compiler, and deep nesting that early returns would flatten. Behavior stays the same unless the fix is for a clear bug.
- **`/orbit:no-comments`** spawns Comment Sicko, an agent that deletes every comment outside a short keep list. The list covers license headers, doc comments on a public API, issue or RFC links that explain a constraint, `// prettier-ignore`, and behavior forced by a dependency or platform you cannot change. A comment that excuses a surprise in your own code gets deleted, and the code it excused gets a `MUST KILL` flag for a rename, extraction or redesign. When a comment claims a constraint, such as "do not remove", the skill offers to encode it as a type, runtime check, test or lint, and waits for your approval.
- **`/orbit:unslop`** cuts AI tells from prose. Opening a PR writes every title, description and commit body with `/orbit:technical-writing`, then applies unslop. Orbit's rules apply it to Claude's replies to you too.

Comments get a separate agent for the same reason code does. The no-comments skill defers to Comment Sicko's fresh view, not to the agent that wrote the comment. Orbit's own rule is that a comment stays only for a non-obvious why that the code cannot show.

You can run unslop on any doc yourself:

```text
/orbit:unslop docs/setup.md. it reads like a press release.
```

## Follow the stack rules for TypeScript

Stack rules work like principles, scoped by file type. Before Claude or a delegate writes `.ts` or `.tsx` code, it reads the index in `typescript-best-practices` and opens only the rules that apply. TypeScript is the only stack with rules today.

The rules apply the type-system-discipline principle. They model variants as discriminated unions on a `kind` field, brand primitives such as IDs, and use `unknown` for external data instead of `any`. They parse data where it enters into a named domain type and add a `never` check in default arms, so a new variant fails the build. They also rule out `as` casts before validation.

The aim is to make an illegal state impossible to construct, so the compiler catches the bug a review would miss. You never type the skill yourself, since it loads when the code matches. The full rule table is in [`typescript-best-practices`](../../plugin/skills/typescript-best-practices/SKILL.md).

Next: [Prove it works, then ship](./05-prove-and-ship.md)
