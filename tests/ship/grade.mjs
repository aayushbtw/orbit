const GUARD = 'is isolated in the worktree';
const NOT_MERGED = 'is not fully merged';
const CHECKOUT_WRITE = /\bgit\s+(?:-C\s+(\S+)\s+)?(?:merge|checkout|switch|reset|pull)(?=[\s;&|)]|$)/g;

const textOf = (content) => typeof content === 'string' ? content : (content ?? []).map((c) => c.text ?? '').join('\n');

export function toolCalls(events) {
  const calls = new Map();
  for (const e of events) {
    if (!Array.isArray(e.message?.content)) continue;
    for (const block of e.message.content) {
      if (e.type === 'assistant' && block.type === 'tool_use') {
        calls.set(block.id, { id: block.id, name: block.name, input: block.input ?? {}, parent: e.parent_tool_use_id ?? null, result: null });
      }
      if (e.type === 'user' && block.type === 'tool_result' && calls.has(block.tool_use_id)) {
        calls.get(block.tool_use_id).result = { text: textOf(block.content), isError: block.is_error === true };
      }
    }
  }
  return [...calls.values()];
}

export const landed = (state) => state.originReadme != null && !/\bteh\b/i.test(state.originReadme) && /\bthe\b/.test(state.originReadme);

const isRefusal = (result) => result != null && (result.isError || /refus/i.test(result.text));
const oneLine = (s, max = 240) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

export function grade(events, state) {
  const calls = toolCalls(events);
  const byId = new Map(calls.map((c) => [c.id, c]));
  const who = (c) => c.parent ? (byId.get(c.parent)?.input.subagent_type ?? 'subagent') : 'lead';
  const exits = calls.filter((c) => c.name === 'ExitWorktree');
  const exitLine = (c) => `${who(c)}: ExitWorktree ${JSON.stringify(c.input)} -> ${c.result ? oneLine(c.result.text) : 'no result'}`;

  const didLand = landed(state);
  const checks = [{
    id: 'landed',
    status: didLand ? 'PASS' : 'FAIL',
    detail: [state.originReadme == null ? 'origin has no main:README.md' : `origin main README: ${oneLine(state.originReadme)}`],
  }];
  const gated = (id, failures, passDetail) => checks.push(!didLand
    ? { id, status: 'N/A', detail: ['the fix did not land on origin/main'] }
    : { id, status: failures.length ? 'FAIL' : 'PASS', detail: failures.length ? failures : [passDetail] });

  gated('no-discard', exits.filter((c) => c.input.discard_changes === true).map(exitLine), `${exits.length} ExitWorktree calls, none discard`);
  gated('no-exit-refusal', exits.filter((c) => isRefusal(c.result)).map(exitLine), `${exits.length} ExitWorktree calls, none refused`);
  gated('no-guard-refusal', calls.filter((c) => c.result?.text.includes(GUARD)).map((c) =>
    `${who(c)}: ${c.name} ${oneLine(c.input.command ?? JSON.stringify(c.input))}`), 'no guard refusal');

  const order = new Map(calls.map((c, i) => [c.id, i]));
  const exitAt = calls.findIndex((c) => !c.parent && c.name === 'ExitWorktree' && c.result && !isRefusal(c.result));
  const inRoot = (c) => exitAt >= 0 && (order.get(c.parent ?? c.id) ?? -1) > exitAt;
  const intoWorktree = (command, m) => (m[1] ?? [...command.slice(0, m.index).matchAll(/\bcd\s+(\S+)/g)].at(-1)?.[1] ?? '').includes('.claude/worktrees/');
  const writesRoot = (c) => c.name === 'Bash' && inRoot(c) && [...(c.input.command ?? '').matchAll(CHECKOUT_WRITE)].some((m) => !intoWorktree(c.input.command, m));
  gated('root-untouched', [
    ...calls.filter((c) => c.result?.text.includes(NOT_MERGED)).map((c) => `${who(c)}: branch delete refused as not fully merged: ${oneLine(c.input.command ?? JSON.stringify(c.input))}`),
    ...calls.filter(writesRoot).map((c) => `${who(c)}: git in the restored checkout: ${oneLine(c.input.command)}`),
  ], 'no branch delete refused as not fully merged, no merge, checkout, switch, reset or pull in the restored checkout');

  const leftWorktrees = state.worktrees.filter((w) => w.path !== '.');
  const leftBranches = state.branches.filter((b) => b !== 'main');
  gated('clean-end', [
    ...leftWorktrees.map((w) => `worktree left: ${w.path} [${w.branch ?? 'detached'}]${w.dirty ? ' (uncommitted changes)' : ''}`),
    ...leftBranches.map((b) => `branch left: ${b}`),
  ], 'only the project root and main');

  const results = events.filter((e) => e.type === 'result');
  const info = {
    turns: results.reduce((sum, r) => sum + (r.num_turns ?? 0), 0),
    cost: results.at(-1)?.total_cost_usd ?? null,
    end: results.at(-1)?.subtype ?? 'no result event',
    calls: { lead: calls.filter((c) => !c.parent).length, subagents: calls.filter((c) => c.parent).length },
    spawns: calls.filter((c) => c.name === 'Agent' || c.name === 'Task').map((c) => `${who(c)} -> ${c.input.subagent_type ?? 'general-purpose'}`),
    exits: exits.map(exitLine),
  };
  return { checks, info };
}
