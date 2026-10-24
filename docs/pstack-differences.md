# Differences from pstack

Orbit copies pstack (`pstack/` in cursor/plugins). For Claude Code tool and path mappings, it follows pstack's adapter, `pstack/docs/harness/claude-code.md`. On a design fork, check pstack first. Record each difference here with its reason.

| Area | pstack on Claude Code | orbit | Why |
| --- | --- | --- | --- |
| Loading rules | The user runs `/pstack:poteto-mode` per task (`README.md`). | A SessionStart hook injects `rules.md` every session. | Rules hold without the user remembering a command. |
| Worktree for the main chat | "Work from a git worktree off main", no tool named (`playbooks/opening-a-pr.md`). | `EnterWorktree`, then `ExitWorktree` after landing. | Claude Code's worktree tools, and ship removes the worktree after landing. |
| Running another skill | `Read` its SKILL.md by path, since the Skill tool refuses most pstack skills (`docs/harness/claude-code.md`). | Flow skills (start, playbook, ship, how, why) run through the Skill tool. Principles and opt-in skills keep `disable-model-invocation` and are read by path or typed. | The flow chains skills, so they must be invocable. |
| Commits | No actor named. The delegate step says "Commit liberally" (`playbooks/feature.md` step 4), and `opening-a-pr.md` says to amend and rebase into small ordered commits. Bodies follow `technical-writing`. | The parent reviews each unit, then the `gitops` subagent (Sonnet) commits it, subject only. Unpushed fixes fold in with fixup and autosquash. | Review before commit, and git output stays out of the main context. |
| Model per role | `setup-pstack` writes `~/.claude/rules/pstack-models.md` (`docs/harness/claude-code.md`). | A fixed `model` in agent frontmatter. reviewer and advisor use Opus, gitops uses Sonnet, the rest inherit. | Only Claude models exist here, so a per-role setup step adds nothing. |
| Task end | No handoff line. Feature work stacks its follow-ups (`playbooks/feature.md` step 6), and Autonomy proceeds on reversible work (`poteto-mode/SKILL.md`). | The same, plus one `Next:` status line. | The user's global CLAUDE.md asks for it. |
| Pausing | Always pause for force-push to shared branches, deploys, data deletion, customer messages (`poteto-mode/SKILL.md` Autonomy). | The same list, plus gates a skill names (ship's manual-test go). | Ship's manual test needs the user. |
| Broken skill mid-task | Fix it in its own PR (`poteto-mode/SKILL.md`). | Fix it in its own commit. | Orbit lands on `main` by default. |
| Feature flow | `how`, `architect`, a throughput checkpoint, then the delegate (`playbooks/feature.md`). | "done" bullets, the data shape, then the delegate. No `architect` or checkpoint. | Not vendored yet. |
| Vendored subset | 58 skills (`skills/`). | The subset in `skills.json`. | Unvendored skills are adopted when a flow needs them. |
