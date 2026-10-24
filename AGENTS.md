# orbit

## Mistakes made before

| Rule | Enforced by |
| --- | --- |
| Delete a landed branch with `-D` only when its tip is its merged PR's head; a merged PR says nothing about commits made after it | `hooks/guard-branch-delete.sh` (PreToolUse on Bash) |
