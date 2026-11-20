import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, test } from 'node:test';
import { claude, isClaude } from './sessions.mjs';

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

test('isClaude accepts only a Claude provider instance id', () => {
  assert.equal(isClaude('claudeAgent'), true);
  assert.equal(isClaude('Claude-work'), true);
  assert.equal(isClaude('codex'), false);
  assert.equal(isClaude('grok'), false);
  assert.equal(isClaude(undefined), false);
});
