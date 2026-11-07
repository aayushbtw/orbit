import { appendFileSync, readFileSync } from 'node:fs';

const [log] = process.argv.slice(2);
const input = JSON.parse(readFileSync(0, 'utf8'));
const record = {
  ts: new Date().toISOString(),
  event: input.hook_event_name,
  tool_name: input.tool_name,
  tool_use_id: input.tool_use_id ?? null,
  agent_id: input.agent_id ?? null,
};

if (input.hook_event_name === 'PostToolUse') {
  appendFileSync(log, JSON.stringify({ ...record, resolved_model: input.tool_response?.resolvedModel ?? null }) + '\n');
} else {
  appendFileSync(log, JSON.stringify({ ...record, tool_input: input.tool_input }) + '\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...input.tool_input, model: 'haiku', effort: 'low' },
    },
  }));
}
