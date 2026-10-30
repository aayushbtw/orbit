---
name: interrogate
description: "Adversarial multi-model review of a change. One reviewer per model, merged into a lead verdict. Never auto-applies. Use for /orbit:interrogate."
---

# Interrogate

Source: cursor/plugins, pstack (MIT).

Spawn two reviewers, one on Opus and one on the session model, to adversarially review code changes. The adversarial signal comes from model diversity, not assigned personas. The deliverable is a synthesized verdict. Do NOT auto-apply changes.

## Step 1, Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that.
- If on a feature branch, run `git diff origin/main...HEAD` (or the appropriate base branch) plus the uncommitted files from `git status --short` for the full changeset.
- If the user's message references recent work, gather the relevant files.

Package the diff or file contents with any surrounding context files the reviewers need to understand the code.

## Step 2, Intent

Before spawning reviewers, state the intent in one clear paragraph from the user's message, commit messages, the PR description if one exists, and the code. If you're unsure about the intent, ask the user before proceeding.

## Step 3, Spawn Reviewers

Spawn two reviewers in a single message, Reviewer A and Reviewer B, as `Agent` calls with `subagent_type: "general-purpose"` and `model: "opus"` for A. B omits `model`, so it runs on the session model. Every brief says "do not edit files".

Read `${CLAUDE_SKILL_DIR}/references/reviewer-prompt.md` and fill in the same template for every reviewer with the stated intent, the diff or file contents, the rubric from `${CLAUDE_SKILL_DIR}/references/rubric.md`, and the code-quality lens from `${CLAUDE_SKILL_DIR}/references/code-quality-review.md`.

## Step 4, Synthesize

As results come back, build a unified picture. Parse every reviewer's findings. Merge findings that describe the same issue differently, and note which models raised each one. Findings two or more models raised independently are the highest signal. Read a lone model's finding, but weight it accordingly. Note disagreements. If one model flags something and another explicitly says the opposite, that is context for the verdict.

## Step 5, Lead Judgment

You are the lead reviewer, a pragmatic senior engineer, not a neutral aggregator. Read `${CLAUDE_SKILL_DIR}/references/lead-judgment.md` for the full framework. Put every finding in one of four buckets, with the model(s) that raised it and a one-line rationale.

- **Act on**. Real issues affecting correctness, security, or maintainability given the actual goals. They would block a real PR.
- **Consider**. Legitimate, but you're not sure they outweigh the cost of addressing them now. Worth the user's attention.
- **Noted**. Technically valid but not actionable. Context-dependent, premature optimization, or low-impact at this stage.
- **Dismissed**. Wrong, nitpicky, or missing context, with a brief reason.

## Output Format

### Intent
> [The stated intent paragraph from Step 2]

### Reviewers
- Reviewer [label]: [model name], [N findings] (one bullet per reviewer)

### Act On
[Each: description, which models raised it, why it matters.]

### Consider
[Each: description, which models raised it, the tradeoff.]

### Noted
[Brief list.]

### Dismissed
[Each with a brief rationale.]

### Agreement Map
[Where models agreed and diverged, and what that pattern tells us.]
