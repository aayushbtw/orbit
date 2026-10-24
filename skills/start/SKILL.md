---
name: start
description: Start a task - pick the flow, list the steps, run them
argument-hint: <what you want done>
---
Goal: $ARGUMENTS

Resuming from `/orbit:session-pickup`: mark the steps the prior trail finished as done.

1. **Pick the type** from the goal: `investigate` (a question, no change), `bug` (something broken), `feature` (new behavior), `refactor` (structure only), `perf` (measured slowness). No fit: take the closest flow and say which and why. Ask only when the goal itself is unclear.
2. **Load the flow.** Run `/orbit:playbook <type>` with the Skill tool. Copy its steps and gates into the todo list as written. For a change, the last item is `/orbit:ship`. Its Principles and Stack rules hold for the whole task, and its **Reply:** sets what the final reply holds.
3. **Run the list in order.** Skip a step only by marking it `skip: <reason>`. Never drop one silently.
4. **Stay in the list.** "continue" or "do it" resumes it. "new task" starts a fresh list.
