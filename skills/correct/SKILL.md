---
name: correct
description: Turn a mistake into a lasting guard
argument-hint: [what went wrong]
disable-model-invocation: true
---
Mistake: $ARGUMENTS

No mistake given: read recent commits, reverts and review comments, and pick the one that has happened twice. If none repeats, ask which one.

Add the guard at the highest level that works, first that fits:
1. Architecture that removes it: one owner per piece of state, one way to do each task. Delete the old way an agent would copy.
2. A type or lint rule that makes it impossible. A lint error names what to use instead.
3. A test that fails when it happens.
4. One line in the right doc: the nearest AGENTS.md, or DESIGN.md / ARCHITECTURE.md / DOCS.md if the project has them. Only for judgment calls; nothing fails when an agent skips a doc.

For 1-3, prove the guard catches the real mistake: run it against the bad code and show it fail. Add one guard only. Show the diff.

Last, keep the "Mistakes made before" list in the nearest AGENTS.md as a table that pairs each rule with what enforces it. When the operator corrects you, fix the mistake and add the rule. If the rule was already there and nothing enforces it, that's a repeat, so fix it at the highest level in the same change. Drop a rule once its mistake can't happen.
