### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.
1. State "done" in 3 bullets. Ask only if a real decision is missing.
2. `/orbit:how` over the affected subsystem.
3. `/orbit:architect` for parallel design exploration.
4. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
5. Delegate code-writing to a fresh `orbit:poteto-agent` per the Delegate gate, with a specific scope (file paths, named data shape and its organizing structure per model-the-domain, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via `/orbit:arena` instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and laziness-protocol does not override it (the gain is review separation, not lines saved). No "standing by" reply that waits on a nested agent. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. gitops commits each reviewed unit, per the gate.
6. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
7. Stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
8. If the design is contested, `/orbit:interrogate` before shipping.
9. Run **Opening a PR**.

Code-coupled work (one feature, one migration) goes to the parent as single owner, with the checkpoint inline and one `orbit:poteto-agent` per unit under the Delegate gate. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Those write no code, so they run as read-only agents outside the Delegate gate. Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
