## Workflow

- Check: `(cd cli && npm ci && npm run check && npm run build && npm test)`. The subshell runs the Orbit CLI's typecheck, build (which stages `plugin/` into `cli/dist/plugin/`), and tests.
- Land: pr, squash
- CI: `.github/workflows/check.yml` runs the Check plus the worktree-audit, diagram drift, link, reference (`tests/refs.mjs`: orbit skill, agent and path references inside `plugin/` resolve), provider-names (`tests/provider-names.mjs`: no provider name in `plugin/` outside its allowlist), T3 lane grader, ship cleanup grader, transcript audit and version-bump scripts in `tests/` on every push.
- Ship cleanup eval: `node tests/ship/cleanup.mjs`, or `--ref <ref>` to run orbit's plugin at a git ref, grades whether Shipping lands and cleans up without worktree-guard refusals (see `tests/ship/README.md`; costs a real session; not part of Check).
- Routing eval: `node tests/routing/run.mjs`, or `--host t3` to run the lead in T3 Code (costs a real session; not part of Check). `node tests/routing/flows.mjs` runs one prompt per route and grades the flow `/orbit:start` picks (costs a real session per route; not part of Check).
- Transcript audit: `node tests/audit/audit.mjs --projects <dirs> --since <date>` reads local Claude Code transcripts and prints orbit's metrics (guard refusals, worktree exits, rules reads, verifier verdicts, foreground waits, user corrections), with baselines to compare against (see `tests/audit/README.md`; reads local files only; not part of Check).
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
- Bump `version` in `plugin/manifest.json` so installs pick up the change, set the same version in `cli/package.json` and `cli/package-lock.json`, because CI's Orbit CLI step fails when they differ, and add a `## <version>` entry to `CHANGELOG.md` in the same PR.
- The user tests orbit from the main checkout when `~/.config/orbit/current` points at it via `orbit link`. After an orbit change lands, gitops fast-forwards that checkout with `git -C /Users/aayush/Projects/orbit pull --ff-only` when it is on `main` and clean, and then you run `orbit hosts sync` when `~/.config/orbit/current` points at it. This overrides Shipping step 7's rule to leave that checkout alone. If the checkout is dirty or on another branch, report it in the reply. New sessions load the update.

## Mistakes made before

| Rule | Enforced by |
| --- | --- |
| Every version bump gets its `## <version>` entry in `CHANGELOG.md` in the same PR | `tests/version-bump.sh` in CI |
| Provider-specific lead rules (a row or clause that names one provider) stay out of plugin/; every rule keys on the lead's tool list | `tests/provider-names.mjs` in CI |
