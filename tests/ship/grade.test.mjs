import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readJsonl } from '../routing/lead.mjs';
import { grade } from './grade.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fixtures = readdirSync(root).sort().map((name) => ({ name, dir: join(root, name) }));
const statuses = (checks) => Object.fromEntries(checks.map((c) => [c.id, c.status]));
const cli = (dir) => spawnSync(process.execPath, [join(here, 'cleanup.mjs'), '--grade', dir], { encoding: 'utf8' });

for (const { name, dir } of fixtures) {
  test(`fixture ${name} grades as it expects, and the CLI exit code follows`, () => {
    const expect = readJson(join(dir, 'expect.json'));
    const { checks } = grade(readJsonl(join(dir, 'stream.jsonl')), readJson(join(dir, 'state.json')));
    assert.deepEqual(statuses(checks), expect);
    const { status, stderr } = cli(dir);
    assert.equal(status, Object.values(expect).includes('FAIL') ? 1 : 0, stderr);
  });
}

test('the fixtures cover a run with no FAIL and a run with a FAIL on each cleanup check', () => {
  const expects = fixtures.map(({ dir }) => readJson(join(dir, 'expect.json')));
  assert.ok(expects.some((e) => Object.values(e).every((s) => s === 'PASS')), 'a passing run');
  for (const id of ['no-discard', 'no-exit-refusal', 'no-guard-refusal', 'root-untouched', 'clean-end']) {
    assert.ok(expects.some((e) => e[id] === 'FAIL'), `a run failing ${id}`);
  }
});

test('root-untouched fails on a not-fully-merged refusal or git that moves the restored checkout after the exit', () => {
  const dir = join(root, 'pass');
  const events = readJsonl(join(dir, 'stream.jsonl'));
  const state = readJson(join(dir, 'state.json'));
  const withCall = (command, result) => [...events,
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_added', name: 'Bash', input: { command } }] } },
    { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_added', content: result }] } },
  ];
  for (const [command, result, status] of [
    ['git branch -d fix/readme-typo', "error: the branch 'fix/readme-typo' is not fully merged", 'FAIL'],
    ['git fetch origin; git merge --ff-only origin/main', 'Fast-forward', 'FAIL'],
    ['git -C /tmp/greet-cc6a65 checkout main', '', 'FAIL'],
    ['git -C /tmp/greet-cc6a65/.claude/worktrees/fix-readme-typo reset --hard', '', 'PASS'],
    ['cd /tmp/greet-cc6a65/.claude/worktrees/fix-readme-typo && git switch -c x', '', 'PASS'],
    ['git merge-base --is-ancestor fix/readme-typo origin/main && git branch -D fix/readme-typo', 'Deleted branch', 'PASS'],
  ]) {
    assert.equal(statuses(grade(withCall(command, result), state).checks)['root-untouched'], status, command);
  }
});

test('a run that did not land fails landed and marks every other check N/A', () => {
  const state = { originReadme: 'get teh greeting\n', worktrees: [{ path: '.', branch: 'main' }, { path: '.claude/worktrees/fix-x', branch: 'fix/x' }], branches: ['main', 'fix/x'] };
  const { checks } = grade([], state);
  assert.deepEqual(statuses(checks), { landed: 'FAIL', 'no-discard': 'N/A', 'no-exit-refusal': 'N/A', 'no-guard-refusal': 'N/A', 'root-untouched': 'N/A', 'clean-end': 'N/A' });
  assert.match(checks[1].detail[0], /did not land/);
});

test('fixtures hold no home path, email address or secret', () => {
  for (const { dir } of fixtures) {
    for (const file of readdirSync(dir)) {
      assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /[/-]Users[/-]|[/-]home[/-]|[/-]var[/-]folders[/-]|\/private\/tmp\/|[\w.+-]+@[\w-]+\.[a-z]{2,}|gh[pousr]_\w{20,}|sk-\w{20,}/i, `${dir}/${file}`);
    }
  }
});
