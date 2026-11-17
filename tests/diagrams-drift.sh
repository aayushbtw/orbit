#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
src="$repo/docs/diagrams"
pnpm_version=9.15.9

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "$src/render.mjs" "$src/package.json" "$src/pnpm-lock.yaml" "$src/Excalifont-Regular.woff2" "$tmp/"

if command -v pnpm >/dev/null && [ "$(pnpm --version 2>/dev/null | cut -d. -f1)" = "${pnpm_version%%.*}" ]; then
	pnpm=(pnpm)
else
	pnpm=(npx --yes "pnpm@$pnpm_version")
fi
(cd "$tmp" && "${pnpm[@]}" install --frozen-lockfile --silent >/dev/null && node render.mjs)

failed=0
checked=0
for committed in "$src"/*.svg; do
	name=$(basename "$committed")
	checked=$((checked + 1))
	if [ ! -f "$tmp/$name" ]; then echo "FAIL: docs/diagrams/$name is committed but render.mjs no longer produces it"; failed=1
	elif ! cmp -s "$committed" "$tmp/$name"; then echo "FAIL: docs/diagrams/$name drifted"; failed=1
	fi
done
for rendered in "$tmp"/*.svg; do
	name=$(basename "$rendered")
	[ -f "$src/$name" ] || { echo "FAIL: docs/diagrams/$name is rendered but not committed"; failed=1; }
done

[ "$failed" = 0 ] || { echo "run 'vpr build' in docs/diagrams and commit the SVGs"; exit 1; }
echo "ok: $checked SVGs match render.mjs"
