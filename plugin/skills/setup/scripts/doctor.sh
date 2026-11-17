#!/usr/bin/env bash
set -u

plugin_root=$(cd "$(dirname "$0")/../../.." && pwd -P)
os=$(uname -s)

install_hint() {
	if [ "$os" = Darwin ]; then
		case "$1" in
		git) echo "xcode-select --install" ;;
		bun) echo "brew install oven-sh/bun/bun" ;;
		*) echo "brew install $1" ;;
		esac
		return
	fi
	case "$1" in
	git) echo "https://git-scm.com/downloads" ;;
	gh) echo "https://cli.github.com" ;;
	node) echo "https://nodejs.org/en/download" ;;
	bun) echo "curl -fsSL https://bun.sh/install | bash" ;;
	jq) echo "https://jqlang.org/download" ;;
	esac
}

for tool in git gh node bun jq; do
	if command -v "$tool" >/dev/null 2>&1; then
		version=$("$tool" --version 2>/dev/null | head -n 1 | grep -oE '[0-9]+(\.[0-9]+)+' | head -n 1)
		echo "ok $tool ${version:-version unknown}"
	else
		echo "$tool missing. Install: $(install_hint "$tool")"
	fi
done

# gh auth status calls the GitHub API; gh auth token only reads local config.
if command -v gh >/dev/null 2>&1; then
	if gh auth token >/dev/null 2>&1; then
		echo "ok gh logged in"
	else
		echo "gh not logged in. Run: gh auth login"
	fi
fi

if command -v git >/dev/null 2>&1 && root=$(git rev-parse --show-toplevel 2>/dev/null); then
	echo "ok git repo $root"
	if git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
		echo "ok origin/main"
	elif git remote get-url origin >/dev/null 2>&1; then
		echo "origin/main missing. The Worktree gate branches from origin/main. Run: git fetch origin"
	else
		echo "origin/main missing. The Worktree gate branches from origin/main. Add a remote: git remote add origin <url>, then git fetch origin"
	fi
	block=missing
	for f in AGENTS.md CLAUDE.md; do
		if [ -f "$root/$f" ] && grep -qE '^## Workflow[[:space:]]*$' "$root/$f"; then
			block="present ($f)"
			break
		fi
	done
	[ "$block" = missing ] && [ ! -f "$root/AGENTS.md" ] && block="missing (no AGENTS.md)"
	echo "workflow block: $block"
else
	echo "not in a git repo. The Worktree gate needs a git repo with origin/main."
fi

if command -v vpr >/dev/null 2>&1; then echo "vpr: found"; else echo "vpr: missing"; fi

json_field() {
	[ -f "$1" ] && jq -r --arg a "${3:-}" "($2) // empty" "$1" 2>/dev/null
}

real_dir() { (cd -P "$1" 2>/dev/null && pwd -P); }

target=""
if [ -z "${HOME:-}" ]; then
	echo "install: check skipped, HOME unset"
elif ! command -v jq >/dev/null 2>&1; then
	echo "install: check skipped, it needs jq"
else
	plugins="$HOME/.claude/plugins"
	key=$(json_field "$plugins/installed_plugins.json" '[.plugins // {} | keys[] | select(startswith("orbit@"))][0]')
	if [ -z "$key" ]; then
		echo "install: no orbit install record in $plugins/installed_plugins.json"
	else
		market=${key#orbit@}
		record='.plugins[$a] | if type == "array" then (map(select(.scope == "user"))[0] // .[0]) else . end'
		record_version=$(json_field "$plugins/installed_plugins.json" "$record | .version" "$key")
		install_path=$(json_field "$plugins/installed_plugins.json" "$record | .installPath" "$key")
		echo "install: $key record ${record_version:-unknown} at ${install_path:-unknown path}"
		location=$(json_field "$plugins/known_marketplaces.json" '.[$a].installLocation' "$market")
		plugin_source=$(json_field "$location/.claude-plugin/marketplace.json" '.plugins[] | select(.name == "orbit") | .source | strings')
		if [ -z "$location" ] || [ -z "$plugin_source" ]; then
			echo "install: cannot find the local marketplace copy for $market"
		else
			target=$(real_dir "$location/$plugin_source")
			copy_version=$(json_field "$target/.claude-plugin/plugin.json" '.version')
			echo "install: local marketplace copy ${copy_version:-unknown} at ${target:-$location/$plugin_source (missing)}"
			if [ -n "$target" ] && [ ! -f "$target/skills/rules/SKILL.md" ]; then
				echo "install: $target has no skills/rules/SKILL.md"
			fi
			if [ -n "$record_version" ] && [ "$record_version" = "$copy_version" ]; then
				echo "ok install record matches the local marketplace copy (upstream may be ahead)"
			else
				echo "install drift: record ${record_version:-unknown}, local marketplace copy ${copy_version:-unknown}. Update: claude plugin marketplace update $market, then claude plugin update $key"
			fi
		fi
	fi
fi

codex_home="${CODEX_HOME:-${HOME:+$HOME/.codex}}"
if command -v codex >/dev/null 2>&1 || { [ -n "$codex_home" ] && [ -d "$codex_home" ]; }; then
	echo "codex: found"
	link="$codex_home/skills/orbit"
	if [ -z "$target" ]; then
		echo "codex: link check skipped, no local marketplace copy to link to"
	elif [ -L "$link" ]; then
		if [ "$(real_dir "$link")" = "$target" ]; then
			echo "ok codex link $link -> $target"
		else
			echo "codex: $link links elsewhere ($(readlink "$link")), not to $target"
		fi
	elif [ -e "$link" ]; then
		echo "codex: $link is a real folder, not a link to $target"
	else
		echo "codex: link missing. Create: mkdir -p '$codex_home/skills' && ln -s '$target' '$link'"
	fi
	agents_link="${HOME:-}/.agents/skills/orbit"
	if [ -n "$target" ] && [ -e "$agents_link" ]; then
		if [ "$(real_dir "$agents_link")" = "$target" ]; then
			echo "codex: $agents_link resolves to the target"
		else
			echo "codex: $agents_link resolves to $(real_dir "$agents_link"), not the target, so Codex loads two copies"
		fi
	fi
fi

if command -v grok >/dev/null 2>&1; then
	echo "grok: found. Grok loads the record's installPath, so the record version is Grok's"
fi

if [ -d "$plugin_root/skills/playbook/scripts/node_modules/commander" ]; then
	echo "ok watch-pr deps installed"
else
	echo "watch-pr deps: not installed yet. The first watch-pr run installs them with bun and needs network"
fi

exit 0
