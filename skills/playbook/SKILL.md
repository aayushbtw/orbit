---
name: playbook
description: Run the standard flow for a task type
argument-hint: bug | feature | refactor | perf
---
Task type: $ARGUMENTS

Follow only the matching section. Check and Land come from the Workflow block in the project's AGENTS.md (or CLAUDE.md). To land a change, run /ship.

## bug
1. Reproduce it. Write a failing test or exact command first.
2. Find the cause. Fix the cause, not the symptom.
3. Confirm the repro passes and the check is green.
## feature
1. State "done" in 3 bullets. Ask only if a real decision is missing.
2. Read the nearest similar code and match it.
3. Make the smallest change that meets "done". Run the check.

## refactor
1. Pin current behavior first: a test or a saved output to diff against. Types and lint are not a pin.
2. Delete dead code and one-caller wrappers before adding the new shape.
3. Move in small steps, pin green after each. Migrate every caller and delete the old API in the same change.
4. Keep it only if the code is easier to read. Otherwise revert.

## perf
1. Measure first and record the number. Check the timed work actually ran and didn't error.
2. Try fixes cheapest first: don't do it, don't do it again, do less, do it later, do it concurrently, do it cheaper.
3. Change one thing, measure again over several runs. Keep it only if the gain beats run-to-run noise. Report before and after.
