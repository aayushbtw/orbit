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
	trunk=$(awk '
		FNR == 1 { w = 0 }
		/^## Workflow([[:space:]]|$)/ { w = 1; next }
		/^## / { w = 0 }
		w && /^- Trunk: / {
			s = $0
			sub(/^- Trunk: `?/, "", s)
			sub(/[`[:space:]].*$/, "", s)
			sub(/\.$/, "", s)
			if (s != "") { print s; exit }
		}
	' "$root/AGENTS.md" "$root/CLAUDE.md" 2>/dev/null)
	[ -n "$trunk" ] || trunk=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
		[ -n "$trunk" ] || trunk=$(git ls-remote --symref origin HEAD 2>/dev/null | sed -nE 's|^ref: refs/heads/([^[:space:]]+)[[:space:]]+HEAD$|\1|p')
	if [ -n "$trunk" ] && git rev-parse --verify --quiet "refs/remotes/origin/$trunk" >/dev/null; then
		echo "ok trunk origin/$trunk"
	elif [ -n "$trunk" ]; then
		echo "origin/$trunk missing. The Worktree gate branches from origin/$trunk. Run: git fetch origin"
	elif git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
		echo "ok trunk origin/main (origin/HEAD is unset, so main is assumed. If the default branch differs, run: git remote set-head origin --auto)"
	elif git remote get-url origin >/dev/null 2>&1; then
		echo "trunk unknown. origin/HEAD is unset and origin/main is missing. Run: git fetch origin, then git remote set-head origin --auto"
	else
		echo "trunk unknown. The Worktree gate branches from the remote default branch. Add a remote: git remote add origin <url>, then git fetch origin, then git remote set-head origin --auto"
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
	echo "not in a git repo. The Worktree gate needs a git repo with a remote default branch."
fi

if command -v vpr >/dev/null 2>&1; then echo "vpr: found"; else echo "vpr: missing"; fi

exit 0
