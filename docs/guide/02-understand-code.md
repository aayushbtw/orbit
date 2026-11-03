# Understand code before you change it

A wrong mental model of the code costs more than a wrong line of code. Orbit gives you read-only tools that build the model first, each for a different kind of question. This chapter covers the investigation flow, `/orbit:how`, `/orbit:why`, `/orbit:recall` and `/orbit:ketchup`, and when to reach for each one.

## Ask a question through /orbit:start

You don't need a special command to ask about code. Give `/orbit:start` a question, and it picks the `investigate` flow.

```text
/orbit:start how does a job get from the queue to a worker, and what happens when the worker crashes mid-job?
```

The `investigate` flow is read-only. It makes no commit and opens no PR. It routes the question through `/orbit:how`, and also through `/orbit:why` when the question is about motivation. The answer comes back in five sections, and orbit drops any that don't apply:

- Overview
- Key Concepts
- How It Works
- Where Things Live
- Gotchas

A question that asks you to choose between options gets a recommendation with a tradeoffs table instead.

```text
/orbit:start should the rate limiter live in the API gateway or in each service? compare both for this repo.
```

Because the flow edits nothing, you can run it on any branch, at any time, even in the middle of other work. If the answer shows that a change is needed, orbit hands back to you instead of starting the change. Start that change as its own task with `/orbit:start <goal>`.

### Ask "are we sure?"

The investigation flow also takes a doubt as its question. For an "are we sure?" question, the reply gives orbit's real judgment with its reasons, and it pushes back when the premise is wrong.

```text
/orbit:start are we sure the session cache is cleared when a user changes their password?
```

Ask this kind of question before a risky change, not after. A wrong premise found here costs one reply. Found after the change, it costs a revert.

## Learn how a subsystem works with /orbit:how

`/orbit:how` explains how a part of the codebase works at the level a senior engineer needs when they join a new subsystem. It aims for a working model, not a line-by-line tour.

```text
/orbit:how the plugin loader
```

Orbit first sizes the question. A narrow question, such as one function or one small module, gets one explainer that reads and writes the answer in a single pass. A subsystem that spans many files gets split into 2 to 4 angles. A separate explorer reads each angle in parallel, and one explainer then joins their findings into the answer. The explorers don't edit files, and orbit checks `git status` after they return.

The split keeps the bulk reading in subagents. Each explorer reads only its slice, the explainer works from their findings, and your session gets the finished explanation instead of every file. When the size is in doubt, orbit takes the single-explainer path.

You don't always have to type it. Orbit runs `/orbit:how` on its own when your question matches it, inside the `investigate` and `bug` flows, and before a nontrivial change or an architecture decision.

## Learn why code is the way it is with /orbit:why

`/orbit:how` tells you what the code does. `/orbit:why` tells you what forces gave it that shape. Use it for a strange threshold, a defensive check, a design that looks wrong, or a regression with a history.

```text
/orbit:why the 45 second timeout in src/sync/client.ts
```

Orbit first builds a code anchor from git. It runs `git blame` and `git log` on the target, finds the PR numbers in the commits, and reads those PR bodies and reviews with `gh`. Then it spawns one investigator per kind of evidence, in parallel. Source control is always one of them. Each other kind gets an investigator when a connected MCP covers it. Those kinds are an issue tracker, long-form docs, team chat, infrastructure observability, error tracking, and a product analytics warehouse. The more of them you connect, the more places `/orbit:why` can look.

The answer keeps what orbit knows apart from what it guesses. It has separate sections for what was found, what can be reasonably inferred, competing hypotheses, and what is still unknown. Sources Consulted lists every investigator, including the ones that found nothing and the ones skipped with the reason. A search that came back empty is still a result, so you can see where orbit looked.

The investigators trace back past the latest commit, because the current shape is often many older decisions stacked up. Trusting only the most recent change is the mistake `/orbit:why` is built to avoid. When your question leads into a change, the answer also ends with a Preserve, Change, Avoid and Risk list to plan it with.

## Find where you left off with /orbit:recall

`/orbit:recall` is about your work, not the code. It rebuilds where you left off across your recent chats in this project, before you start or resume.

```text
/orbit:recall the billing webhook retries
```

By default it looks at the last 7 days of chats in the current project, and it states that scope back to you before it searches. Subagents read the matching chats, so the raw transcripts stay out of your session. When the topic names a feature, file or bug, it also asks the `/orbit:why` investigators what has been tried, what got reverted, and what users still report. It then checks each PR, branch and ticket it found against live `git` and `gh` state.

You get a short brief. It has a capsule of where things stand, one line per thread with a status tag such as `[open PR #N]` or `[reverted #N]`, the recurring problems, and the single best next move. `/orbit:recall` runs only when you type it.

## Catch up on this chat with /orbit:ketchup

`/orbit:ketchup` covers a smaller window. It tells you what changed in the current chat since the last message you wrote. Use it after a long autonomous stretch, or when you come back to a chat and the scrollback is too long to read.

```text
/orbit:ketchup
```

It opens with one sentence that names what waits on you, or says that nothing does. Then it sums up what happened in plain words, with screenshots or small diagrams when a picture explains the change better. Last comes each call only you can make, with orbit's pick, the evidence behind it, and the risk. The turn is read-only, so it changes no code and posts nothing. Like `/orbit:recall`, it runs only when you type it.

## Pick the right one

Each tool answers a different question:

- "How does this work?" or "Should we do X or Y?" Use `/orbit:start <question>`, or `/orbit:how <subsystem>` when you want the explanation alone.
- "Why is it like this?" Use `/orbit:why <code or decision>`.
- "Where did I leave off on this topic?" Use `/orbit:recall [topic]`.
- "What happened in this chat while I was away?" Use `/orbit:ketchup`.

To resume one specific paused chat, use `/orbit:session-pickup` instead of `/orbit:recall`. See [Stopping and resuming](../usage.md#stopping-and-resuming) in the usage reference. For the full table, see [Understand code](../usage.md#understand-code) in the usage reference.

Next: [Design before code](./03-design-first.md)
