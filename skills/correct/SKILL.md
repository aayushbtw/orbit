---
name: correct
description: Turn a mistake into a lasting guard
argument-hint: [what went wrong]
---
Mistake: $ARGUMENTS

Add the cheapest lasting guard, first that fits:
1. A type or lint rule that makes it impossible.
2. A test that fails when it happens.
3. One line in the right doc: the nearest AGENTS.md, or DESIGN.md / ARCHITECTURE.md / DOCS.md if the project has them.

Add one guard only. Show the diff.
