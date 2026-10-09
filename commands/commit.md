---
description: Commit current changes with a conventional subject line
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*)
---
!`git status --short`
!`git diff --stat`

Stage the files that belong together, then commit.
- Format: `<type>(<scope>): <description>`. `!` after scope for breaking change.
- Description: present tense imperative, no period, 50 chars max.
- Subject line only. No body.

Reply with the hash and subject only.
