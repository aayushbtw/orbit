---
name: architect
description: "Sketch two shapes for a change's types, signatures and module structure before code and pick one, or run /orbit:arena for a large or contested design. Use for /orbit:architect, or the architect step of an /orbit:playbook flow."
---

# Architect

Source: cursor/plugins, pstack (MIT).

Before writing code, trace every system the change touches, then sketch two different shapes for it (types, signatures, module boundaries) and pick the one where each piece of state has one owner, each task has one way to do it, and callers need to know least. Redesign instead of patching if workarounds repeat. In an /orbit:playbook flow, reuse the flow's earlier `/orbit:how` output for the trace when it covers those systems. Keep the sketches in your reply, and send any stub code through the playbook's Delegate gate.

For a large or contested design, run `/orbit:arena` instead of sketching alone.
