import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { audit } from './audit.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const projects = [join(here, 'fixtures', '-work-acme'), join(here, 'fixtures', '-tmp-greet-abc')];
const scratch = tmpdir();
process.env.TMPDIR = '/scratch/tmp';
const report = audit({ projects, since: '2026-11-09' });
const metric = (id) => {
  const { label: _, id: __, ...rest } = report.metrics.find((m) => m.id === id);
  return rest;
};

describe('population', () => {
  test('drops sessions outside the window and orbit lane, greet and $TMPDIR runs', () => {
    assert.deepEqual(report.excludedSessions, { 'orbit-lane': 1, '$TMPDIR': 1, 'greet-': 1 });
    assert.deepEqual(metric('main-sessions'), { value: 2 });
  });

  test('--until keeps sessions that start on or before it, --skip drops a session id', () => {
    const mains = (opts) => audit({ projects, since: '2026-11-09', ...opts }).metrics.find((m) => m.id === 'main-sessions').value;
    assert.equal(mains({ until: '2026-11-11' }), 1);
    assert.equal(mains({ until: '2026-11-12' }), 2);
    assert.equal(mains({ skip: ['s1'] }), 1);
  });

  test('types each subagent by its spawning call, over a wrong meta agentType, defaulting to general-purpose', () => {
    assert.deepEqual(metric('subagents'), { value: 5, per: [2, 'main session'], breakdown: { 'poteto-agent': 1, verifier: 2, gitops: 1, 'general-purpose': 1 } });
  });
});

describe('metrics', () => {
  test('guard refusals come from the result text, so one behind `| tail` with no is_error counts and a Read of the phrase does not', () => {
    assert.deepEqual(metric('guard-refusals'), { value: 3, per: [7, 'agent'], breakdown: { 'cd before git': 1, 'git aimed elsewhere': 1, 'git in complex form': 1 } });
    assert.deepEqual(metric('guard-refusals-by-type'), { value: 3, per: [7, 'agent'], breakdown: { main: 2, 'poteto-agent': 1, 'agents refused': { main: '1/2', 'poteto-agent': '1/1' } } });
  });

  test('ExitWorktree splits by action, discard_changes and refusal', () => {
    assert.deepEqual(metric('exit-worktree'), { value: 3, per: [2, 'main session'], breakdown: { 'keep ok': 1, 'remove refused': 1, 'remove+discard ok': 1 } });
  });

  test('git worktree remove counts git refusing behind `| tail`, the guard and the safety check, not a later chained step failing', () => {
    assert.deepEqual(metric('worktree-remove-refused'), { value: 3, per: [5, 'call'], breakdown: { 'git refused': 1, guard: 1, 'safety check': 1, ok: 2 } });
  });

  test('rules.md and rules-shared.md reads count per subagent, only under an orbit folder', () => {
    assert.deepEqual(metric('read-rules'), { value: 1, per: [5, 'subagent'], breakdown: { verifier: '1/2' } });
    assert.deepEqual(metric('read-rules-shared'), { value: 1, per: [5, 'subagent'], breakdown: { 'poteto-agent': '1/1' } });
  });

  test('playbook loads count per orbit-run session, by flow argument', () => {
    assert.deepEqual(metric('playbook-loads'), { value: 2, per: [1, 'orbit session'], breakdown: { feature: 1, 'opening-a-pr': 1, 'max/session': 2 } });
  });

  test('verifier verdict is the first verdict word of its report, for background and foreground spawns', () => {
    assert.deepEqual(metric('verifier-verdicts'), { value: 2, breakdown: { 'PASS+NOTES': 1, FAIL: 1 } });
  });

  test('a subagent that hit an API error or ended without a report counts as failed', () => {
    assert.deepEqual(metric('subagent-failures'), { value: 2, per: [5, 'subagent'], breakdown: { 'gitops: api error': 1, 'general-purpose: empty': 1 } });
  });

  test('an Agent call answered with a launch notice is background, flag or not, and adds no wait', () => {
    assert.deepEqual(metric('foreground-agent-calls'), { value: 3, per: [2, 'main session'], breakdown: { foreground: 3, background: 2 } });
    assert.deepEqual(metric('foreground-agent-wait-h'), { value: 0.5, per: [2, 'main session'], breakdown: { 'poteto-agent': 0.2, gitops: 0, verifier: 0.3 } });
  });

  test('corrections count prompts by phrase, skipping commands and PR-watch notices', () => {
    assert.deepEqual(metric('user-corrections'), { value: 3, per: [2, 'main session'], breakdown: { 'use advisor': 1, "don't ask me": 1, 'stop / hold': 1, 'why did you': 1 } });
  });

  test('orbit issues count --repo and -R, filed only when the result holds an issue URL', () => {
    assert.deepEqual(metric('orbit-issues'), { value: 2, per: [2, 'main session'], breakdown: { filed: 1, failed: 1 } });
  });
});

describe('cli', () => {
  const out = mkdtempSync(join(scratch, 'orbit-audit-test-'));
  after(() => rmSync(out, { recursive: true, force: true }));

  test('prints the table and writes the same report as JSON', () => {
    const json = join(out, 'report.json');
    const stdout = execFileSync('node', [join(here, 'audit.mjs'), '--projects', ...projects, '--since', '2026-11-09', '--json', json], { encoding: 'utf8', env: { ...process.env, TMPDIR: '/scratch/tmp' } });
    assert.match(stdout, /^guard-refusals +\| 3 +\| 0\.43\/agent \(of 7\)/m);
    assert.deepEqual(JSON.parse(readFileSync(json, 'utf8')), JSON.parse(JSON.stringify(report)));
  });

  test('exits 2 with usage when --since is missing', () => {
    assert.throws(() => execFileSync('node', [join(here, 'audit.mjs'), '--projects', projects[0]], { stdio: 'pipe' }), { status: 2 });
  });
});
