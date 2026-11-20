import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LaneError, gradeLane, parseLane } from './grade.mjs';
import { SCENARIOS } from './scenarios.mjs';

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

test('every scenario has a prompt and every check one expectation', () => {
  for (const [slug, { prompt, checks }] of Object.entries(SCENARIOS)) {
    assert.ok(prompt, `${slug} has a prompt`);
    for (const [check, expect] of Object.entries(checks)) {
      assert.ok(expect.want || expect.anyOf || expect.state, `${slug} ${check}`);
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
    assert.doesNotMatch(readFileSync(path, 'utf8'), /[/-]Users[/-]|[/-]home[/-]|%2F(Users|home)%2F|[/-]var[/-]folders[/-]|\/private\/tmp\/|[\w.+-]+@[\w-]+\.[a-z]{2,}|gh[pousr]_\w{20,}|sk-\w{20,}|gAAAAA/i, path);
  }
});

test('scenarios that no fixture exercises', (t) => {
  const seen = new Set(fixtures.map(({ json }) => json.scenario));
  for (const slug of Object.keys(SCENARIOS)) if (!seen.has(slug)) t.diagnostic(`no fixture: ${slug}`);
});

test('a lane that did not complete fails every check', () => {
  const results = gradeLane(lane({ scenario: 'probe', status: 'timeout' }));
  assert.deepEqual(results.map((r) => r.verdict), ['FAIL', 'FAIL']);
  assert.match(results[0].why, /status is timeout/);
});

test('a lane with no toolCalls fails every check that applies', () => {
  const results = gradeLane(lane({ scenario: 'gitops-native', toolCalls: null }));
  assert.deepEqual(results.map((r) => r.verdict), ['FAIL', 'FAIL']);
  assert.match(results[0].why, /no toolCalls/);
});

test('a child that watches the PR fails no-child-watches; the lead watch still passes', () => {
  const watch = { name: 'mcp__t3-code__watch_pull_request', input: { url: 'https://github.com/o/r/pull/7' } };
  const toolCalls = [{ ...watch, sidechain: false }, { ...watch, sidechain: true }];
  assert.deepEqual(verdicts(lane({ scenario: 'watch-pr-wait', toolCalls })), { 'lead-watches': 'PASS', 'no-child-watches': 'FAIL' });
});

test('no-sleeping-watcher flags only a watcher run that polls', () => {
  const watcher = '/p/skills/playbook/scripts/watch-pr/watch-pr';
  const grade = (command) => verdicts(lane({ scenario: 'babysit-wait', toolCalls: [{ name: 'Bash', input: { command }, sidechain: false }] }))['no-sleeping-watcher'];
  assert.equal(grade(`${watcher} --owner o --repo r --pr 7`), 'FAIL');
  assert.equal(grade('cd /p/skills/playbook/scripts/watch-pr && ./watch-pr --pr 7'), 'FAIL');
  assert.equal(grade(`${watcher} --owner o --repo r --pr 7 --once`), 'PASS');
  assert.equal(grade('cd /p/skills/playbook/scripts/watch-pr && ./watch-pr --owner o --repo r --pr 7 --once'), 'PASS');
  assert.equal(grade(`"${watcher}" --pr 7 --once 2>&1 | tail -5`), 'PASS');
  assert.equal(grade(`${watcher} --pr 7 --status-only`), 'PASS');
  assert.equal(grade(`${watcher} --help`), 'PASS');
  assert.equal(grade(`FOO=1 ${watcher} --pr 7`), 'FAIL');
  assert.equal(grade(`bash -c "${watcher} --pr 7"`), 'FAIL');
  assert.equal(grade(`ls ${watcher}`), 'PASS');
  assert.equal(grade(`cat ${watcher}`), 'PASS');
  assert.equal(grade(`test -x ${watcher} && echo ok`), 'PASS');
});

test('a clientRequestId on a different call than the other-family seat fails request-id', () => {
  const seat = (input) => ({ name: 'mcp__t3-code__delegate_task', input: { role: 'review', mode: 'async', ...input }, sidechain: false });
  const toolCalls = [seat({ target: { providerInstanceId: 'codex' } }), seat({ clientRequestId: 'x', target: { providerInstanceId: 'claudeAgent' } })];
  assert.deepEqual(verdicts(lane({ scenario: 'review-seat', toolCalls })), { 'seat-other-family': 'PASS', 'request-id': 'FAIL' });
});

test('a schedule_task interval under 60 s fails', () => {
  const toolCalls = [{ name: 'mcp__t3-code__schedule_task', input: { bindToCurrentThread: true, schedule: { type: 'interval', everyMs: 30_000 } }, sidechain: false }];
  assert.deepEqual(verdicts(lane({ scenario: 'schedule-loop', toolCalls })), { 'bound-to-thread': 'PASS', 'interval-min-60s': 'FAIL' });
});

test('a lead Agent call without run_in_background: false fails every-agent-foreground', () => {
  const agent = (input) => ({ name: 'Agent', input: { subagent_type: 'orbit:poteto-agent', ...input }, sidechain: false });
  const grade = (toolCalls) => verdicts(lane({ scenario: 'foreground', toolCalls }))['every-agent-foreground'];
  assert.equal(grade([agent({})]), 'FAIL');
  assert.equal(grade([agent({ run_in_background: false })]), 'PASS');
});

test('an expectation with min passes only when that many calls match, naming each', () => {
  const child = (clientRequestId) => ({ name: 'mcp__t3-code__delegate_task', input: { isolation: 'worktree', mode: 'async', clientRequestId }, sidechain: false });
  const grade = (toolCalls) => gradeLane(lane({ scenario: 'parallel-units', toolCalls })).find((r) => r.check === 'own-checkout-children');
  const two = grade([{ name: 'Read', input: {} }, child('min-try1'), child('max-try1')]);
  assert.equal(two.verdict, 'PASS');
  assert.match(two.why, /^call 2 .*; call 3 /);
  const one = grade([child('min-try1'), child('')]);
  assert.equal(one.verdict, 'FAIL');
  assert.match(one.why, /^1 of 2 needed lead call .*; matched call 1 /);
  assert.match(grade([]).why, /^0 of 2 needed lead call/);
});

test('children-on-prerequisite fails a child whose round.mjs is its own, and a lane with no branches', () => {
  const branch = (ref, child, adds) => ({ ref, born: 'b'.repeat(40), tip: ref.padEnd(40, '0'), worktree: null, child, adds });
  const grade = (branches) => gradeLane(lane({ scenario: 'child-base', branches })).find((r) => r.check === 'children-on-prerequisite');
  const leadBranch = branch('feat', false, 'a'.repeat(40));
  assert.equal(grade([leadBranch, branch('mean', true, 'a'.repeat(40)), branch('median', true, 'a'.repeat(40))]).verdict, 'PASS');
  assert.equal(grade([leadBranch, branch('mean', true, 'a'.repeat(40)), branch('median', true, 'c'.repeat(40))]).verdict, 'FAIL');
  assert.equal(grade([leadBranch, branch('mean', true, 'a'.repeat(40)), branch('median', true, null)]).verdict, 'FAIL');
  assert.match(grade([leadBranch, branch('mean', true, 'a'.repeat(40))]).why, /^1 of 2 needed child branches/);
  assert.match(grade(null).why, /no branches recorded/);
});

test('brief-pins-base passes only a brief that runs the checkout guard and pins a SHA', () => {
  const grade = (task) => verdicts(lane({ scenario: 'child-base', toolCalls: [{ name: 'mcp__t3-code__delegate_task', input: { isolation: 'worktree', task }, sidechain: false }] }))['brief-pins-base'];
  assert.equal(grade('Run git rev-parse --show-toplevel and stop if it prints /p or /p/.claude/worktrees/x. Then git reset --hard 7beda92.'), 'PASS');
  assert.equal(grade('Run git reset --hard 7beda92, then add mean.mjs.'), 'FAIL');
  assert.equal(grade('Run git rev-parse --show-toplevel and stop if it prints /p. Then add mean.mjs.'), 'FAIL');
});

test('no-pick-conflict fails a cherry-pick recovery that starts a command, not one behind ||', () => {
  const grade = (command) => verdicts(lane({ scenario: 'child-base', toolCalls: [{ name: 'Bash', input: { command }, sidechain: true }] }))['no-pick-conflict'];
  assert.equal(grade('git cherry-pick 49a14e9 || git cherry-pick --abort; git rev-parse HEAD'), 'PASS');
  assert.equal(grade('git cherry-pick 49a14e9'), 'PASS');
  assert.equal(grade('git cherry-pick --abort'), 'FAIL');
  assert.equal(grade('git status; git -C /w cherry-pick --skip'), 'FAIL');
  assert.equal(grade('git add mean.mjs && GIT_EDITOR=true git cherry-pick --continue'), 'FAIL');
});

const call = (name, input = {}) => ({ name, input, sidechain: false });
const caps = call('mcp__t3-code__orchestrator_capabilities');
const opusAdversary = call('Agent', { subagent_type: 'general-purpose', model: 'opus' });
const reviewSeat = (providerInstanceId, model) => call('mcp__t3-code__delegate_task', { role: 'review', mode: 'async', target: { providerInstanceId, model } });

test('an all-fail lane that never read orchestrator_capabilities fails caps-read', () => {
  assert.deepEqual(verdicts(lane({ scenario: 'verifier-all-fail' })), { 'caps-read': 'FAIL', 'no-seat': 'PASS', 'no-native-verifier': 'PASS' });
  assert.equal(verdicts(lane({ scenario: 'seat-all-fail', toolCalls: [opusAdversary] }))['caps-read'], 'FAIL');
  assert.equal(verdicts(lane({ scenario: 'seat-all-fail', toolCalls: [caps, opusAdversary] }))['caps-read'], 'PASS');
});

test("verifier-all-fail grades a lane that waits only on the lead's own question", () => {
  const waiting = (scenario, pendingQuestion) => lane({ scenario, status: 'waiting', pendingQuestion, toolCalls: [caps, opusAdversary] });
  assert.deepEqual(verdicts(waiting('verifier-all-fail', [{ name: 'AskUserQuestion' }])), { 'caps-read': 'PASS', 'no-seat': 'PASS', 'no-native-verifier': 'PASS' });
  for (const pending of [null, [], [{ name: 'Bash' }], [{ name: 'AskUserQuestion' }, { name: 'Bash' }]]) {
    const results = gradeLane(waiting('verifier-all-fail', pending));
    assert.ok(results.every((r) => r.verdict === 'FAIL' && /status is waiting/.test(r.why)), JSON.stringify(pending));
  }
  assert.ok(gradeLane(waiting('seat-all-fail', [{ name: 'AskUserQuestion' }])).every((r) => r.verdict === 'FAIL'), 'only verifier-all-fail accepts a question');
});

test('seat-listed fails a near-miss provider, a same-family alias, an opaque model and a second seat', () => {
  const grade = (toolCalls) => verdicts(lane({ scenario: 'seat-listed', toolCalls }));
  assert.deepEqual(grade([reviewSeat('codex-proxy', 'gpt-5')]), { 'seat-on-first-listed': 'FAIL', 'only-listed-seats': 'FAIL', 'one-seat': 'PASS', 'no-native-code-adversary': 'PASS' });
  assert.equal(grade([reviewSeat('codex', 'anthropic/opus-4')])['seat-on-first-listed'], 'FAIL');
  assert.equal(grade([reviewSeat('codex', 'claude-sonnet-5')])['seat-on-first-listed'], 'FAIL');
  assert.equal(grade([reviewSeat('codex', 'auto')])['seat-on-first-listed'], 'FAIL');
  assert.equal(grade([reviewSeat('codex', 'gpt-5'), reviewSeat('grok', 'grok-4')])['one-seat'], 'FAIL');
  assert.deepEqual(grade([reviewSeat('codex', 'gpt-5'), reviewSeat('codex', 'gpt-5')]), { 'seat-on-first-listed': 'PASS', 'only-listed-seats': 'PASS', 'one-seat': 'PASS', 'no-native-code-adversary': 'PASS' });
});

test('a same-provider delegate_task is no seat, but still counts as a native adversary or verifier', () => {
  const grade = (scenario, toolCalls) => verdicts(lane({ scenario, toolCalls: [caps, ...toolCalls] }));
  const testChild = (providerInstanceId) => call('mcp__t3-code__delegate_task', { role: 'test', target: { providerInstanceId } });
  assert.deepEqual(grade('seat-all-fail', [reviewSeat('claudeAgent', 'claude-opus-5-5')]), { 'caps-read': 'PASS', 'no-seat': 'PASS', 'no-native-replacement': 'PASS', 'judgment-adversary-ran': 'PASS' });
  assert.equal(grade('seat-all-fail', [reviewSeat('claudeAgent', 'claude-opus-5-5'), reviewSeat('claudeAgent')])['no-native-replacement'], 'FAIL');
  assert.equal(grade('seat-all-fail', [call('mcp__t3-code__delegate_task', { role: 'review' })])['no-native-replacement'], 'FAIL');
  assert.equal(grade('seat-all-fail', [reviewSeat('codex', 'gpt-6.1-sol')])['no-seat'], 'FAIL');
  assert.equal(grade('seat-listed', [reviewSeat('claudeAgent', 'claude-sonnet-5')])['no-native-code-adversary'], 'FAIL');
  assert.equal(grade('seat-empty', [reviewSeat('claudeAgent', 'claude-opus-5-5')])['session-family-seat'], 'FAIL');
  assert.equal(grade('verifier-all-fail', [testChild('claudeAgent')])['no-native-verifier'], 'FAIL');
  assert.equal(grade('verifier-all-fail', [testChild(undefined)])['no-native-verifier'], 'FAIL');
  assert.equal(grade('verifier-all-fail', [testChild('codex')])['no-seat'], 'FAIL');
});

test('grade.mjs runs when its path goes through a symlink', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orbit-grade-'));
  try {
    symlinkSync(here, join(tmp, 't3'));
    const probe = fixtures.find((f) => f.name === 'claude-probe.json').path;
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(tmp, 't3', 'grade.mjs'), probe], { encoding: 'utf8' });
    assert.equal(status, 0, stderr);
    assert.ok(stdout.startsWith(`${probe}  probe\n`), stdout);
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test('parseLane rejects a lane it cannot grade, naming the file', () => {
  const base = { scenario: 'probe', status: 'completed', thread: { providerInstanceId: 'claudeAgent' }, toolCalls: [] };
  const cases = [
    ['{"scenario":', /not valid JSON/],
    [JSON.stringify({ ...base, scenario: 'nope' }), /unknown scenario "nope"/],
    [JSON.stringify({ ...base, thread: { providerInstanceId: 'codex' } }), /providerInstanceId "codex" is not a Claude lead/],
    [JSON.stringify({ ...base, toolCalls: undefined }), /no toolCalls key/],
    [JSON.stringify({ ...base, toolCalls: [{ input: {} }] }), /toolCalls is neither null nor a list of calls with a name/],
  ];
  for (const [text, reason] of cases) {
    assert.throws(() => parseLane(text, 'x.json'), (e) => e instanceof LaneError && e.message.startsWith('x.json: ') && reason.test(e.message));
  }
});

test('CLI prints every check of every fixture and exits 1', () => {
  const { status, stdout, stderr } = run('grade.mjs', fixtures.map((f) => f.path));
  assert.equal(status, 1, stderr);
  const lines = stdout.split('\n');
  for (const { path, json } of fixtures) assert.ok(lines.includes(`${path}  ${json.scenario}`), path);
  const checks = fixtures.reduce((n, { json }) => n + Object.keys(json.fixture.expect).length, 0);
  assert.equal(lines.filter((l) => /^ {2}(PASS|FAIL) +\S+ {2}\S/.test(l)).length, checks);
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
