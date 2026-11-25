---
name: setup
description: Check what orbit needs on this machine and in this project under T3 Code, through the orbit CLI. Reports missing tools, the orbit install and its host registrations, the git repo and the Workflow block. It also chooses which providers fill orbit's panel seat on another family and writes them to ~/.config/orbit/config.json, where a project's .orbit/config.json and AGENTS.md rows override them. Use for /orbit:setup.
disable-model-invocation: true
---

# Setup orbit

Setup checks orbit's prerequisites, so a missing tool shows up here and not mid-flow. It changes none of your files or settings without a yes. The `orbit` CLI does every write: `orbit setup` installs the bundle at `~/.config/orbit/current` and registers it with T3's providers, `orbit hosts sync` repairs those registrations, `orbit models set` writes Models rows to `~/.config/orbit/config.json`, and `orbit init` writes a project's Workflow block. Setup collects each change it could make as an offer and asks about all of them in one question at the end. A headless run stops at its first question, so it still prints every finding.

| Step | May change, after a yes in step 6 |
| --- | --- |
| 1. Doctor | Nothing |
| 2. Install and hosts | Orbit's install and its host registrations |
| 3. Workflow block | The project's AGENTS.md |
| 4. T3 providers | `~/.config/orbit/config.json` |
| 5. One question | Nothing |
| 6. Apply and confirm | Only what the user said yes to |

## Steps

### 1. Doctor

Run `scripts/doctor.sh`, from this skill's directory, as one Bash call from the project folder. The script writes no files, needs no network and always exits 0. With `ok orbit` in its output, also run `orbit doctor --json`, which writes nothing without `--fix`.

Relay the findings to the user nearly verbatim. Each missing tool comes with its install command. Keep going whatever is missing. The later steps use these findings:

- `orbit missing`, and from `orbit doctor --json` the fields `installed`, `activeVersion`, `version`, `hosts` and `issues`, for step 2.
- `ok git repo`, `not in a git repo`, `workflow block:` and `vpr:` lines, for step 3.
- `ok trunk origin/<branch>`, `origin/<branch> missing` or `trunk unknown`, for step 6. The doctor resolves trunk without the network, from a `Trunk:` line in the Workflow block, else `origin/HEAD`, else an existing `origin/main`, so a repo whose default branch is `trunk` passes once `origin/HEAD` is set.
- `models` and `catalogSynced` from `orbit doctor --json`, for step 4.

### 2. Install and hosts

With `orbit missing`, offer `npm install -g @aayushbtw/orbit`, then `orbit setup --yes`. Skip the rest of this step.

From `orbit doctor --json`:

- `installed: false`, or an `activeVersion` that differs from `version` while `linked` is false. Offer `orbit setup --yes`.
- A host whose `status` is `stale` or `unregistered` while `detected` is true. Offer `orbit hosts sync`.
- A host whose `status` is `invalid`. Report its `detail` and make no offer. Tell the user to fix that file by hand, so setup never overwrites it.
- Any other entry in `issues`. Report it.

When everything is current, say so and make no offer.

### 3. Workflow block

Outside a git repo, print `Skipped: Workflow block. Not in a git repo.` and go on.

In a repo, the Check defaults to `vpr check` (`../../rules.md` Workflow Defaults). With `workflow block: present`, say so and go on. With `workflow block: missing` and `vpr: found`, say the defaults hold and go on. With the block missing and `vpr: missing`, every verify step would fail, so offer a block:

1. Read `workflow-block.md`, next to this file.
2. Find the project's Check command. Use the `check`, `test` or `build` scripts in the root `package.json`, run with the package manager its lockfile names, or the `check` or `test` target in a root `Makefile`. Read these files to find the command, and never run it. With none, the step 5 question asks the user for the command.
3. Propose `orbit init --check "<command>" --land <pr|main> --yes`, which appends a Workflow block with only those lines to the repo root's AGENTS.md, or creates AGENTS.md with it. Never write the block to a project's `CLAUDE.md`.

### 4. T3 providers

Read `../../docs/harness/t3-code.md`, sections Probe and Models, and `../../docs/harness/t3-seats.md`. Probe `orchestrator_capabilities` as Probe says. If it is absent, print `Skipped: provider seats. orchestrator_capabilities unavailable.` and go on to step 5.

**4a. Detect providers.** Call `orchestrator_capabilities`. The session's family is the `driverKind` of the provider whose `providerInstanceId` equals `inheritedProviderInstanceId`. A provider whose `constraints` hold "Provider instance is disabled." is disabled. Never write a provider or model you have not seen in a result. When `catalogSynced` was false, the step 6 apply also runs `orbit models sync`.

**4b. Load current state.** Run `orbit models list --json`, or read the active profile of `~/.config/orbit/config.json` without `orbit`. Its `other-family` and `verifier` rows are the current state, and every other row stays as it is. The `other-family` row is the current answer to the first question in 4c, and a trailing `inherit` there stays unless the user's new answer drops it. A `verifier` Model of `other-family, inherit` is the user's earlier yes to a native verifier. A Model of `other-family` is not an earlier no, because setup before 0.60.0 wrote that row without asking the second question. Name it as `current: no native fallback`, treat the question as unanswered, and keep the recommendation.

**4c. Show the providers and ask.** Show every provider in `providers`, in listed order, with its `providerInstanceId` and `driverKind`:

- An enabled provider, with the `id` of each model it lists.
- A disabled provider, marked disabled.
- The session's family, marked as the session's.

Then ask two questions in one question call. This call is its own step, before step 5. Use your host's question tool, else numbered questions with the recommended option first. Name the current choice for each when 4b found one.

1. Which providers, in order, fill the `other-family` seat. Say in the question that the chosen providers also run the pre-land verifier. Say that they are fallbacks for one seat, not several reviewers, and that a seat tries at most three of them. Offer each enabled provider outside the session's family with `canRunCrossProviderChildTask` true and a non-empty `models` list. Rank those of four kinds as Codex (`codex`), Muse (`muse`), Gemini (`gemini`), then Grok (`grok`), and within one kind by `providerInstanceId` in ascending order. The recommended answer is the first three ranked providers. With all four kinds enabled, it is Codex, Muse and Gemini. Offer providers of other kinds too, but leave them out of the recommendation.
2. If no listed provider can run the pre-land verifier, may orbit run its native verifier? Recommend no, because T3 says never to fall back to native tools unasked. Say in the question that with no, a PR whose listed verifiers all fail holds and the lead asks you. Say that with yes, the native verifier runs in their place without asking. A no writes `other-family` as the `verifier` Model, and a yes writes `other-family, inherit`. Only this answer lets a native verifier run in place of a failed seat. Where no seat fills the verifier, the native verifier runs whatever the answer, such as in a subagent like an autopilot owner (`../playbook/playbooks/shipping.md` step 1). A trailing `inherit` on the first answer's list covers panel seats, not the verifier.

The answer to the first question is an ordered list. A seat tries only entries from a family other than the parent's, in list order. An entry is a bare `<providerInstanceId>`, which takes that provider's first eligible model, or `<providerInstanceId>/<model>` when the user names a model. `inherit` may end the list, so a panel seat whose every entry fails runs on the session's family. Ask nothing about the lead or about other roles.

**4d. Validate.** Every entry's provider is in `providers`, enabled, with `canRunCrossProviderChildTask` true and a non-empty `models` list. No two entries name the same provider. `inherit` is valid only as the last entry, and a trailing `inherit` from 4b stays. For a `<providerInstanceId>/<model>` entry, that provider lists the model. The first result is a short list, so before you call a model missing, call `orchestrator_capabilities` with `search` set to the model id. If an entry fails, name the check that failed and ask again.

A seat tries at most three candidates, and it counts them after its own checks, such as the runtime mode and the family check. An entry after the third entry outside the session's family runs only when an earlier entry fails a seat's checks. Name each such entry with that condition, and accept the list. Do not ask again for that reason.

**4e. Show the commands.**

```
orbit models set other-family "<entry>, <entry>"
orbit models set verifier "other-family"
```

After a yes to the second question, the `verifier` command sets `"other-family, inherit"`. When 4b found no `verifier` row, write one only when the list is not empty. When 4b found a `verifier` row whose Model is `other-family` or `other-family, inherit`, set its Model from the second answer. Keep any other `verifier` row as it is. Without `orbit` on PATH, show the edit to the active profile of `~/.config/orbit/config.json` instead: `panels.other-family` holds the entries as a list, and `tasks.verifier.target` holds the `verifier` Model. When the rows already match, say the store is current and make no offer.

### 5. One question

When steps 2 to 4 made no offer, ask nothing and go to step 6. Otherwise ask one multi-select question that lists every offer:

- Install the orbit CLI, or update orbit's install.
- Sync orbit's host registrations.
- Add the Workflow block, with its target file, or the Check command it still needs.
- Write the user-wide Models rows.

Recommend each offer, and preselect nothing beyond the recommendation. Use your host's question tool, else a numbered list the user answers with numbers. Change nothing without a yes.

### 6. Apply and confirm

Apply only what the user said yes to, one command per Bash call:

- Install. `npm install -g @aayushbtw/orbit`, then `orbit setup --yes`, or `orbit setup --yes` alone for an update.
- Hosts. `orbit hosts sync`.
- Workflow block. The `orbit init` command step 3 proposed. Never write a project's `CLAUDE.md`.
- Models rows. `orbit models sync` when 4a called for it, then the `orbit models set` commands 4e showed, or the edit it showed to `~/.config/orbit/config.json`. Write the rows only to the user-wide store, never to a project's `CLAUDE.md` or `AGENTS.md`.

Then run `orbit doctor --json` again and tell the user what changed and what still needs them: each missing tool with its install command, a missing or unknown trunk with the doctor's command, an invalid host file, and every command setup printed for them to run. When the install, hosts or Models rows changed, say that a new T3 thread picks them up, and that re-running `/orbit:setup` updates them.
