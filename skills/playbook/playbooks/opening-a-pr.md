### Opening a PR

Invoked at the end of every other flow.

**Land.** The Land line in the project's Workflow block decides what opens. With no Land line, Land is `main`. Under Land `pr`, gitops pushes the task branch as `<type>/<slug>` and opens the PR with the title and description you wrote. Under Land `main`, gitops pushes nothing and opens no PR, and the branch stays local in the worktree. The reviewed units stay committed on the task branch in its worktree, unpushed, until `/orbit:ship` lands them.

**Worktree.** Work from a git worktree off main, per the Worktree gate. Parallel delegates each get their own, per the Delegate gate.

**Commits.** gitops commits each reviewed unit by path, per the Delegate gate. Units are committed in order as they pass review, so nothing needs reordering. Each commit is landable and ordered to tell the story. Amend when the fix belongs in a just-made commit. Fold a later fix into its unpushed unit with fixup and autosquash. New commit when separable. Commit bodies don't restate the subject.

**PRs.** Run `/orbit:deslop` over the diff before commit and `/orbit:no-comments` before review. Write every PR title, description, and commit body with `/orbit:technical-writing` (every layer except Diátaxis, and apply the STE vocabulary rules: one word per action, keep articles, a plain verb over `-ing` where one works), then apply `/orbit:unslop`.

**Titles.** Conventional Commits `type(scope): subject`, no trailing period. Type such as `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or `perf`. Scope is the area, such as `pstack` or `poteto-mode`. Subject is short, imperative, and names a real symbol when one carries the change, for example `fix(pstack): retarget opening-a-pr babysit trigger`.

**Descriptions.** The PR body is a one-minute briefing, not a lab notebook, for a reviewer who has the diff. It says why the change exists, what it leaves out, what it could break, and how you proved it works. Write short, simple sentences with few identifiers, no walls of text. Under a squash merge the body becomes the commit body, so keep it under about 40 lines. Use `##` headings, not bold lead-ins, in this order, and drop a section with nothing to say:

- `## Why`. The problem and approach, 1 to 3 short sentences. No SHAs, rebase genealogy, or "based on main" preamble.
- `## What changed`. 1 to 3 short bullets. Name a real symbol or path only when it carries the change. Name both sides of a rename or retarget.
- `## Scope`. Always. 1 to 3 short items on what it covers and what it deliberately leaves out (a follow-up, a known gap). No symbols, paths, or file-by-file essay.
- `## Tradeoffs`. Only rejected alternatives a reviewer would otherwise ask about. Skip when there was no real choice.
- `## Blast Radius`. 1 to 2 sentences on who or what it touches and why that is safe or risky. If main is red, state the cost of leaving it red.
- `## Verification`. 1 to 3 bullets, each a real run path and its outcome. For perf, one primary number with its unit, `before → after`, and a link to the arena directory for the rest. No sample-size methodology, swarm recitals, or metric tables.

After the sections, attach videos or screenshots when they prove a claim. Full SHAs, swarm or arena lane recitals, lever-correction essays, file-by-file checklists, and "CLEAN" verdicts go in a linked artifact, not the body.

**Forge.** GitHub CLI (`gh`) is the forge.

**Size and stacks.** Prefer five narrow PRs to one large PR. A stack is a base-branch chain. The root PR targets trunk. Each child branch rebases onto its parent's exact tip and its PR targets the parent branch. As a parent merges, move its child onto trunk per `playbooks/shipping.md` step 4. Create a child with `gh pr create --base <parent-branch>`, and retarget one with `gh pr edit <pr> --base <parent-branch>`. Branch from trunk only for independent work. Rebase on trunk before substantial stack work. Under Land `main` no PR opens, so a stack is a chain of unpushed task branches, each child on its parent's exact tip.

**Readiness.** Open every PR ready, never as a draft. With `gh`, omit `--draft`. If a PR still opens as a draft, run `gh pr ready <number>`. Run `gh pr view <number>` before you refer to PR status.

**Babysit.** Opening a PR does not start a babysit. Post the URL and keep building. Finish the phase or stack first. Run a separate babysit pass only after the whole stack exists, when the user asks for one or **Ship by default** below starts it. A babysit for each new PR stalls the build and spends checks on commits later waves restart. Push back when feedback drifts from intent.

A subagent that opens a PR runs `/orbit:interrogate`, `/orbit:deslop`, and `/orbit:no-comments`, and posts the URL. It returns to the parent without babysitting, unless it is an autopilot-full or autopilot-stack owner. That owner's brief assigns the babysit loop and is the ask `playbooks/babysit.md` waits for. The owner writes its `code-ready` trail row, starts the loop once its PR is open, reports merge-ready or STACK-READY per its playbook, and is exempt from the rules here and in `playbooks/babysit.md` that hold babysitting until a whole stack is built.

**Ship by default.** A change task ships unless the user opted out. Once the task's PR, or its whole stack, is built, run Babysit (`playbooks/babysit.md`) in `drive` mode to merge-ready under Land `pr`. It is `drive` even for a small or docs-only PR, because Shipping needs the watcher's terminal verdict. Then Shipping (`playbooks/shipping.md`). Under Land `main`, run Shipping. Shipping's independent verifier still gates every landing. "don't ship", "I'll land it" or "stack them, don't ship" opts out, and the task stops at the PR, or under Land `main` at the branch. Under a multi-phase plan the default runs `autopilot-full`, and the opt-out runs `autopilot-stack`. The plan's explicit go and its review gate still stop the run. A subagent that opens a PR still returns as the paragraph above says, and an autopilot owner stops where its brief says.

**Reply:** when the task shipped, Shipping's reply, and `Next: nothing pending.` once the whole run landed. After an opt-out, the PR URL, or under Land `main` the worktree path and branch so a later session can ship it, and `Next: /orbit:ship`.
