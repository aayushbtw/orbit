# Steer with principles

Orbit carries 24 principles, short rules for the judgment calls that come up in almost every task. Each one has a name, and that name is the handle you steer with. This chapter covers how Claude uses the principles and how you use their names to change course mid-task.

## A principle is a named rule with a trigger

Each principle is its own skill, at `plugin/skills/principle-<name>/SKILL.md`. The playbook skill keeps an index of all 24. Each index entry is one line that names the situation that triggers the principle and what the principle asks for.

The index sorts the principles into five groups:

- **Core.** Ten principles about the size of a change, its order, and how far to rethink the design around it.
- **Architecture.** Six principles about the shape of the code itself, meaning its types, state, boundaries, and old APIs.
- **Verification.** Five principles about debugging, tests, and numbers you measured.
- **Delegation.** Two principles about what goes to subagents and when Claude stops to ask you.
- **Meta.** One principle, encode lessons in structure, for an instruction that keeps coming back.

Each name is short enough to say in a sentence, and each one points Claude at exactly one rule.

## Claude reads a principle when its trigger fires

When a flow starts, Claude loads the playbook, and its principles hold for the whole task. Claude doesn't read all 24 rules up front. It holds the one-line index, and when a situation in the index comes up, it opens that principle's skill and reads it in full.

Say Claude's second fix for a flaky test fails the same check as the first. That situation is the trigger for attack the premise. Claude reads that skill, writes down what both fixes assumed, and tests that belief before it tries a third fix.

The index is short and the skills carry the detail. Reading only the skills that apply leaves room in the session for the task itself. The code-writing subagent, poteto-agent, reads the same index before it starts, so a name means the same rule to the agent that writes the code.

## The reply names what shaped each decision

Orbit's rules tell Claude to name, in its reply, each principle that shaped a decision and the choice it changed. Claude may cite only principles whose skill it read in that session. A reply line looks like this:

```text
Subtract before you add. I deleted the unused `legacyFormat` branch in `export.ts` before adding the JSON option, so the new code has one path to extend.
```

This makes the reply something you can check. You see which rule moved which choice. If you disagree, you can argue with the rule by name instead of reopening the whole change.

## Use a name to change course

When Claude heads somewhere you don't want, say the principle's name and the specific thing you want. Claude reads that skill if it hasn't yet, applies it, and names it in the reply. The name carries the full rule, so your prompt only has to carry the detail of this task.

The seven below are the ones you will reach for most. Each has its trigger and a prompt you might send.

### Subtract before you add

The trigger is sequencing an addition, a refactor, or a rewrite. Claude removes dead weight first, then builds on the simpler base.

```text
apply subtract before you add. the old CSV exporter and its feature flag have no callers. delete them, then add the JSON export.
```

### Laziness protocol

The trigger is sizing a diff, or the urge to add an abstraction or a layer. Claude makes the smallest change that solves the problem and keeps each decision in one place.

```text
laziness protocol. you added a FormatterFactory for one formatter. inline it and keep the diff to the bug.
```

### Attack the premise

The trigger is two or more fixes, built on one shared belief, that fail the same check. Claude writes the belief down and tests it before it writes another fix.

```text
attack the premise. two timeout bumps both failed the e2e run. write down what they both assumed and test that before a third try.
```

### Fix root causes

The trigger is debugging. Claude traces the symptom back to the first place the system went wrong. A guard counts as a fix only when the state it handles is legitimate.

```text
fix root causes. the null check hides the bug. find out why session.user is null after a token refresh and fix it there.
```

### Prove it works

The trigger is the moment before Claude says a task is done. Claude checks the real thing, not a proxy such as "it compiles" or a subagent's own report.

```text
prove it works. a green build doesn't show that uploads work. upload a real 50 MB file and show me the stored object.
```

### Never block on the human

The trigger is the urge to ask "should I do X?" about work that can be undone. Claude does X, shows the result, and explains why. Irreversible actions, such as a force-push or deleting production data, still need your yes.

```text
never block on the human. both names are fine and a rename is easy to undo. pick one, finish the change, and tell me why you chose it.
```

### Exhaust the design space

The trigger is a new interaction or an architecture decision with no precedent in the codebase. Claude builds 2 or 3 competing prototypes and compares them before it commits to one.

```text
exhaust the design space. nothing in the app reorders by drag yet. build two or three versions and show them side by side before you pick.
```

## Stack rules work the same way

Stack rules follow the same pattern for a language. Before Claude writes a `.ts` or `.tsx` file, it reads the TypeScript rules index, then opens only the rule files that apply.

## Find the rest

The other 17 principles are listed by group in [Principles](../usage.md#principles). Each skill file under `plugin/skills/principle-*/` holds the full rule.

You don't have to learn the names in advance. Watch for them in Claude's replies. Each citation shows you a trigger at work, and the next time Claude misses one, you have the word ready.

Next: [Make orbit fit your project](./08-make-it-fit.md)
