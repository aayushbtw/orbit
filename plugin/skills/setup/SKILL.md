---
name: setup
description: Check what orbit needs on this machine and in this project, on any host. Reports missing tools, the gh login, the git repo, the Workflow block, install drift and what Codex and Grok load. Under T3 Code it also chooses which providers fill orbit's panel seat on another family and writes a user-wide Models file that a project's AGENTS.md rows override. Use for /orbit:setup.
disable-model-invocation: true
---

# Setup orbit

Setup checks orbit's prerequisites on any host, so a missing tool shows up here and not mid-flow. Setup changes none of your files or settings without a yes. Host CLIs it calls (gh, grok, codex, vp shims) may write their own logs or caches. Setup collects each change it could make as an offer and asks about all of them in one question at the end. A headless run stops at its first question, so it still prints every finding.

Under T3 Code, setup also writes `~/.claude/rules/orbit-models.md`, a user-wide Models table that sets which providers fill the `other-family` seat (`../../rules.md` Workflow Defaults, Models). Claude Code loads every `.md` file in `~/.claude/rules/` into each new session. A lead on another provider reads the file through the `rules` skill. A cell in a project's AGENTS.md Models table wins over the same cell in this file.

| Step | Runs on | May change, after a yes in step 5 |
| --- | --- | --- |
| 1. Doctor | Any host | Nothing |
| 2. Install and host loads | Any host | Orbit's install, the Codex link, the always-on rules line |
| 3. Workflow block | Any host, in a git repo | The project's AGENTS.md |
| 4. T3 providers | T3 Code only | `~/.claude/rules/orbit-models.md` |
| 5. One question | Any host, when step 2, 3 or 4 made an offer | Nothing |
| 6. Apply and confirm | Any host | Only what the user said yes to |

## Steps

### 1. Doctor

Run `"${CLAUDE_SKILL_DIR}/scripts/doctor.sh"` as one Bash call from the project folder. A lead that is not Claude Code runs `scripts/doctor.sh` from this skill's base directory. The script writes no files, needs no network and always exits 0.

Relay its lines to the user nearly verbatim. Each missing tool comes with its install command. Keep going whatever is missing. The later steps use these lines:

- `install:` and `install drift:` lines, for step 2.
- `codex:` and `grok:` lines, for step 2.
- `ok git repo`, `not in a git repo`, `workflow block:` and `vpr:` lines, for step 3.

### 2. Install and host loads

**Install.** With `no orbit install record`, orbit runs from a folder Claude Code did not install, such as `--plugin-dir`. Say so and skip the drift and Codex link checks. Never link Codex to the folder orbit runs from. With `install drift`, the record and the local marketplace copy differ, so Claude Code children and Codex can run different versions. Offer `claude plugin marketplace update <marketplace>`, then `claude plugin update orbit@<marketplace>`. When the record matches, say it matches the local marketplace copy. Upstream may still be ahead. When the `claude` command is not found, print the update commands for the user instead of offering them.

**codex.** Codex does not read Claude Code's install record. It loads orbit through one symlink to the folder Claude Code installs orbit from, the target the doctor names as the local marketplace copy. Run this case when the doctor printed `codex: found`. If the target has no `skills/rules/SKILL.md`, say so and skip the rest of the codex case.

- Link. If it is missing, offer to create it with the command the doctor printed. If it is a link to the target, say that the link is in place. If it is a link to another folder or a real folder, report what it is and print the commands that replace it with a link to the target, for the user to run. Do not touch it.
- Duplicates. Codex skips a second link to a folder it already loads. If the doctor says `~/.agents/skills/orbit` resolves somewhere other than the target, or `codex plugin list` shows orbit installed, tell the user that Codex then loads two copies of orbit. Print the command that removes the extra copy, `rm ~/.agents/skills/orbit` or `codex plugin remove orbit@<codex marketplace>`, for the user to run. Do not run it.

**grok.** Run this case when the doctor printed `grok: found`. Grok loads the record's `installPath`, so the record's version is the one Grok runs.

- Shadowing install. Run `grok plugin list --json`. If it lists `orbit`, tell the user that Grok's own install shadows Claude Code's copy, so `claude plugin update orbit@orbit` no longer reaches Grok. Print `grok plugin uninstall orbit` as a command for the user to run. Do not run it.
- Not loaded. With no shadowing install, run `grok inspect --json`. If it lists no plugin named `orbit`, tell the user that Grok loads orbit only when orbit is enabled in Claude Code's user settings. Offer nothing for Grok.
- Stale copy. If it lists orbit but no skill named `rules` whose `source.plugin_name` is `orbit`, Grok loads a copy of orbit older than the `rules` skill. Offer to run `claude plugin update orbit@orbit`, once, alongside any update offer above.

**Always-on rules line.** When `codex` or `grok` is found, offer to add orbit's always-on rules line to that provider's own instruction file, `~/.codex/AGENTS.md` or `~/.grok/AGENTS.md`, when the file lacks it. The recommended answer is no. The line is:

```
If Non-negotiables is not in your context, load the orbit `rules` skill before your first reply.
```

### 3. Workflow block

Outside a git repo, print `Skipped: Workflow block. Not in a git repo.` and go on.

In a repo, the Check defaults to `vpr check` (`../../rules.md` Workflow Defaults). With `workflow block: present`, say so and go on. With `workflow block: missing` and `vpr: found`, say the defaults hold and go on. With the block missing and `vpr: missing`, every verify step would fail, so offer a block:

1. Read `workflow-block.md`, next to this file.
2. Find the project's Check command. Use the `check`, `test` or `build` scripts in the root `package.json`, run with the package manager its lockfile names, or the `check` or `test` target in a root `Makefile`. Read these files to find the command, and never run it. With none, the step 5 question asks the user for the command.
3. Propose a filled block with only the lines that differ from the defaults, such as ``- Check: `bun run check && bun test`.`` Never append the template as it is, with its placeholders.

The block goes at the end of the repo root's AGENTS.md. When the root has no AGENTS.md, the offer is to create it with the block alone. Never write the block to a project's `CLAUDE.md`.

### 4. T3 providers

Read `../../docs/harness/t3-code.md`, sections Probe and Seats on another family. A lead that is not Claude Code also reads Lead on another provider. Probe `orchestrator_capabilities` as Probe says. A call that errors because the tool needs an agent running inside T3 Code counts as absent. If it is absent, print `Skipped outside T3: provider seats. <reason>.` and go on to step 5.

**4a. Detect providers.** Call `orchestrator_capabilities`. The session's family is the `driverKind` of the provider whose `providerInstanceId` equals `inheritedProviderInstanceId`. A provider whose `constraints` hold "Provider instance is disabled." is disabled. Never write a provider or model you have not seen in a result.

**4b. Load current state.** If `~/.claude/rules/orbit-models.md` exists, read it. Its `other-family` row is the current choice. A trailing `inherit` in its `other-family` or `verifier` row is the user's earlier yes to a native fallback, so keep it unless the user's new answer drops it. Keep every other row and every line outside the table as it is.

**4c. Show the providers and ask.** Show every provider in `providers`, in listed order, with its `providerInstanceId` and `driverKind`:

- An enabled provider, with the `id` of each model it lists.
- A disabled provider, marked disabled.
- The session's family, marked as the session's.

Then ask two questions in one question call. This call is its own step, before step 5. Use your host's question tool, else numbered questions with the recommended option first. Name the current choice for each when 4b found one.

1. Which providers, in order, fill the `other-family` seat. Say in the question that the chosen providers also run the pre-land verifier. Say that they are fallbacks for one seat, not several reviewers, and that a seat tries at most three of them. Offer each enabled provider with `canRunCrossProviderChildTask` true and a non-empty `models` list. Rank those of five kinds as Claude (`claudeAgent`), Codex (`codex`), Muse (`muse`), Gemini (`gemini`), then Grok (`grok`), and within one kind by `providerInstanceId` in ascending order. For each enabled `driverKind` in `providers`, take the first three ranked providers outside that kind. The recommended answer is the union of those picks, in rank order, so every lead gets each entry that a seat would try. With all five kinds enabled, it is Claude, Codex, Muse and Gemini. Offer providers of other kinds too, but leave them out of the recommendation.
2. If no listed provider can run the pre-land verifier, may orbit run its native verifier? Recommend yes. A yes writes `other-family, inherit` in the `verifier` row. A no writes `other-family`, and a PR whose every listed verifier fails then waits for the user.

The answer to the first question is an ordered list. A seat tries only values from a family other than the parent's, in list order, so the session's own family may stay on the list for a thread that another family leads. An entry is a bare `<providerInstanceId>`, which takes that provider's first eligible model, or `<providerInstanceId>/<model>` when the user names a model. `inherit` may end the list, so a panel seat whose every entry fails runs on the session's family. Ask nothing about the lead or about other roles.

For each chosen provider whose `driverKind` is not `grok` or `codex`, the non-Claude hosts whose load orbit has tested, and whose `providerInstanceId` is not `inheritedProviderInstanceId`, say "orbit has no tested load check for <driverKind> yet".

**4d. Validate.** Every entry's provider is in `providers`, enabled, with `canRunCrossProviderChildTask` true. No two entries name the same provider. `inherit` is valid only as the last entry, and a trailing `inherit` from 4b stays. For a `<providerInstanceId>/<model>` entry, that provider lists the model. The first result is a short list, so before you call a model missing, call `orchestrator_capabilities` with `search` set to the model id. If an entry fails, name the check that failed and ask again.

A seat tries at most three candidates, and it counts them after its own checks, such as the runtime mode and the family check. For each enabled `driverKind` in `providers`, find the first three entries outside it. An entry that falls after the third under every such lead kind runs only when an earlier entry fails a seat's checks. Name each such entry with that condition, and accept the list. Do not ask again for that reason.

**4e. Show the file.** Show the whole new file. A new file has this shape:

```
Orbit's user-wide Models table, written by /orbit:setup. A cell in a project's AGENTS.md Models table wins over the same cell here.

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| other-family | Panel seat on another family under T3 Code | <entry>, <entry> | |
| verifier | Pre-land verifier on another family under T3 Code | other-family, inherit | |
```

After a no to the second question, the `verifier` row reads:

```
| verifier | Pre-land verifier on another family under T3 Code | other-family | |
```

No frontmatter. The Model cell holds the entries in order, separated by `, `. The Effort cell stays empty unless the user named an effort. When 4b found no `verifier` row, write one only when the list is not empty. When 4b found a `verifier` row whose Model is `other-family` or `other-family, inherit`, set its Model from the second answer. Keep any other `verifier` row as it is. The rows 4b kept follow the `other-family` row, verbatim.

An existing file keeps every line outside its Models table, such as the header line and the user's notes, byte for byte. Only the table changes. A file with no table gets the table after its last line. When the new file is byte-identical to the current one, say the file is current and make no offer. Otherwise the write is an offer for step 5.

### 5. One question

When steps 2 to 4 made no offer, ask nothing and go to step 6. Otherwise ask one multi-select question that lists every offer:

- Update orbit's install.
- Create the Codex link.
- Add the Workflow block, with its target file, or the Check command it still needs.
- Add the always-on rules line, per file.
- Write `~/.claude/rules/orbit-models.md`.

Recommend each offer except the rules line, and preselect nothing beyond the recommendation. Use your host's question tool, else a numbered list the user answers with numbers. Change nothing without a yes.

### 6. Apply and confirm

Apply only what the user said yes to:

- Update. Run `claude plugin marketplace update <marketplace>`, then `claude plugin update orbit@<marketplace>`.
- Codex link. Run the doctor's `mkdir -p` and `ln -s` command.
- Workflow block. Append it to the repo root's AGENTS.md, or create AGENTS.md with it. Never write a project's `CLAUDE.md`.
- Rules line. Add it to each chosen file, once per file.
- Models file. Create `~/.claude/rules/` when it is missing and write the file 4e showed. Write the rows only to this file, never to a project's `CLAUDE.md` or `AGENTS.md`.

Then tell the user what changed and what still needs them: each missing tool with its install command, `gh auth login` when gh is not logged in, a missing `origin/main`, and every command setup printed for them to run. When the Models file changed, say that a new session picks it up, and that re-running `/orbit:setup` updates it.
