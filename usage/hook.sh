#!/bin/sh
# SessionStart hook: update the usage ledger. Silent, and never blocks a session.
command -v node >/dev/null 2>&1 || exit 0
node "$(dirname "$0")/ledger.mjs" >/dev/null 2>&1
exit 0
