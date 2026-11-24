#!/usr/bin/env bash
set -u

os=$(uname -s)

install_hint() {
	case "$1" in
	orbit) echo "npm install -g @aayushbtw/orbit, then orbit setup" ;;
	git) [ "$os" = Darwin ] && echo "xcode-select --install" || echo "https://git-scm.com/downloads" ;;
	node) [ "$os" = Darwin ] && echo "brew install node" || echo "https://nodejs.org/en/download" ;;
	esac
}

for tool in git node orbit; do
	if command -v "$tool" >/dev/null 2>&1; then
		version=$("$tool" --version 2>/dev/null | head -n 1 | grep -oE '[0-9]+(\.[0-9]+)+' | head -n 1)
		echo "ok $tool ${version:-version unknown}"
	else
		echo "$tool missing. Install: $(install_hint "$tool")"
	fi
done

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

exit 0
