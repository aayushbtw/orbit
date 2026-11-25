# Understand code before you change it

Every tool on this page reads and never edits. Pick one by the question you have: how the code works, why it looks the way it does, where you left off, or what happened in this chat while you were away.

## Ask a question through /orbit:start

You don't need a special command to ask about code. Give `/orbit:start` a question, and it picks the `investigate` flow.

```text
/orbit:start how does a job get from the queue to a worker, and what happens when the worker crashes mid-job?
```

The `investigate` flow is read-only. It makes no commit and opens no PR. It traces the code the question is about, and also routes through `/orbit:why` when the question is about motivation. The answer comes back in five sections, and Claude drops any that don't apply:

- Overview
- Key Concepts
- How It Works
- Where Things Live
- Gotchas

A question that asks you to choose between options gets a recommendation with a tradeoffs table instead.

```text
/orbit:start should the rate limiter live in the API gateway or in each service? compare both for this repo.
```

Because the flow edits nothing, you can run it on any branch, at any time, even in the middle of other work. If the answer shows that a change is needed, Claude hands back to you instead of starting the change. Start that change as its own task with `/orbit:start <goal>`.

### Ask "are we sure?"

The investigation flow also takes a doubt as its question. For an "are we sure?" question, the reply gives Claude's real judgment with its reasons, and it pushes back when the premise is wrong.

```text
/orbit:start are we sure the session cache is cleared when a user changes their password?
```

Ask this kind of question before a risky change, not after. A wrong premise found here costs one reply. Found after the change, it costs a revert.

## Learn how a subsystem works with /orbit:how

`/orbit:how` explains how a part of the codebase works at the level a senior engineer needs when they join a new subsystem. It aims for a working model, not a line-by-line tour.

```text
/orbit:how the plugin loader
```

`/orbit:how` spawns one read-only explainer that explores and writes the answer in a single pass. It doesn't edit files, and Claude checks `git status` after it returns. The bulk reading stays in that subagent, so your session gets the finished explanation instead of every file.

You don't always have to type it. Claude runs `/orbit:how` on its own when your question matches it.

## Learn why code is the way it is with /orbit:why

`/orbit:how` tells you what the code does. `/orbit:why` tells you what forces gave it that shape. Use it for a strange threshold, a defensive check, a design that looks wrong, or a regression with a history.

```text
/orbit:why the 45 second timeout in src/sync/client.ts
```

`/orbit:why` answers from the record, not the code. It reads the commits and PR discussions that introduced the target and each later change, and other sources, such as a connected tracker or chat, when that trail is thin.

The answer cites what the authors wrote, marks Claude's own inferences as inferences, and says what the record does not answer.

## Find where you left off with /orbit:recall

`/orbit:recall` is about your work, not the code. It rebuilds where you left off across your recent chats in this project, before you start or resume.

```text
/orbit:recall the billing webhook retries
```

By default it looks at the last 7 days of chats in the current project, and it states that scope back to you before it searches. Subagents read the matching chats, so the raw transcripts stay out of your session. When the topic names a feature, file or bug, it also starts one investigator per source, such as git history, the issue tracker and error tracking, and asks what has been tried, what got reverted, and what users still report. It then checks each PR, branch and ticket it found against live `git` and `gh` state.

You get a short brief. It has a capsule of where things stand, one line per thread with a status tag such as `[open PR #N]` or `[reverted #N]`, the recurring problems, and the single best next move. `/orbit:recall` runs only when you type it.

## Catch up on this chat with /orbit:ketchup

`/orbit:ketchup` covers a smaller window. It tells you what changed in the current chat since the last message you wrote. Use it after a long autonomous stretch, or when you come back to a chat and the scrollback is too long to read.

```text
/orbit:ketchup
```

It opens with one sentence that names what waits on you, or says that nothing does. Then it sums up what happened in plain words, with screenshots or small diagrams when a picture explains the change better. Last comes each call only you can make, with Claude's pick, the evidence behind it, and the risk. The turn is read-only, so it changes no code and posts nothing. Like `/orbit:recall`, it runs only when you type it.

## Pick the right one

Each tool answers a different question:

- "How does this work?" or "Should we do X or Y?" Use `/orbit:start <question>`, or `/orbit:how <subsystem>` when you want the explanation alone.
- "Why is it like this?" Use `/orbit:why <code or decision>`.
- "Where did I leave off on this topic?" Use `/orbit:recall [topic]`.
- "What happened in this chat while I was away?" Use `/orbit:ketchup`.

To resume one specific paused chat, use `/orbit:session-pickup` instead of `/orbit:recall`. See [Stop cleanly, pick up later](./06-hands-off.md#stop-cleanly-pick-up-later). For the full table, see [Understand code](../usage.md#understand-code) in the usage reference.

Next: [Design before code](./03-design-first.md)
