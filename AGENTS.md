## Workflow

- Check: `claude plugin validate . && claude plugin validate plugin && (cd plugin/skills/playbook/scripts && bun install --frozen-lockfile && bun test && bun run typecheck)`. The first validate checks the marketplace, the second the skills. The subshell runs the playbook scripts' tests and typecheck.
- Land: pr, squash
- CI: `.github/workflows/check.yml` runs the Check plus the hook, worktree-audit, diagram drift, link, reference (`tests/refs.mjs`: orbit skill, agent and path references inside `plugin/` resolve), T3 lane grader, ship cleanup grader and version-bump scripts in `tests/` on every push.
- Ship cleanup eval: `node tests/ship/cleanup.mjs`, or `--ref <ref>` to run orbit's plugin at a git ref, grades whether Shipping lands and cleans up without worktree-guard refusals (see `tests/ship/README.md`; costs a real session; not part of Check).
- Routing eval: `node tests/routing/run.mjs`, or `--host t3` to run the lead in T3 Code (costs a real session; not part of Check). `node tests/routing/flows.mjs` runs one prompt per route and grades the flow `/orbit:start` picks (costs a real session per route; not part of Check).
- T3 lane: `node tests/t3/lane.mjs --head <ref> --scenario <slug>` runs one T3 thread with orbit loaded from `<ref>` (see `tests/t3/README.md`; costs a real session; not part of Check).

### Models

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| other-family | panel seat on another family | inherit | |

## Maintaining orbit

- pstack (`cursor/plugins` at the `sha` in `skills.json`) is the reference. Copy its wording and names. Record each divergence in `docs/pstack-differences.md`.
- A local edit to a vendored skill gets a line in that skill's `edits` in `skills.json`. Otherwise `/update-skills` drops the edit.
- Only `plugin/` ships. Dev-only files (this file, `.claude/`, `docs/`, `skills.json`, `templates/`, `tests/`) stay outside it.
- Explain a flow in the docs with a hand-drawn diagram, not mermaid. Add a scene to `docs/diagrams/render.mjs`, run `vpr build` there, and embed the light and dark SVGs with `<picture>`.
- Bump `version` in `plugin/.claude-plugin/plugin.json` so installs pick up the change, and add a `## <version>` entry to `CHANGELOG.md` in the same PR.

## Mistakes made before

| Rule | Enforced by |
| --- | --- |
| Every version bump gets its `## <version>` entry in `CHANGELOG.md` in the same PR | `tests/version-bump.sh` in CI |
