Paste into the project's AGENTS.md. Do not create a CLAUDE.md.
List only what differs from the Workflow Defaults in orbit's rules; delete the lines that don't apply, or the whole block.

## Workflow

- Check: <only if not `vpr check` + build + test, eg `vpr e2e`, knip>.
- Land: `pr` (default is `main`), plus the merge method if not squash.
- Before code: <guidance for writing code under a path, which code delegates and `/orbit:interrogate` load and never skip; one `<path>: <source>` entry per source, separated by `;`, where a source is a file to read or a command that prints a skill or its path, eg `src/server/: node_modules/effect/AGENTS.md`; `src/routes/: vpx @tanstack/intent@latest load @tanstack/react-start#react-start --path`>.
- Review also checks: <docs read before planning and at review only; scope one to a path with `src/server/: <source>`>.

### Models

<One row per work type, a kind of work your delegates do. Row order breaks a tie, so list narrow work types first. A row named `gitops`, `verifier`, `advisor`, `judgment` or `code` changes only that orbit role. An empty cell keeps the default. A cell may add `, <value> after <n> failed tries`. Delete the subsection to keep orbit's defaults.>

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| `<kebab-name>` | <the work this row covers> | <`opus`, `sonnet`, `haiku`, `fable` or `inherit`> | <`low`, `medium`, `high`, `xhigh` or `max`> |
