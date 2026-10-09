---
description: Run the standard flow for a task type
argument-hint: bug | feature | perf | ship
---
Task type: $ARGUMENTS

Follow only the matching section. The check command is the one in the project's CLAUDE.md.

## bug
1. Reproduce it. Write a failing test or exact command first.
2. Find the cause. Fix the cause, not the symptom.
3. Confirm the repro passes and the check is green.
4. gitops commits.

## feature
1. State "done" in 3 bullets. Ask only if a real decision is missing.
2. Read the nearest similar code and match it.
3. Make the smallest change that meets "done". Run the check.
4. reviewer, fix blockers, then gitops.

## perf
1. Measure first and record the number.
2. Change one thing, measure again.
3. Keep it only if the number improves. Report before and after.

## ship
1. Run the check, build and tests.
2. reviewer on the diff, fix blockers.
3. gitops: commit and open the PR.
