---
name: setup
description: Check what orbit needs on this machine and in this project, on any host. Reports missing tools, the gh login, the git repo, the Workflow block and install drift. Under T3 Code it also chooses which providers fill orbit's panel seat on another family and writes a user-wide Models file that a project's AGENTS.md rows override. When Antigravity is detected or enabled, it also registers orbit's skills in ~/.gemini/config/skills.json. Use for /orbit:setup.
disable-model-invocation: true
---

# Setup orbit

Setup checks orbit's prerequisites on any host, so a missing tool shows up here and not mid-flow. Setup changes none of your files or settings without a yes. Host CLIs it calls (gh, claude, vp shims) may write their own logs or caches. Setup collects each change it could make as an offer and asks about all of them in one question at the end. A headless run stops at its first question, so it still prints every finding.

Under T3 Code, setup also writes the user-wide Models table at `~/.config/orbit/models.md` to configure the `other-family` seat (`../../rules.md` Workflow Defaults, Models). A cell in a project's AGENTS.md Models table wins over the same cell in this file.

| Step | Runs on | May change, after a yes in step 6 |
| --- | --- | --- |
| 1. Doctor | Any host | Nothing |
| 2. Install | Any host | Orbit's install |
| 3. Workflow block | Any host, in a git repo | The project's AGENTS.md |
| 4. T3 providers | T3 Code only | `~/.config/orbit/models.md` |
| 5. Antigravity skills | Any host, when Antigravity is detected or enabled in T3 | `~/.gemini/config/skills.json` |
| 6. One question | Any host, when steps 2 to 5 made an offer | Nothing |
| 7. Apply and confirm | Any host | Only what the user said yes to |

## Steps

### 1. Doctor

Run `"${CLAUDE_SKILL_DIR}/scripts/doctor.sh"` as one Bash call from the project folder. The script writes no files, needs no network and always exits 0.

Relay its lines to the user nearly verbatim. Each missing tool comes with its install command. Keep going whatever is missing. The later steps use these lines:

- `install:` and `install drift:` lines, for step 2.
- `ok git repo`, `not in a git repo`, `workflow block:` and `vpr:` lines, for step 3.
- `orbit skills dir:` and `antigravity skills:` lines, for step 5.

### 2. Install

With `no orbit install record`, orbit runs from a folder Claude Code did not install, such as `--plugin-dir`. Say so and skip the drift check. With `install drift`, the record and the local marketplace copy differ. Offer `claude plugin marketplace update <marketplace>`, then `claude plugin update orbit@<marketplace>`. When the record matches, say it matches the local marketplace copy. Upstream may still be ahead. When the `claude` command is not found, print the update commands for the user instead of offering them.

### 3. Workflow block

Outside a git repo, print `Skipped: Workflow block. Not in a git repo.` and go on.

In a repo, the Check defaults to `vpr check` (`../../rules.md` Workflow Defaults). With `workflow block: present`, say so and go on. With `workflow block: missing` and `vpr: found`, say the defaults hold and go on. With the block missing and `vpr: missing`, every verify step would fail, so offer a block:

1. Read `workflow-block.md`, next to this file.
2. Find the project's Check command. Use the `check`, `test` or `build` scripts in the root `package.json`, run with the package manager its lockfile names, or the `check` or `test` target in a root `Makefile`. Read these files to find the command, and never run it. With none, the step 6 question asks the user for the command.
3. Propose a filled block with only the lines that differ from the defaults, such as ``- Check: `bun run check && bun test`.`` Never append the template as it is, with its placeholders.

The block goes at the end of the repo root's AGENTS.md. When the root has no AGENTS.md, the offer is to create it with the block alone. Never write the block to a project's `CLAUDE.md`.

### 4. T3 providers

Read `../../docs/harness/t3-code.md`, sections Probe and Models, and `../../docs/harness/t3-seats.md`. Probe `orchestrator_capabilities` as Probe says. A call that errors because the tool needs an agent running inside T3 Code counts as absent. If it is absent, print `Skipped outside T3: provider seats. <reason>.` and go on to step 5.

**4a. Detect providers.** Call `orchestrator_capabilities`. The session's family is the `driverKind` of the provider whose `providerInstanceId` equals `inheritedProviderInstanceId`. A provider whose `constraints` hold "Provider instance is disabled." is disabled. Never write a provider or model you have not seen in a result.

**4b. Load current state.** Read `~/.config/orbit/models.md` if it exists. If it is absent and `~/.claude/rules/orbit-models.md` exists, use that legacy file as the starting text for the new file. Its `other-family` row is the current answer to the first question in 4c, and a trailing `inherit` there stays unless the user's new answer drops it. Its `verifier` row is the current state for the second question. A Model of `other-family, inherit` is the user's earlier yes to a native verifier. A Model of `other-family` is not an earlier no, because setup before 0.60.0 wrote that row without asking the second question. Name it as `current: no native fallback`, treat the question as unanswered, and keep the recommendation. Keep every other row and every line outside the table as it is.

**4c. Show the providers and ask.** Show every provider in `providers`, in listed order, with its `providerInstanceId` and `driverKind`:

- An enabled provider, with the `id` of each model it lists.
- A disabled provider, marked disabled.
- The session's family, marked as the session's.

Then ask two questions in one question call. This call is its own step, before step 6. Use your host's question tool, else numbered questions with the recommended option first. Name the current choice for each when 4b found one.

1. Which providers, in order, fill the `other-family` seat. Say in the question that the chosen providers also run the pre-land verifier. Say that they are fallbacks for one seat, not several reviewers, and that a seat tries at most three of them. Offer each enabled provider outside the session's family with `canRunCrossProviderChildTask` true and a non-empty `models` list. Rank those of four kinds as Codex (`codex`), Muse (`muse`), Gemini (`gemini`), then Grok (`grok`), and within one kind by `providerInstanceId` in ascending order. The recommended answer is the first three ranked providers. With all four kinds enabled, it is Codex, Muse and Gemini. Offer providers of other kinds too, but leave them out of the recommendation.
2. If no listed provider can run the pre-land verifier, may orbit run its native verifier? Recommend no, because T3 says never to fall back to native tools unasked. Say in the question that with no, a PR whose listed verifiers all fail holds and the lead asks you. Say that with yes, the native verifier runs in their place without asking. A no writes `other-family` in the `verifier` row, and a yes writes `other-family, inherit`. Only this answer lets a native verifier run in place of a failed seat. Where no seat fills the verifier, the native verifier runs whatever the answer, such as when T3's tools are absent or in a subagent like an autopilot owner (`../playbook/playbooks/shipping.md` step 1). A trailing `inherit` on the first answer's list covers panel seats, not the verifier.

The answer to the first question is an ordered list. A seat tries only entries from a family other than the parent's, in list order. An entry is a bare `<providerInstanceId>`, which takes that provider's first eligible model, or `<providerInstanceId>/<model>` when the user names a model. `inherit` may end the list, so a panel seat whose every entry fails runs on the session's family. Ask nothing about the lead or about other roles.

**4d. Validate.** Every entry's provider is in `providers`, enabled, with `canRunCrossProviderChildTask` true and a non-empty `models` list. No two entries name the same provider. `inherit` is valid only as the last entry, and a trailing `inherit` from 4b stays. For a `<providerInstanceId>/<model>` entry, that provider lists the model. The first result is a short list, so before you call a model missing, call `orchestrator_capabilities` with `search` set to the model id. If an entry fails, name the check that failed and ask again.

A seat tries at most three candidates, and it counts them after its own checks, such as the runtime mode and the family check. An entry after the third entry outside the session's family runs only when an earlier entry fails a seat's checks. Name each such entry with that condition, and accept the list. Do not ask again for that reason.

**4e. Show the file.** Show the whole new file. A new file has this shape:

```
Orbit's user-wide Models table, written by /orbit:setup. A cell in a project's AGENTS.md Models table wins over the same cell here.

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| other-family | Panel seat on another family under T3 Code | <entry>, <entry> | |
| verifier | Pre-land verifier on another family under T3 Code | other-family | |
```

After a yes to the second question, the `verifier` row reads:

```
| verifier | Pre-land verifier on another family under T3 Code | other-family, inherit | |
```

No frontmatter. The Model cell holds the entries in order, separated by `, `. The Effort cell stays empty unless the user named an effort. When 4b found no `verifier` row, write one only when the list is not empty. When 4b found a `verifier` row whose Model is `other-family` or `other-family, inherit`, set its Model from the second answer. Keep any other `verifier` row as it is. The rows 4b kept follow the `other-family` row, verbatim.

An existing file keeps every line outside its Models table, such as the header line and the user's notes, byte for byte. Only the table changes. A file with no table gets the table after its last line. When the new file is byte-identical to the file already at `~/.config/orbit/models.md`, say the file is current and make no offer. Otherwise the write is an offer for step 6.

### 5. Antigravity skills

If `orbit doctor --json` is available and reports a registered CLI-managed bundle, use its registration result and skip this step. The CLI updates its bundle through `orbit setup`.

Use the `orbit skills dir:` and `antigravity skills:` lines from step 1. When step 4 ran, also check its `orchestrator_capabilities` result for an enabled provider whose `providerInstanceId` or `driverKind` is `antigravity`. Take `<skills_dir>` from the `orbit skills dir:` line.

Handle the `antigravity skills:` status from step 1 as follows:

- `not detected`, and step 4 found no enabled `antigravity` provider. Print `Skipped: Antigravity skills. Not detected.` and go on to step 6.
- `check skipped` or `check failed`. Report the reason and make no offer.
- `registered`. Say orbit's skills are registered in `~/.gemini/config/skills.json` and make no offer. When step 1 reported `filtered`, say the entry is filtered.
- `invalid`. Report the reason from step 1 and make no offer. Tell the user to fix `~/.gemini/config/skills.json` by hand so setup never overwrites it.
- `not registered` or `stale`, or `not detected` when step 4 found an enabled `antigravity` provider. If step 1 reported `node missing`, print `node "${CLAUDE_SKILL_DIR}/scripts/antigravity-skills.mjs" --apply --skills-dir "<skills_dir>"` for the user to run after installing `node` instead of offering it. Otherwise make an offer for step 6 to register `<skills_dir>` in `~/.gemini/config/skills.json`, or to update stale orbit paths to `<skills_dir>` when step 1 reported `stale`. Tell the user that existing `inherits` and non-orbit entries stay untouched.

### 6. One question

When steps 2 to 5 made no offer, ask nothing and go to step 7. Otherwise ask one multi-select question that lists every offer:

- Update orbit's install.
- Add the Workflow block, with its target file, or the Check command it still needs.
- Write `~/.config/orbit/models.md`.
- Register orbit's skills in `~/.gemini/config/skills.json` (pointing at `<skills_dir>`).

Recommend each offer, and preselect nothing beyond the recommendation. Use your host's question tool, else a numbered list the user answers with numbers. Change nothing without a yes.

### 7. Apply and confirm

Apply only what the user said yes to:

- Update. Run `claude plugin marketplace update <marketplace>`, then `claude plugin update orbit@<marketplace>`.
- Workflow block. Append it to the repo root's AGENTS.md, or create AGENTS.md with it. Never write a project's `CLAUDE.md`.
- Models file. Create `~/.config/orbit/` when it is missing and write the file 4e showed. Write the rows only to this file, never to a project's `CLAUDE.md` or `AGENTS.md`.
- Antigravity skills. Run `node "${CLAUDE_SKILL_DIR}/scripts/antigravity-skills.mjs" --apply --skills-dir "<skills_dir>"`.

Then tell the user what changed and what still needs them: each missing tool with its install command, `gh auth login` when gh is not logged in, a missing `origin/main`, an invalid `~/.gemini/config/skills.json`, and every command setup printed for them to run. When the Models file changed, say that a new session picks it up, and that re-running `/orbit:setup` updates it. When `~/.gemini/config/skills.json` changed, say that a new Antigravity session picks up orbit's skills, and that re-running `/orbit:setup` updates it.
