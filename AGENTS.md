## Workflow

- Check: `claude plugin validate . && claude plugin validate plugin`. The first checks the marketplace, the second the skills.

## Maintaining orbit

- pstack (`cursor/plugins` at the `sha` in `skills.json`) is the reference. Copy its wording and names. Record each divergence in `docs/pstack-differences.md`.
- A local edit to a vendored skill gets a line in that skill's `edits` in `skills.json`. Otherwise `/update-skills` drops the edit.
- Only `plugin/` ships. Dev-only files (this file, `.claude/`, `docs/`, `skills.json`, `templates/`) stay outside it.
- Explain a flow in the docs with a hand-drawn diagram, not mermaid. Add a scene to `docs/diagrams/render.mjs`, run `vpr build` there, and embed the light and dark SVGs with `<picture>`.
- Bump `version` in `plugin/.claude-plugin/plugin.json` so installs pick up the change.
