# The orbit guide

Orbit turns a goal into finished work. You say what you want, and orbit picks a flow, builds the change in its own worktree, has a separate agent prove it, and lands it. This guide explains how that works and why each step is there, so you know what to expect and when to step in.

Read it in order the first time. Each page also stands on its own.

1. [Start a task](./01-start-a-task.md). Give `/orbit:start` a goal, see how it picks a flow, and read the `Next:` line.
2. [Understand code before you change it](./02-understand-code.md). Investigate, `/orbit:how`, `/orbit:why`, `/orbit:recall` and `/orbit:ketchup`.
3. [Design before code](./03-design-first.md). `/orbit:architect`, `/orbit:arena`, `/orbit:swarm`, `/orbit:interrogate` and throwaway prototypes.
4. [Build a change](./04-build-a-change.md). Worktrees, the plan gate, delegates that never review their own code, and cleanup.
5. [Prove it works, then ship](./05-prove-and-ship.md). The verifier, verification skills, Babysit and Shipping.
6. [Work while you're away](./06-hands-off.md). Autopilot queues, multi-PR plans, decision trails, and pausing.
7. [Steer with principles](./07-steer-with-principles.md). Use a principle's name to change course mid-task.
8. [Make orbit fit your project](./08-make-it-fit.md). The Workflow block, folder rules, and turning a repeated mistake into a guard.

For a command lookup, use the [usage reference](../usage.md).

## The short version

Name the outcome and how you'll know it worked. Leave the steps to orbit.

```text
/orbit:start the invite email links expire after 1 hour, but the settings page says 24. make them match the page and prove an old link still opens.
```

Orbit reads that as a bug, reproduces it, fixes it in a worktree, and has a fresh verifier open an old link before anything lands. You get one `Next:` line at the end.

Next: [Start a task](./01-start-a-task.md)
