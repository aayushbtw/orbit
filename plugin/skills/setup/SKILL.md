---
name: setup
description: Choose which T3 Code providers fill orbit's panel seat on another family. Reads the providers T3 has enabled and writes a user-wide Models file that a project's AGENTS.md rows override. Use for /orbit:setup.
disable-model-invocation: true
---

# Setup orbit

Write `~/.claude/rules/orbit-models.md`, a user-wide Models table that sets which providers fill the `other-family` seat (`../../rules.md` Workflow Defaults, Models). Claude Code loads every `.md` file in `~/.claude/rules/` into each new session. A lead on another provider reads the file through the `rules` skill. A cell in a project's AGENTS.md Models table wins over the same cell in this file.

## Steps

### 1. Detect providers

Read `../../docs/harness/t3-code.md`, sections Probe and Seats on another family. A lead that is not Claude Code also reads Lead on another provider. Probe `orchestrator_capabilities` as Probe says. If it is absent, tell the user that setup needs T3 Code, and stop.

Call `orchestrator_capabilities`. The session's family is the `driverKind` of the provider whose `providerInstanceId` equals `inheritedProviderInstanceId`. A provider whose `constraints` hold "Provider instance is disabled." is disabled. Never write a provider or model you have not seen in a result.

### 2. Load current state

If `~/.claude/rules/orbit-models.md` exists, read it. Its `other-family` row is the current choice. Keep every other row as it is.

### 3. Show the providers and ask

Show every provider in `providers`, in listed order, with its `providerInstanceId` and `driverKind`:

- An enabled provider, with the `id` of each model it lists.
- A disabled provider, marked disabled.
- The session's family, marked as the session's.

Then ask one question: which providers, in order, fill the `other-family` seat. Offer each enabled provider with `canRunCrossProviderChildTask` true. The recommended answer is all of them, in listed order. Name the current choice when step 2 found one. Use your host's question tool, else a numbered question with the recommended option first.

The answer is an ordered list. A seat tries only values from a family other than the parent's, in list order, so the session's own family may stay on the list for a thread that another family leads. An entry is a bare `<providerInstanceId>`, which takes that provider's first eligible model, or `<providerInstanceId>/<model>` when the user names a model. Ask nothing about the lead or about other roles.

### 4. Validate

Every entry's provider is in `providers`, enabled, with `canRunCrossProviderChildTask` true. For a `<providerInstanceId>/<model>` entry, that provider lists the model. The first result is a short list, so before you call a model missing, call `orchestrator_capabilities` with `search` set to the model id. If an entry fails, name the check that failed and ask again.

### 5. Show the file and confirm

Show the whole new file. Shape:

```
Orbit's user-wide Models table, written by /orbit:setup. A cell in a project's AGENTS.md Models table wins over the same cell here.

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| other-family | Panel seat on another family under T3 Code | <entry>, <entry> | |
```

No frontmatter. The Model cell holds the entries in order, separated by `, `. The Effort cell stays empty unless the user named an effort. The rows step 2 kept follow the `other-family` row. Ask for a yes. Write nothing without it.

### 6. Write the file

Overwrite the whole of `~/.claude/rules/orbit-models.md`, so a re-run stays idempotent. Create `~/.claude/rules/` when it is missing. Write the rows only to this file, never to a project's `CLAUDE.md` or `AGENTS.md`.

### 7. Check what the chosen providers load

Run this step for each provider whose `driverKind` is `grok`, the one non-Claude host orbit has tested, when the user put it on the list or it is the session's family. For any other `driverKind`, say "orbit has no tested load check for <driverKind> yet" and go on. If the `grok` command is not found, say so and go on.

- Shadowing install. Run `grok plugin list --json`. If it lists `orbit`, tell the user that Grok's own install shadows Claude Code's copy, so `claude plugin update orbit@orbit` no longer reaches Grok. Print `grok plugin uninstall orbit` as a command for the user to run. Do not run it.
- Stale copy. With no shadowing install, run `grok inspect --json`. If it has no skill named `rules` whose `source.plugin_name` is `orbit`, Grok loads a copy of orbit older than the `rules` skill. Offer to run `claude plugin update orbit@orbit`, and run it only after a yes. If it lists no plugin named `orbit` at all, tell the user that Grok loads orbit only when orbit is enabled in Claude Code's user settings.

### 8. Offer the always-on rules line

Ask whether to add orbit's always-on rules line to a non-Claude provider's own instruction file, such as `~/.grok/AGENTS.md`. The default is no. Write the line only after a yes, and only once per file. The line is:

```
If Non-negotiables is not in your context, load the orbit `rules` skill before your first reply.
```

### 9. Confirm

Show the written file. Tell the user that a new session picks it up, and that re-running `/orbit:setup` updates it.
