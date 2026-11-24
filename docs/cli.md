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

- `orbit update` checks npm for a newer `@aayushbtw/orbit` release, updates the package, swaps `~/.config/orbit/current`, and prunes old releases (`--check` checks without installing, `--keep <n>` sets retention).
- `orbit use <version>` switches `~/.config/orbit/current` to any previously staged release.
- `orbit link [path]` points `~/.config/orbit/current` at a local Orbit checkout so T3 providers load local edits immediately. `orbit unlink` switches back to the latest staged release.
- `orbit status` and `orbit doctor` show bundle health, host registration state, catalog freshness, and effective model assignments. Pass `orbit doctor --fix` to repair drift automatically.
- `orbit uninstall` deregisters Orbit from all hosts and removes installed releases (`--purge` also deletes user config and state).

## Register T3 providers

Orbit includes adapters for Antigravity (`~/.gemini/config/skills.json`), Codex (`~/.codex/skills/orbit`), Agent Skills (`~/.agents/skills/orbit`), Claude Code, and Grok.

```bash
orbit hosts
orbit hosts enable codex antigravity
orbit hosts disable grok
orbit hosts sync
```

## Configure models per task

User-wide routing lives in `~/.config/orbit/config.json` under named profiles. Existing preferences in `~/.config/orbit/models.md` or `~/.claude/rules/orbit-models.md` import automatically on the first read and convert on save. All unconfigured tasks default to `inherit` (the lead thread's active model).

Built-in tasks are `plan`, `code`, `hard`, `writing`, `verify`, `fast`, and `comments`, alongside panel slots `other-family`, `interrogate`, and `arena`, plus custom work types. Project overrides in `.orbit/config.json` and `AGENTS.md` `### Models` win over the active user profile.

```bash
orbit models sync
orbit models
orbit models set code claudeAgent/claude-opus-5-5 --effort medium
orbit models set hard codex/gpt-6.2-sol --effort ultra
orbit models set verify other-family
orbit models resolve code --lead antigravity/gemini-pro-orchestrator-neon --json
```

`orbit models sync` fetches live providers and supported options from T3 when run inside a T3 terminal, or reads a saved JSON file with `--from <file>`. `orbit models resolve` outputs the exact `delegate_task` `target` payload, including provider-native option keys (`effort`, `reasoningEffort`, `thought_level`), retry escalations, and family checks.

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

From the repository root:

```bash
npm ci --prefix cli
npm pack ./cli
npm install -g ./aayushbtw-orbit-*.tgz
```
