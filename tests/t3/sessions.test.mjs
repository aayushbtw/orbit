import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, test } from 'node:test';
import { activityCall, claude, isClaude, pendingQuestions, readT3Activity, readT3ActivityTree, t3ToolName } from './sessions.mjs';

const root = mkdtempSync(join(tmpdir(), 'orbit-sessions-test-'));
after(() => rmSync(root, { recursive: true, force: true }));
const worktree = '/work/orbit-lane-x';
const writeJsonl = (path, entries) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
};

test('lead is the newest session whose first user entry is after the lane start, though an earlier lane wrote to its file since', () => {
  const home = join(root, 'claude');
  const dir = claude.where(worktree, { home });
  const message = '/orbit:start Report the branch.';
  const opening = '<command-message>orbit:start</command-message>\n<command-name>/orbit:start</command-name>\n<command-args>Report the branch.</command-args>';
  const since = Date.parse('2026-11-20T10:00:00Z');
  const appended = new Date('2026-11-20T11:00:00Z');
  const session = (file, timestamp) => {
    writeJsonl(join(dir, file), [{ type: 'user', timestamp, message: { content: opening } }, { type: 'cost-state' }]);
    utimesSync(join(dir, file), appended, appended);
  };
  session('earlier.jsonl', '2026-11-20T09:00:00Z');
  session('fresh.jsonl', '2026-11-20T10:01:00Z');
  session('fresher.jsonl', '2026-11-20T10:02:00Z');
  const sessions = claude.sessions(worktree, { home, since });
  assert.deepEqual(sessions.map(([f]) => basename(f)).toSorted(), ['fresh.jsonl', 'fresher.jsonl']);
  assert.equal(claude.lead(sessions, worktree, { message, home }).file, join(dir, 'fresher.jsonl'));
});

const item = (position, type, text, extra = {}) => ({ position, itemId: `i${position}`, type, status: 'completed', text, textTruncated: false, nextTextOffset: null, ...extra });
const toolItem = (position, toolName, input, extra) => item(position, 'dynamic_tool', JSON.stringify({ toolName, input }), extra);

// A fake t3_thread_read that pages `items` per thread and serves the rest of a truncated item's text.
function fakeT3(threads, { pageSize = 2, rest = {}, pending = {} } = {}) {
  const calls = [];
  const tool = async (name, args) => {
    calls.push([name, args]);
    if (name === 't3_pending_request') return { requests: (pending[args.threadId] ?? []).map((requestId) => ({ requestId })) };
    if (args.itemId) {
      const chunks = rest[args.itemId];
      const at = chunks.findIndex((c) => c.offset === args.textOffset);
      const last = at === chunks.length - 1;
      return { item: { itemId: args.itemId, text: chunks[at].text, textTruncated: !last, nextTextOffset: last ? null : chunks[at + 1].offset } };
    }
    const all = threads[args.threadId] ?? [];
    const start = all.findIndex((i) => i.position > args.afterPosition);
    const page = start < 0 ? [] : all.slice(start, start + pageSize);
    const hasMore = start >= 0 && start + pageSize < all.length;
    return { items: page, hasMore, nextPosition: hasMore ? page.at(-1).position : null };
  };
  return { tool, calls };
}

test('t3ToolName maps every T3 spelling to mcp__t3-code__ and keeps other names', () => {
  assert.equal(t3ToolName('t3-code.t3_thread_read'), 'mcp__t3-code__t3_thread_read');
  assert.equal(t3ToolName('mcp_t3-code_delegate_task'), 'mcp__t3-code__delegate_task');
  assert.equal(t3ToolName('mcp__t3-code__watch_pull_request'), 'mcp__t3-code__watch_pull_request');
  for (const name of ['Agent', 'Skill', 'AskUserQuestion', 'ask_question', 'request_user_input']) assert.equal(t3ToolName(name), name);
});

test('command_execution items become Bash calls with Codex shell wrappers unwrapped', () => {
  const bash = (text) => activityCall(item(0, 'command_execution', text), false)?.input.command;
  assert.equal(bash('$ git status --short\n M a.txt'), 'git status --short');
  assert.equal(bash('$ /bin/zsh -lc "gh pr view 7 --json \\"state\\""\n{}'), 'gh pr view 7 --json "state"');
  assert.equal(bash("$ bash -lc 'echo '\\''hi'\\'''\nhi"), "echo 'hi'");
  assert.equal(bash('$ /bin/zsh -lc "git add a &&\ngit commit -m x"\n[main 1a2b] x'), 'git add a &&\ngit commit -m x');
  assert.equal(bash('no dollar prompt'), undefined);
});

test('dynamic_tool and mcp_tool_call items parse their JSON, and other items are skipped', () => {
  assert.deepEqual(activityCall(toolItem(0, 't3-code.delegate_task', { role: 'review' }), true), { name: 'mcp__t3-code__delegate_task', input: { role: 'review' }, sidechain: true });
  assert.deepEqual(activityCall(item(0, 'mcp_tool_call', JSON.stringify({ server: 't3-code', tool: 'schedule_task', arguments: '{"bindToCurrentThread":true}' })), false), { name: 'mcp__t3-code__schedule_task', input: { bindToCurrentThread: true }, sidechain: false });
  assert.equal(activityCall(item(0, 'dynamic_tool', '{"toolName": "Ag'), false), null);
  assert.equal(activityCall(item(0, 'agent_message', 'hello'), false), null);
  assert.equal(activityCall(item(0, 'dynamic_tool', '{"input": {}}'), false), null);
});

test('readT3Activity pages from afterPosition -1, stitches truncated text and marks unfinished calls pending', async () => {
  const delegate = JSON.stringify({ toolName: 'mcp__t3-code__delegate_task', input: { role: 'review', task: 'x'.repeat(30) } });
  const { tool, calls } = fakeT3({
    lead: [
      item(0, 'agent_message', 'thinking'),
      item(1, 'command_execution', '$ /bin/zsh -lc "pwd"\n/w'),
      toolItem(2, 'Skill', { skill: 'orbit:start' }),
      item(3, 'dynamic_tool', delegate.slice(0, 20), { textTruncated: true, nextTextOffset: 20 }),
      toolItem(4, 'ask_question', { question: 'which?' }, { status: 'inProgress' }),
    ],
  }, { rest: { i3: [{ offset: 20, text: delegate.slice(20, 40) }, { offset: 40, text: delegate.slice(40) }] } });
  const { calls: got, pending } = await readT3Activity(tool, 'lead');
  assert.deepEqual(got.map((c) => c.name), ['Bash', 'Skill', 'mcp__t3-code__delegate_task', 'ask_question']);
  assert.equal(got[0].input.command, 'pwd');
  assert.equal(got[2].input.task, 'x'.repeat(30));
  assert.deepEqual(pending, [{ name: 'ask_question', input: { question: 'which?' } }]);
  const pages = calls.filter(([, a]) => a.view === 'activity').map(([, a]) => a.afterPosition);
  assert.deepEqual(pages, [-1, 1, 3]);
  assert.ok(calls.every(([, a]) => a.maxCharsPerItem === 20000));
  assert.deepEqual(calls.filter(([, a]) => a.itemId).map(([, a]) => a.textOffset), [20, 40]);
});

test('readT3ActivityTree reads the lead, then each descendant as sidechain, for Antigravity, Codex, Grok and Claude leads', async () => {
  const { tool } = fakeT3({
    lead: [toolItem(0, 't3-code.orchestrator_capabilities', {}), toolItem(1, 't3-code.delegate_task', { role: 'review', target: { providerInstanceId: 'claudeAgent' } })],
    codexChild: [item(0, 'command_execution', '$ /bin/zsh -lc "node --test"\nok')],
    grokChild: [toolItem(0, 'mcp_t3-code_t3_thread_read', { threadId: 'lead' })],
    claudeGrandchild: [toolItem(0, 'Agent', { subagent_type: 'general-purpose' })],
  });
  const threads = [
    { threadId: 'lead', parentThreadId: null },
    { threadId: 'codexChild', parentThreadId: 'lead' },
    { threadId: 'grokChild', parentThreadId: 'lead' },
    { threadId: 'claudeGrandchild', parentThreadId: 'codexChild' },
  ];
  const { toolCalls } = await readT3ActivityTree(tool, 'lead', threads);
  assert.deepEqual(toolCalls.map(({ name, sidechain }) => [name, sidechain]), [
    ['mcp__t3-code__orchestrator_capabilities', false],
    ['mcp__t3-code__delegate_task', false],
    ['Bash', true],
    ['mcp__t3-code__t3_thread_read', true],
    ['Agent', true],
  ]);
  assert.equal(toolCalls[2].input.command, 'node --test');
});

test('pendingQuestions prefers unfinished question calls, else lists t3_pending_request ids, else null', async () => {
  const { tool } = fakeT3({}, { pending: { asks: ['req-1'] } });
  const asked = [{ name: 'AskUserQuestion', input: {} }];
  assert.deepEqual(await pendingQuestions(tool, 'asks', asked), asked);
  assert.deepEqual(await pendingQuestions(tool, 'asks', []), [{ name: 'request_user_input', input: { requestId: 'req-1' } }]);
  assert.equal(await pendingQuestions(tool, 'quiet', []), null);
});

test('isClaude accepts only a Claude provider instance id', () => {
  assert.equal(isClaude('claudeAgent'), true);
  assert.equal(isClaude('Claude-work'), true);
  assert.equal(isClaude('codex'), false);
  assert.equal(isClaude('grok'), false);
  assert.equal(isClaude(undefined), false);
});
