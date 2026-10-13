---
name: start
description: Start a task - pick the flow, list the steps, run them
argument-hint: <what you want done>
---
Goal: $ARGUMENTS

A number as the goal means that task from `/orbit:pickup`'s list; if pickup hasn't run this session, read the project's `handoff.md` memory first. If its Flow covers the goal, run `/orbit:playbook <type>` for the step and gate text, copy the Flow's list as pickup updated it, keeping done and `skip:` marks, then go to step 3.

1. **Pick the type** from the goal: `bug` (something broken), `feature` (new behavior), `refactor` (structure only), `perf` (measured slowness). A question with no change: answer it and stop. No fit: say so and ask one question.
2. **Load the flow.** Run `/orbit:playbook <type>` with the Skill tool. Copy its steps and both gates into the todo list as written. The last item is `/orbit:ship`.
3. **Run the list in order.** Skip a step only by marking it `skip: <reason>`. Never drop one silently.
4. **Stay in the list.** "continue" or "do it" resumes it. "new task" starts a fresh list.
