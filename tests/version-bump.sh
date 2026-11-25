#!/usr/bin/env bash
set -euo pipefail

base_ref=${1:?usage: version-bump.sh <base-ref>}
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
manifest=plugin/manifest.json
legacy_manifest=plugin/.claude-plugin/plugin.json

merge_base=$(git -C "$repo" merge-base "$base_ref" HEAD)
if git -C "$repo" diff --quiet "$merge_base" HEAD -- plugin/; then
	echo "ok: plugin/ unchanged since $base_ref"
	exit 0
fi

# A base from before the manifest moved keeps it under .claude-plugin/. Drop the fallback once main has plugin/manifest.json.
base_version=$( { git -C "$repo" show "$base_ref:$manifest" 2>/dev/null || git -C "$repo" show "$base_ref:$legacy_manifest"; } | jq -r .version)
head_version=$(git -C "$repo" show "HEAD:$manifest" | jq -r .version)
highest=$(printf '%s\n%s\n' "$base_version" "$head_version" | sort -V | tail -n 1)
if [ "$base_version" = "$head_version" ] || [ "$highest" != "$head_version" ]; then
	echo "FAIL: plugin/ changed since $base_ref but version $head_version is not above $base_ref's $base_version; bump version in $manifest"
	exit 1
fi
if ! git -C "$repo" show HEAD:CHANGELOG.md | grep -xF "## $head_version" >/dev/null; then
	echo "FAIL: version $head_version has no '## $head_version' entry in CHANGELOG.md; add one"
	exit 1
fi
echo "ok: plugin/ changed since $base_ref and version moved $base_version -> $head_version"
