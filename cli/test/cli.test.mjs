import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
const headings = '| Task | Use for | Model | Effort |\n| --- | --- | --- | --- |\n';
let home;
let workspace;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orbit-cli-test-'));
  workspace = join(home, 'repo');
  mkdirSync(workspace);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function seed(file, content) {
  const path = join(home, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '' },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
}

function json(...args) {
  const { status, stdout, stderr } = run(...args, '--json');
  expect(stderr).toBe('');
  expect(status).toBe(0);
  return JSON.parse(stdout);
}

test('setup registers the packaged skill tree without tools on PATH and reruns safely', () => {
  const existing = { inherits: ['base'], entries: [{ path: '/another/skills' }] };
  const config = seed('.gemini/config/skills.json', JSON.stringify(existing));
  const first = json('setup', '--host', 'antigravity', '--yes');
  expect(first.action).toBe('registered');
  expect(existsSync(join(first.installDir, 'skills/start/SKILL.md'))).toBe(true);
  expect(existsSync(join(first.installDir, 'rules.md'))).toBe(true);
  expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
    ...existing, entries: [...existing.entries, { path: join(first.installDir, 'skills') }],
  });
  expect(json('setup', '--yes').action).toBe('unchanged');
  expect(json('doctor')).toMatchObject({ installed: true, registration: { status: 'registered' } });
});

test('setup replaces an old managed release and preserves the host filter', () => {
  const old = join(home, '.config/orbit/releases/0.76.0/plugin/skills');
  const config = seed('.gemini/config/skills.json', JSON.stringify({
    entries: [{ path: old, exclude: ['arena'] }],
  }));
  const next = json('setup', '--yes');
  expect(next.action).toBe('updated');
  expect(next.registration.filtered).toBe(true);
  expect(JSON.parse(readFileSync(config, 'utf8')).entries).toEqual([
    { path: join(next.installDir, 'skills'), exclude: ['arena'] },
  ]);
});

test('setup leaves malformed host config alone and requires explicit consent in scripts', () => {
  const unattended = run('setup');
  expect(unattended.status).toBe(1);
  expect(unattended.stderr).toContain('interactive terminal');
  const config = seed('.gemini/config/skills.json', '{ broken');
  expect(run('setup', '--yes').status).toBe(1);
  expect(readFileSync(config, 'utf8')).toBe('{ broken');
  expect(existsSync(join(home, '.config/orbit/releases'))).toBe(false);
});

test('first model update migrates the legacy file and keeps project cells ahead of user cells', () => {
  const notes = 'Personal settings.\n\n';
  const original = notes + headings + '| advisor | Planning | one/advice | high |\n';
  const legacy = seed('.claude/rules/orbit-models.md', original);
  const project = seed('repo/AGENTS.md', '## Workflow\n\n### Models\n\n' + headings
    + '| advisor | | two/advice | |\n\n## Elsewhere\n' + headings
    + '| code | | ignored/model | |\n');

  const rows = json('models', 'set', 'writing', 'one/model/with-slash', '--effort', 'medium');
  const config = join(home, '.config/orbit/models.md');
  expect(rows.find((row) => row.task === 'advisor')).toMatchObject({
    model: 'two/advice', modelSource: realpathSync(project), effort: 'high', effortSource: config,
  });
  expect(rows.find((row) => row.task === 'writing')).toMatchObject({
    model: 'one/model/with-slash', modelSource: config, use: 'Writing and documentation units',
  });
  expect(rows.find((row) => row.task === 'code').model).toBe('inherit');
  expect(readFileSync(config, 'utf8').startsWith(original)).toBe(true);
  expect(readFileSync(legacy, 'utf8')).toBe(original);
  expect(run('models', 'set', 'writing', 'x/y | invalid').status).toBe(1);
  expect(json('models', 'set', 'writing', '', '--effort', '')
    .find((row) => row.task === 'writing')).toMatchObject({ userModel: '', userEffort: '' });
});
