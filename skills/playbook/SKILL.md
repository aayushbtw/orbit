---
name: playbook
description: Run the standard flow for a task type
argument-hint: bug | feature | perf
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

## perf
1. Measure first and record the number.
2. Change one thing, measure again.
3. Keep it only if the number improves. Report before and after.
