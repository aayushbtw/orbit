import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { READERS, kindOf, readLead } from './sessions.mjs';

const root = mkdtempSync(join(tmpdir(), 'orbit-sessions-test-'));
after(() => rmSync(root, { recursive: true, force: true }));
const worktree = '/work/orbit-lane-x';
const writeJsonl = (path, entries) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
};

describe('codex', () => {
  const homes = { codex: join(root, 'codex') };
  const day = join(homes.codex, 'sessions', '2026', '11', '17');
  const leadFile = join(day, 'rollout-lead.jsonl');
  const item = (thread_id, item) => ({ type: 'event_msg', payload: { type: 'item_completed', thread_id, item } });
  const spawnCall = (call_id, args) => ({ type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id, arguments: JSON.stringify(args) } });
  const started = (id, agent, model, reasoning_effort) => item('L', { type: 'SubAgentActivity', id, kind: 'started', model, reasoning_effort, agent_thread_id: agent, agent_path: `/root/${agent}` });
  writeJsonl(leadFile, [
    { type: 'session_meta', payload: { id: 'L', timestamp: '2026-11-17T00:00:00Z', cwd: worktree } },
    { type: 'token_usage_record', payload: { usage: { input_tokens: 1234 } } },
    spawnCall('c1', { task_name: 'gitops', fork_turns: 'none', message: 'ENCRYPTED' }),
    started('c1', 'C1', 'gpt-6.1-sol', 'low'),
    spawnCall('c2', { task_name: 'code', model: 'gpt-6.1-sol', message: 'ENCRYPTED' }),
    started('c2', 'C2', 'gpt-6.1-sol', 'medium'),
    started('c3', 'C3', 'gpt-6.1-sol', 'low'),
    item('L', { type: 'SubAgentActivity', id: 'done-c1', kind: 'completed', model: null, reasoning_effort: null, agent_thread_id: 'C1', agent_path: '/root/C1' }),
    item('L', { type: 'McpToolCall', server: 't3-code', tool: 'delegate_task', arguments: { role: 'review' }, result: { content: [{ text: '{"childThreadId":"t3-child"}' }] } }),
  ]);
  writeJsonl(join(day, 'rollout-child.jsonl'), [
    { type: 'session_meta', payload: { id: 'C1', parent_thread_id: 'L', timestamp: '2026-11-17T00:00:05Z', cwd: worktree } },
    item('C1', { type: 'CommandExecution', command: ['git', 'status'], cwd: worktree }),
  ]);
  writeJsonl(join(day, 'rollout-elsewhere.jsonl'), [
    { type: 'session_meta', payload: { id: 'X', timestamp: '2026-11-16T00:00:00Z', cwd: '/work/other' } },
    item('X', { type: 'CommandExecution', command: ['ls'], cwd: '/work/other' }),
  ]);
  const expected = {
    firstTurnInputTokens: 1234,
    toolCalls: [
      { name: 'spawn_agent', input: { task_name: 'gitops', fork_turns: 'none', agent_thread_id: 'C1', agent_path: '/root/C1', resolved_model: 'gpt-6.1-sol', resolved_reasoning_effort: 'low' }, sidechain: false },
      { name: 'spawn_agent', input: { task_name: 'code', model: 'gpt-6.1-sol', agent_thread_id: 'C2', agent_path: '/root/C2', resolved_model: 'gpt-6.1-sol', resolved_reasoning_effort: 'medium' }, sidechain: false },
      { name: 'spawn_agent', input: { join: 'missing', agent_thread_id: 'C3', agent_path: '/root/C3', resolved_model: 'gpt-6.1-sol', resolved_reasoning_effort: 'low' }, sidechain: false },
      { name: 'mcp__t3-code__delegate_task', input: { role: 'review' }, sidechain: false },
      { name: 'exec_command', input: { command: ['git', 'status'], cwd: worktree }, sidechain: true },
    ],
    pending: [],
  };

  test('joins spawn_agent args by call_id: model only from args, fork_turns absent when omitted, join missing without a call', () => {
    assert.deepEqual(readLead('codex', leadFile, { homes }), expected);
  });

  test('lead is the earliest rollout in the worktree, with its children', () => {
    const sessions = READERS.codex.sessions(worktree, { homes });
    assert.deepEqual(READERS.codex.lead(sessions, worktree, { homes }), { file: leadFile, ...expected });
    assert.deepEqual(READERS.codex.childIds(sessions), ['t3-child']);
  });

  test('a rollout that began before the lane started is not the lead, though its file changed since', () => {
    const sessions = READERS.codex.sessions(worktree, { homes, since: Date.parse('2026-11-17T00:00:01Z') });
    assert.deepEqual(sessions.map(([f]) => f), [join(day, 'rollout-child.jsonl')]);
  });
});

describe('claude', () => {
  const homes = { claude: join(root, 'claude') };
  const dir = READERS.claude.where(worktree, { homes });
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

  test('lead is the newest session whose first user entry is after the lane start, though an earlier lane wrote to its file since', () => {
    const sessions = READERS.claude.sessions(worktree, { homes, since });
    assert.deepEqual(sessions.map(([f]) => basename(f)).toSorted(), ['fresh.jsonl', 'fresher.jsonl']);
    assert.equal(READERS.claude.lead(sessions, worktree, { message, homes }).file, join(dir, 'fresher.jsonl'));
  });
});

describe('grok', () => {
  const homes = { grok: join(root, 'grok') };
  const dir = join(homes.grok, 'sessions', encodeURIComponent(worktree));
  const message = '/orbit:start Report the branch.';
  const leadFile = join(dir, 'L', 'chat_history.jsonl');
  const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });
  const query = (text) => ({ type: 'user', prompt_index: 0, content: [{ type: 'text', text: `<user_query>\n${text}\n</user_query>\n<skill_information>x</skill_information>` }] });
  writeJsonl(leadFile, [
    { type: 'system', content: 'system prompt' },
    { type: 'user', content: [{ type: 'text', text: '<user_info>\nWorkspace Path: /work\n</user_info>' }] },
    query(message),
    { type: 'assistant', content: '', tool_calls: [call('g1', 'read_file', { target_file: '/p/rules.md' }), call('g2', 'spawn_subagent', { subagent_type: 'orbit:gitops', background: false, prompt: 'branch?' })] },
    { type: 'tool_result', tool_call_id: 'g1', content: 'rules' },
    { type: 'tool_result', tool_call_id: 'g2', content: 'main\n<subagent_result>\nsubagent_id: C\n</subagent_result>' },
    { type: 'assistant', content: '', tool_calls: [call('g3', 'use_tool', { tool_name: 't3-code__delegate_task', tool_input: { role: 'review' } })] },
    { type: 'tool_result', tool_call_id: 'g3', content: '{"childThreadId":"t3-child"}' },
    { type: 'assistant', content: '', tool_calls: [call('g4', 'run_terminal_command', { command: 'pwd' })] },
  ]);
  mkdirSync(join(dir, 'L', 'subagents', 'C'), { recursive: true });
  writeFileSync(join(dir, 'L', 'subagents', 'C', 'meta.json'), '{}');
  writeJsonl(join(dir, 'C', 'chat_history.jsonl'), [
    { type: 'user', prompt_index: 0, content: [{ type: 'text', text: 'branch?' }] },
    { type: 'assistant', content: '', tool_calls: [call('k1', 'run_terminal_command', { command: 'git status' })] },
  ]);
  writeJsonl(join(dir, 'O', 'chat_history.jsonl'), [
    query('another message'),
    { type: 'assistant', content: '', tool_calls: [call('o1', 'read_file', { target_file: '/other' })] },
  ]);
  const expected = {
    firstTurnInputTokens: null,
    toolCalls: [
      { name: 'read_file', input: { target_file: '/p/rules.md' }, sidechain: false },
      { name: 'spawn_subagent', input: { subagent_type: 'orbit:gitops', background: false, prompt: 'branch?' }, sidechain: false },
      { name: 'use_tool', input: { tool_name: 't3-code__delegate_task', tool_input: { role: 'review' } }, sidechain: false },
      { name: 'run_terminal_command', input: { command: 'pwd' }, sidechain: false },
      { name: 'run_terminal_command', input: { command: 'git status' }, sidechain: true },
    ],
    pending: [{ name: 'run_terminal_command', input: { command: 'pwd' } }],
  };

  test('lead is the session whose first query is the message; child calls are sidechain', () => {
    const sessions = READERS.grok.sessions(worktree, { homes });
    assert.deepEqual(READERS.grok.lead(sessions, worktree, { message, homes }), { file: leadFile, ...expected });
    assert.deepEqual(READERS.grok.childIds(sessions), ['t3-child']);
  });

  test('reads one lead session file with its children', () => {
    assert.deepEqual(readLead('grok', leadFile, { homes }), expected);
  });

  test('a missing Grok home yields no sessions', () => {
    const sessions = READERS.grok.sessions(worktree, { homes: { grok: join(root, 'absent') } });
    assert.deepEqual(sessions, []);
    assert.equal(READERS.grok.lead(sessions, worktree, { message }), null);
  });
});

test('kindOf maps a provider instance id to its reader', () => {
  assert.equal(kindOf('codex-work'), 'codex');
  assert.equal(kindOf('Grok'), 'grok');
  assert.equal(kindOf('claudeAgent'), 'claude');
  assert.equal(kindOf('gemini'), undefined);
});
