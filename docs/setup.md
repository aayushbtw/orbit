# Set up orbit

These steps are for an agent. Follow them to install orbit for each provider in the user's T3 Code, then prove that each provider loads it.

1. Call T3's `orchestrator_capabilities` tool. Claude Code lists it as `mcp__t3-code__orchestrator_capabilities`. Grok finds it as `t3-code__orchestrator_capabilities` through its tool search. If no T3 tool exists, you are not in T3. In the steps below, use only the row for your own host.
2. For each provider in `providers`, find its row in the table by `driverKind`.
	- A provider whose `constraints` hold "Provider instance is disabled." is disabled. List it with its row, and do not install for it.
	- When a provider's Check already passes, orbit is installed there. Offer its Update instead of its Install.
	- For a `driverKind` with no row, report "orbit has no tested setup for <displayName> yet" and skip it. Never guess a command.
3. Show the user one list of every provider in `providers`, each with its state: enabled with its Install or Update, disabled, or no tested setup. Then, before you run any Install or Update command, ask for a yes. An Install enables orbit's hooks, and `--trust` trusts the plugin. Use your host's question tool, else a numbered question. Run nothing without a yes.
4. Run the Install for each enabled provider, in table order.
5. Ask the user whether to add orbit's always-on rules line to a non-Claude provider's instruction file, such as `~/.grok/AGENTS.md`. The default is no. Write the line only after a yes. The line is:

	```
	If Non-negotiables is not in your context, load the orbit `rules` skill before your first reply.
	```

6. Run each provider's Check. Report a table with the columns provider, installed version, and check result. Tell the user that a new session, or a plugin reload, picks up orbit.

| `driverKind` | Install | Update | Check |
| --- | --- | --- | --- |
| `claudeAgent` | `claude plugin marketplace add aayushbtw/orbit`, then `claude plugin install orbit@orbit` | `claude plugin update orbit@orbit` | `claude plugin list --json` has `orbit@orbit` with `enabled: true`. The version is its `folderVersion` when present, else its `version`. |
| `grok` | None when Claude Code has orbit enabled, because Grok then loads Claude Code's copy. Otherwise `grok plugin install aayushbtw/orbit#plugin --trust`. | The update command of the install Grok uses: Claude Code's, or `grok plugin update orbit` | `grok inspect --json` lists exactly one plugin named `orbit` with `enabled: true`, and a skill named `rules` whose `source.plugin_name` is `orbit`. The version is in `grok plugin list --json`, else Claude Code's `version`, not its `folderVersion`, because Grok loads the copy at `installPath`. |

Install orbit for Grok only one way. Both installs never load orbit twice, but Grok's own copy then wins, so `claude plugin update orbit@orbit` no longer reaches Grok. If `grok plugin list --json` already lists orbit, keep that install and update it with `grok plugin update orbit`.
