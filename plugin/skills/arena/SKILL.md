---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /orbit:arena, 'arena this', 'throw it in the arena', the arena step of /orbit:architect, or when one attempt at a non-trivial artifact would lock in the wrong shape."
---

# Arena

Source: cursor/plugins, pstack (MIT).

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Default to two runners, each an `Agent` call with `subagent_type: "orbit:poteto-agent"`, one on the `judgment` model and one on the `code` model (rules.md Workflow Defaults, Models). Spawn more for multiple design directions, and repeat one model when the work is generation-bound, not judgment-sensitive. Pick each runner's `effort` for the job, per "Match the model to the job" in orbit's rules.md.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill. A worktree runner runs per the host adapter's Where a child runs section (rules.md Delegation, **Host tools.**), under the playbook Delegate gate's parallel exception.

## Phase B: Fan out

Spawn the subagents under the Parallel cap (rules.md Workflow Defaults), up to the cap in one message and the next as one finishes, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, spawn one judge. The judge is never from the parent's family. When the `other-family` Models row lists providers (rules.md Workflow Defaults, Models), the judge is a roster seat from the host adapter's seats file (`../../docs/harness/t3-seats.md`, rules.md Delegation, **Host tools.**), briefed with the rubric and each candidate's absolute path. Otherwise choose the judge's model from the `judgment` and `code` models (rules.md Workflow Defaults, Models). The judge never runs on the parent's model. Without a roster, a different model stands in for a different family. If both resolve to the parent's model, as they do under the defaults, skip the judge, pick the base alone in Phase D, and say so. Otherwise spawn one judge as an `Agent` call with `subagent_type: "Explore"` on the first of them that differs. Its brief says "do not edit files", and you check `git status` afterward. If the `Agent` tool rejects that model, skip the judge and say so. If you do not know the parent's model, use the `judgment` model and say that the model check did not run. The judge scores each candidate, by path label, on each rubric criterion and recommends a base. A roster seat scores while you read in Phase D, and an `Agent` judge returns before you start.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the **laziness-protocol** principle skill.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically. In an /orbit:playbook flow, each runner commits its candidate in its own checkout, gitops cherry-picks the base's commit onto the task branch, and a fresh `orbit:poteto-agent` folds in the grafts, per the Delegate gate. You settle the runners only after the grafts are in.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
