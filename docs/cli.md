# Orbit CLI

The standalone CLI installs Orbit for an Antigravity lead in T3 Code. T3 handles sign-in, providers, the lead model, and delegated work. Claude Code users can keep the [marketplace install](../README.md#install) and use the same model configuration commands.

## Install and configure

Install `@aayushbtw/orbit` using npm with Node.js 22.12 or later. Run `orbit setup` to review the install path and register Orbit's skills with Antigravity. Use `orbit setup --host antigravity --yes --json` for a scripted install. After upgrading the npm package, run setup again to register the new, versioned bundle. Open the Orbit start skill in a new T3 session.

`orbit models` opens a picker for roles and work types. It offers built-in aliases, model IDs already in your preferences, and manual entry for any `providerInstanceId/model` target. If you have a saved T3 capabilities response, pass it with `orbit models --catalog <file>` to search the models in its `providers` array. T3 validates availability when Orbit delegates inside a session.

Use explicit arguments in scripts:

```bash
orbit models set code claudeAgent/claude-opus-5-5 --effort medium
orbit models set advisor claudeAgent/claude-fable-5-2
orbit models set writing antigravity/gemini-4-neon
orbit models explain --json
orbit doctor
```

Orbit stores user defaults in `~/.config/orbit/models.md`. The first save imports the previous `~/.claude/rules/orbit-models.md` if it exists. Project `AGENTS.md` Models cells override user defaults individually. `orbit models explain` shows the effective cells and their sources. `orbit doctor --json` also reports the installed bundle and its host registration.

## Build from source

From the repository root:

```bash
npm ci --prefix cli
npm pack ./cli
npm install -g ./aayushbtw-orbit-*.tgz
```

The package builds the executable entry point with Vite+ and packs the same Orbit skills, rules, and agents as the marketplace plugin.
