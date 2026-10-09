# orbit

One workflow for every project. Orbit teaches Claude Code to build, review and ship the same way in every repo, without being told each time.

It's a Claude Code plugin: shared working rules that load every session, a cheaper model that handles commits and PRs for you, an Opus reviewer that checks a change before it lands, and commands that carry work across sessions.

```
build  →  /orbit:ship  →  check  →  review  →  docs  →  commit or PR  →  next-task prompt
                          your     Opus       one       Sonnet
                          script   reviewer   line      gitops
```

## Install

In Claude Code:

```
/plugin marketplace add aayushbtw/orbit
/plugin install orbit@orbit
```

Update from `/plugin`. Your own `CLAUDE.md` and `settings.json` stay yours.

Defaults assume [Vite+](https://viteplus.dev) (`vp`, `vpr`). Projects that differ say so in their own AGENTS.md, see [Make it fit a project](#make-it-fit-a-project).

## What you get

| | | |
| --- | --- | --- |
| **Rules** | Delegation, code quality, where files go, workflow defaults | Loaded into every session by a hook, about 500 tokens |
| `/orbit:ship` | Check, review, docs, then land | `main` by default, or a PR if the project says so |
| `/orbit:handoff` | Save the session before `/clear` or a model switch | Writes the project's handoff note, outside the repo |
| `/orbit:resume` | Pick the work back up | Reads the note and does the next step |
| `/orbit:playbook` | A standard flow for `bug`, `feature` or `perf` | Reproduce first, smallest change, measure |
| `/orbit:correct` | Turn a mistake into a lasting guard | A lint rule, test or doc line |
| `gitops` | Commits and PRs | Sonnet. Claude hands git work to it on its own |
| `reviewer` | Pre-merge review | Opus, read-only. Checks correctness, TypeScript, React, prose and slop |

Commands are namespaced, so `/ship` is `/orbit:ship`.

## Make it fit a project

Add a `## Workflow` block to the project's AGENTS.md. List only what differs from the defaults:

```md
## Workflow

- Check: `vpr check`, plus `vpr e2e` when the UI changed.
- Land: `pr`
- Review also checks: `docs/architecture.md`, and that no demo fakes a missing component.
```

`templates/workflow-block.md` has the template. The reviewer also reads any "Mistakes made before" list in the same file.

## Skills

Vendored and reviewed, with their sources and local edits tracked in `skills.json`:

- `typescript-best-practices` and `unslop`, from [poteto/plugins](https://github.com/poteto/plugins) (pstack, MIT). Preloaded by `reviewer`.
- `vercel-react-best-practices` and `vercel-composition-patterns`, from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (MIT). The reviewer reads them for React diffs and may ask once to read the plugin folder. Allow `Read(~/.claude/plugins/**)` to skip the prompt.

## Maintain

- Develop without installing: `claude --plugin-dir ~/Projects/orbit`. Check with `claude plugin validate .`.
- Update the vendored skills: open Claude Code in this repo and run `/update-skills [name]`. It compares each skill with upstream, reads the changes, redoes the local edits listed in `skills.json`, and bumps the version.
- Release: bump `version` in `.claude-plugin/plugin.json`.
