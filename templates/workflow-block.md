Paste into the project's AGENTS.md. Do not create a CLAUDE.md.
List only what differs from the Workflow Defaults in orbit's rules; delete the lines that don't apply, or the whole block.

## Workflow

- Check: <only if not `vpr check` + build + test, eg `vpr e2e`, knip>.
- Land: `pr` (default is `main`), plus the merge method if not a merge commit.
- Manual test: <where to test by hand, eg a local URL>.
- Before deploy: <steps>.
- Review also checks: <docs or skills read before planning and at review; scope one to a path with `src/server/: <source>`>.
