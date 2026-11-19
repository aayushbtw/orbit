### Multi-phase or multi-PR plan

**You own the plan, not the code. The plan is a checklist an owner runs box by box and the operator audits from the evidence.** The plan is the deliverable. Do not implement.

Under Land `main`, a PR in the plan is a task branch, as `playbooks/autopilot-full.md` maps it.

1. When the change is one or two files with an obvious approach, skip the plan. Say so and stop.
2. Settle open questions by prototype before you write, per `playbooks/prototype.md`. Brief the `advisor` on a fork no run settles, and ask the operator only where rules.md Non-negotiables says to.
3. Write the plan file. Unless the operator names a path, write it under `$TMPDIR/orbit-autopilot/<slug>/docs/`. Open with what changes, the PR ids in landing order, and the dependency graph, which says which PRs are independent and branch from trunk, which wait for which, and the files each may touch. Then one section per PR. One PR is one change with its own evidence (the **sequence-verifiable-units** principle skill). Each section has checkboxes for what it depends on, the files it edits, the one change it builds, the result you see, and its verification.
4. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Each live box drives the real surface with a concrete scenario and a pass predicate. The perf box names the metric, the probe, the trunk baseline measured first, and the number that fails. A PR that changes an interaction waits for the operator's review before merge.
5. Hand back the plan path and stop. Execution starts on the operator's explicit go. Per **Ship by default** in `playbooks/opening-a-pr.md`, it runs `playbooks/autopilot-full.md`, or `playbooks/autopilot-stack.md` when the operator said "don't ship" or "I'll land it".

**Reply:** the plan path, the PR ids with their dependencies and the review-gated set, and what stays unproven.
