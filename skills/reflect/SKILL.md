---
name: reflect
description: Mine this session's transcript for durable learnings and route each to an edit on a skill it used. Use for /orbit:reflect.
disable-model-invocation: true
---

# Reflect

Source: cursor/plugins, pstack (MIT).

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, find this conversation's transcript by its session id. Do not read other sessions' transcripts. That crosses workspace boundaries and reads private chats from unrelated projects.

```bash
ls ~/.claude/projects/*/${CLAUDE_SESSION_ID}.jsonl; ls ~/.claude/projects/*/${CLAUDE_SESSION_ID}/subagents/*.jsonl 2>/dev/null
```

That covers the session (`<id>.jsonl`) and its subagents (`<id>/subagents/<child>.jsonl`). If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three `Agent` calls, `subagent_type: general-purpose`. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references.

| Lens | Prompt template |
|---|---|
| Judgment | `${CLAUDE_SKILL_DIR}/references/judgment-reviewer.md` |
| Tooling | `${CLAUDE_SKILL_DIR}/references/tooling-reviewer.md` |
| Divergent | `${CLAUDE_SKILL_DIR}/references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `Agent` response body.

## 3. Synthesize

One `Agent` call, `subagent_type: general-purpose`. It spot-verifies citations through MCP. Pass `${CLAUDE_SKILL_DIR}/references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

List each Backlog item as a `/orbit:correct <pattern>` candidate without waiting. Only the Accepted list waits for approval.

Follow each approved row's Routing exactly. Edit a plugin skill in its source repo, never the copy under `~/.claude/plugins/cache/`, which updates overwrite. If the skill is vendored (listed in that repo's `skills.json`), also add the change to its `edits`.

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the `skill-creator` skill if installed and run its draft / test / iterate loop, else the parent does it directly.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `skill-creator` if installed and run its description-optimization loop, else the parent does it directly.
- `new skill via create-skill: <kebab-name>`: hand creation to `skill-creator` if installed, else the parent drafts it. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog for `/orbit:correct`: `<pattern>`. One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
