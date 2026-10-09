#!/bin/sh
# SessionStart hook: update the usage ledger. Silent, and never blocks a session.
NODE="$(command -v node 2>/dev/null || true)"
[ -n "$NODE" ] || NODE="$HOME/.local/share/vite-plus/bin/node"
[ -x "$NODE" ] || exit 0
"$NODE" "$(dirname "$0")/ledger.mjs" >/dev/null 2>&1
exit 0
