# Orbit CLI

The `orbit` CLI installs, updates, and manages Orbit for T3 Code across every enabled provider.

## Install and upgrade

Install `@aayushbtw/orbit` globally with Node.js 22.12 or later:

```bash
npm install -g @aayushbtw/orbit
orbit setup
```

`orbit setup` stages the versioned plugin bundle under `~/.config/orbit/releases/<version>/plugin`, points the atomic symlink `~/.config/orbit/current` to it, registers Orbit skills with your selected T3 providers, and attempts to sync live T3 model capabilities.

Every host registration points at `~/.config/orbit/current`, so upgrades and rollbacks never rewrite provider configs:

- `orbit update` checks npm for a newer `@aayushbtw/orbit` release, updates the package, swaps `~/.config/orbit/current`, and prunes old releases (`--check` checks without installing, `--keep <n>` sets retention). Pass a version as `orbit update 0.79.0` or `orbit update --to 0.79.0` to install that release instead of the latest. After the npm install, `orbit update` runs the new CLI from `npm prefix -g`, so an older `orbit` earlier on `PATH` does not stage the bundle.
- `orbit use <version>` switches `~/.config/orbit/current` to any previously staged release.
- `orbit link [path]` points `~/.config/orbit/current` at a local Orbit checkout so T3 providers load local edits immediately. `orbit unlink` switches back to the latest staged release.
- `orbit status` and `orbit doctor` show bundle health, host registration state, catalog freshness, and effective model assignments. Pass `orbit doctor --fix` to repair drift automatically.
- `orbit uninstall` deregisters Orbit from all hosts and removes installed releases (`--purge` also deletes user config and state).

## Register T3 providers

Orbit includes adapters for Antigravity (`~/.gemini/config/skills.json`), Codex (`~/.codex/skills/orbit`), Agent Skills (`~/.agents/skills/orbit`), Claude Code (`~/.claude/skills/`), and Grok (`~/.grok/skills/`).

```bash
orbit hosts
orbit hosts enable codex antigravity
orbit hosts disable grok
orbit hosts sync
```

Claude Code and Grok each read one directory per skill, so their adapters create per-skill symlinks inside `~/.claude/skills/` and `~/.grok/skills/` pointing at `~/.config/orbit/current/plugin/skills/<name>`. Before linking, the adapter checks for non-orbit entries that collide with an orbit skill name and fails as `invalid` instead of overwriting them. On sync, it repoints outdated orbit links and prunes orbit links for skills the active bundle no longer ships.

Every host with a user-wide instructions file loads orbit's rules by opening the `rules` skill. `orbit hosts enable`, `orbit hosts sync`, and `orbit setup` write one marked block into that file to tell the lead to load the `rules` skill before its first reply. The files are `~/.claude/CLAUDE.md` for Claude Code, `~/.codex/AGENTS.md` for Codex, `~/.grok/AGENTS.md` for Grok, and `~/.gemini/config/AGENTS.md` for Antigravity. When `CODEX_HOME` or `GROK_HOME` is set, the Codex or Grok adapter uses that folder in place of `~/.codex` or `~/.grok` for both the skills directory and the instructions file. The block sits between `<!-- orbit:rules:start -->` and `<!-- orbit:rules:end -->`, and Orbit CLI never changes text outside those markers. A symlinked file keeps its link, and the CLI writes its target. `orbit hosts disable` and `orbit uninstall` remove the block and the newline before it, so the file returns to its exact bytes. `orbit doctor` and `orbit hosts list` report a registered or stale host whose block is missing or edited, and `orbit doctor --fix` rewrites it.

`orbit doctor` and `orbit hosts` also check for legacy plugin installs, specifically `orbit@*` in `~/.claude/plugins/installed_plugins.json` and `orbit` in `~/.grok/installed-plugins/registry.json`. When either is present, the host reports as `stale` and prints its uninstall command (`claude plugin uninstall orbit@orbit` or `grok plugin uninstall orbit`). Orbit CLI never runs either host CLI itself.

## Configure models per task

User-wide routing lives in `~/.config/orbit/config.json` under named profiles. Existing preferences in `~/.config/orbit/models.md` or `~/.claude/rules/orbit-models.md` import automatically on the first read and convert on save. The orbit lead reads the same store through `orbit models list --json` and `orbit models resolve <task> --json`, and reads `config.json` directly only when `orbit` is not on `PATH`. The plugin no longer reads the Markdown files itself.

Built-in tasks are orbit's roles from `plugin/rules.md`: `advisor`, `judgment`, `code`, `verifier` and `gitops`, alongside the panel slots `other-family`, `interrogate` and `arena`, plus custom work types such as `writing`. The older names `plan`, `hard`, `verify` and `fast` still work as aliases. All five roles default to `inherit`, which runs the session's model, so orbit names no model family until you set one. Effort is `low`, `medium`, `high`, `xhigh` or `max`, or any value the target model's effort option lists. Project overrides in `.orbit/config.json`, then `AGENTS.md` `### Models`, win over the active user profile.

```bash
orbit models sync
orbit models
orbit models set code claudeAgent/claude-opus-5-5 --effort medium
orbit models set judgment codex/gpt-6.2-sol --effort ultra
orbit models set verifier other-family
orbit models set interrogate "judgment, codex/gpt-6.2-sol@high"
orbit models set arena "judgment, code" --judge other-family
orbit models resolve code --lead antigravity/gemini-pro-orchestrator-neon --json
```

Panel seats for `interrogate` and `arena` are comma-separated role names, `other-family`, or `<provider>/<model>[@effort]` targets. `--judge` sets the arena judge with the same syntax. In `AGENTS.md`, write the judge as a `judge=<seat>` entry, spaces around `=` allowed, as in `| arena | | judgment, code, judge = other-family | |`. A malformed `AGENTS.md` panel entry, such as `judge = invalid`, shows up as a project config error in `orbit status` and `orbit doctor`. `--effort` is refused on `interrogate` and `arena`, because each seat takes its own `@<effort>`.

`orbit models sync` fetches live providers and supported options from T3 when run inside a T3 terminal, or reads a saved JSON file with `--from <file>`. `orbit models resolve` outputs the exact `delegate_task` `target` payload, including provider-native option keys (`effort`, `reasoningEffort`, `thought_level`), retry escalations, and family checks. `orbit doctor` checks every listed target against the synced catalog, including each `other-family`, `interrogate` and `arena` entry, and reports a malformed `.orbit/config.json` as an issue.

Manage saved model presets with profiles:

```bash
orbit profile save rigor
orbit profile use default
orbit profile list
```

## Initialize a project

Run `orbit init` inside a repository to add a `## Workflow` block to `AGENTS.md` from detected build/test scripts and optionally scaffold `.orbit/config.json`:

```bash
orbit init --land pr --config
```

## Build from source

`npm run build` in `cli/` bundles `dist/cli.mjs` and, in the same Vite+ pack step, stages `plugin/` into `dist/plugin/`. It fails when the CLI and plugin versions differ. From the repository root:

```bash
npm ci --prefix cli
npm pack ./cli
npm install -g ./aayushbtw-orbit-*.tgz
```
