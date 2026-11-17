---
name: how
description: Explain how a subsystem works (architecture, runtime flow, where things live, where new code belongs) from one read-only explainer. Use for /orbit:how; use /orbit:why for motivation.
---

# How

Source: cursor/plugins, pstack (MIT).

Explore the codebase to answer "how does X work?" questions.

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

## 1. Explain

Spawn one `Agent` call with `subagent_type: "Explore"` on the `judgment` model (rules.md Workflow Defaults, Models) that explores and explains in one pass. Give it the user's question and this brief:

> You are writing an architectural explanation for a senior engineer. Explore the codebase and write an explanation that a senior engineer unfamiliar with this area could read and walk away with a solid mental model. They should understand the architecture well enough to start working in it confidently. You have read-only access to the codebase.

Explore keeps `Bash`, so the brief also says "do not edit files", and you check `git status --short` after it returns.

## 2. Present

Present the subagent's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.
