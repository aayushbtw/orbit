import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LaneError, gradeLane, parseLane } from './grade.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { READERS, kindOf } from './sessions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'fixtures');
const truncated = join(dir, 'invalid', 'truncated.json');
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((name) => {
  const path = join(dir, name);
  const text = readFileSync(path, 'utf8');
  return { name, path, text, json: JSON.parse(text) };
});
const verdicts = (lane) => Object.fromEntries(gradeLane(lane).map((r) => [r.check, r.verdict]));
const run = (script, args) => spawnSync(process.execPath, [join(here, script), ...args], { encoding: 'utf8' });
const lane = (fields) => ({ status: 'completed', toolCalls: [], ...fields });

test('every check has an expectation or an N/A reason for every provider, never both', () => {
  for (const [slug, { prompt, checks }] of Object.entries(SCENARIOS)) {
    assert.ok(prompt, `${slug} has a prompt`);
    for (const [check, cell] of Object.entries(checks)) {
      for (const provider of Object.keys(READERS)) {
        assert.ok(Boolean(cell[provider]) !== Boolean(cell.na?.[provider]), `${slug} ${check} ${provider}`);
      }
    }
  }
});

for (const { name, text, json } of fixtures) {
  test(`fixture ${name} grades as it expects`, () => {
    const { fixture } = json;
    assert.ok(['real', 'hand-built'].includes(fixture?.origin), 'origin is real or hand-built');
    assert.ok(fixture.source, 'source is set');
    assert.equal(fixture.relabeled, json.message !== SCENARIOS[json.scenario].prompt, 'relabeled is true exactly when the message is not the scenario prompt');
    assert.deepEqual(Object.keys(fixture.expect), Object.keys(SCENARIOS[json.scenario].checks), 'expect names every check');
    assert.deepEqual(verdicts(parseLane(text, name)), fixture.expect);
  });
}

test('fixtures hold no home path, email address or secret', () => {
  for (const path of [...fixtures.map((f) => f.path), truncated]) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /[/-]Users[/-]|[/-]home[/-]|\/var\/folders\/|\/private\/tmp\/|[\w.+-]+@[\w-]+\.[a-z]{2,}|gh[pousr]_\w{20,}|sk-\w{20,}|gAAAAA/i, path);
  }
});

test('provider cells that no fixture exercises', (t) => {
  const seen = new Set(fixtures.map(({ json }) => `${json.scenario} ${kindOf(json.thread.providerInstanceId)}`));
  for (const [slug, { checks }] of Object.entries(SCENARIOS)) {
    for (const [check, cell] of Object.entries(checks)) {
      for (const provider of Object.keys(READERS)) {
        if (cell[provider] && !seen.has(`${slug} ${provider}`)) t.diagnostic(`no fixture: ${slug} ${check} ${provider}`);
      }
    }
  }
});

test('a lane that did not complete fails every check, N/A ones included', () => {
  const results = gradeLane(lane({ scenario: 'rules-load', provider: 'claude', status: 'timeout' }));
  assert.deepEqual(results.map((r) => r.verdict), ['FAIL']);
  assert.match(results[0].why, /status is timeout/);
});

test('a lane with no toolCalls fails every check that applies', () => {
  const results = gradeLane(lane({ scenario: 'gitops-native', provider: 'codex', toolCalls: null }));
  assert.deepEqual(results.map((r) => r.verdict), ['FAIL', 'FAIL']);
  assert.match(results[0].why, /no toolCalls/);
});

test('a Codex spawn whose call args were not found fails fork_turns and says so', () => {
  const toolCalls = [{ name: 'spawn_agent', input: { join: 'missing', resolved_model: 'gpt-6.1-sol' }, sidechain: false }];
  const [result] = gradeLane(lane({ scenario: 'code-child', provider: 'codex', toolCalls }));
  assert.equal(result.verdict, 'FAIL');
  assert.match(result.why, /call args were not found/);
});

test('a child that watches the PR fails no-child-watches; the lead watch still passes', () => {
  const watch = { name: 'mcp__t3-code__watch_pull_request', input: { url: 'https://github.com/o/r/pull/7' } };
  const toolCalls = [{ ...watch, sidechain: false }, { ...watch, sidechain: true }];
  assert.deepEqual(verdicts(lane({ scenario: 'watch-pr-wait', provider: 'claude', toolCalls })), { 'lead-watches': 'PASS', 'no-child-watches': 'FAIL' });
});

test('a schedule_task interval under 60 s fails', () => {
  const toolCalls = [{ name: 'mcp__t3-code__schedule_task', input: { bindToCurrentThread: true, schedule: { type: 'interval', everyMs: 30_000 } }, sidechain: false }];
  assert.deepEqual(verdicts(lane({ scenario: 'schedule-loop', provider: 'codex', toolCalls })), { 'bound-to-thread': 'PASS', 'interval-min-60s': 'FAIL' });
});

test('parseLane rejects a lane it cannot grade, naming the file', () => {
  const base = { scenario: 'probe', status: 'completed', thread: { providerInstanceId: 'codex' }, toolCalls: [] };
  const cases = [
    ['{"scenario":', /not valid JSON/],
    [JSON.stringify({ ...base, scenario: 'nope' }), /unknown scenario "nope"/],
    [JSON.stringify({ ...base, thread: { providerInstanceId: 'gemini' } }), /unknown provider "gemini"/],
    [JSON.stringify({ ...base, toolCalls: undefined }), /no toolCalls key/],
  ];
  for (const [text, reason] of cases) {
    assert.throws(() => parseLane(text, 'x.json'), (e) => e instanceof LaneError && e.message.startsWith('x.json: ') && reason.test(e.message));
  }
});

test('CLI prints every check of every fixture and exits 1', () => {
  const { status, stdout, stderr } = run('grade.mjs', fixtures.map((f) => f.path));
  assert.equal(status, 1, stderr);
  const lines = stdout.split('\n');
  for (const { path, json } of fixtures) assert.ok(lines.includes(`${path}  ${json.scenario}  ${kindOf(json.thread.providerInstanceId)}`), path);
  const checks = fixtures.reduce((n, { json }) => n + Object.keys(json.fixture.expect).length, 0);
  assert.equal(lines.filter((l) => /^ {2}(PASS|FAIL|N\/A) +\S+ {2}\S/.test(l)).length, checks);
});

test('CLI exits 0 on the fixtures that expect no FAIL', () => {
  const clean = fixtures.filter(({ json }) => !Object.values(json.fixture.expect).includes('FAIL'));
  assert.ok(clean.length > 0);
  const { status, stderr } = run('grade.mjs', clean.map((f) => f.path));
  assert.equal(status, 0, stderr);
});

test('CLI exits 2 on a truncated lane and names the file', () => {
  const { status, stderr } = run('grade.mjs', [truncated]);
  assert.equal(status, 2);
  assert.match(stderr, new RegExp(`^${truncated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: not valid JSON`));
});

test('lane.mjs with no arguments exits 1 with usage', () => {
  const { status, stderr } = run('lane.mjs', []);
  assert.equal(status, 1);
  assert.match(stderr, /^usage: node tests\/t3\/lane\.mjs/);
});
