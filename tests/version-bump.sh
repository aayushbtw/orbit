#!/usr/bin/env bash
set -euo pipefail

base_ref=${1:?usage: version-bump.sh <base-ref>}
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
manifest=plugin/.claude-plugin/plugin.json

merge_base=$(git -C "$repo" merge-base "$base_ref" HEAD)
if git -C "$repo" diff --quiet "$merge_base" HEAD -- plugin/; then
	echo "ok: plugin/ unchanged since $base_ref"
	exit 0
fi

base_version=$(git -C "$repo" show "$merge_base:$manifest" | jq -r .version)
head_version=$(git -C "$repo" show "HEAD:$manifest" | jq -r .version)
if [ "$base_version" = "$head_version" ]; then
	echo "FAIL: plugin/ changed since $base_ref but version stayed $head_version; bump version in $manifest"
	exit 1
fi
echo "ok: plugin/ changed since $base_ref and version moved $base_version -> $head_version"
