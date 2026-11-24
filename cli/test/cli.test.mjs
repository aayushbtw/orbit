import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { checkNpmUpdate, globalOrbitBin, installBundle, pruneReleases, stageRelease } from '../src/bundle.js';

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
const bundleDir = fileURLToPath(new URL('../dist/plugin/', import.meta.url));
const worktreeRoot = fileURLToPath(new URL('../..', import.meta.url));
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
  return runWithEnv({ PATH: '' }, ...args);
}

function runWithEnv(env, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    env: { ...process.env, HOME: home, USERPROFILE: home, T3_ACP_MCP_NODE: '', ...env },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
}

function fakeBin(names) {
  const bin = join(home, 'fakebin');
  const log = join(home, 'fakebin.log');
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${log}"\n`);
    chmodSync(path, 0o755);
  }
  return {
    env: { PATH: bin },
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
  };
}

function jsonWithEnv(env, ...args) {
  const { status, stdout, stderr } = runWithEnv(env, ...args, '--json');
  expect(stderr).toBe('');
  expect(status).toBe(0);
  return JSON.parse(stdout);
}

function skippedHosts(results) {
  return results.filter((h) => h.action === 'skipped').map((h) => h.host).sort();
}

function json(...args) {
  const { status, stdout, stderr } = run(...args, '--json');
  expect(stderr).toBe('');
  expect(status).toBe(0);
  return JSON.parse(stdout);
}

test('setup stages bundle, flips current symlink, registers multi-host targets, and uninstalls cleanly', () => {
  const existing = { inherits: ['base'], entries: [{ path: '/another/skills' }] };
  const agConfig = seed('.gemini/config/skills.json', JSON.stringify(existing));
  seed('.codex/config.toml', '');
  seed('.agents/placeholder', '');

  const first = json('setup', '--host', 'antigravity', '--host', 'codex', '--host', 'agents', '--yes');
  const currentSkills = join(home, '.config/orbit/current/plugin/skills');
  expect(first.action).toBe('registered');
  expect(lstatSync(join(home, '.config/orbit/current')).isSymbolicLink()).toBe(true);
  expect(existsSync(join(first.installDir, 'skills/start/SKILL.md'))).toBe(true);
  expect(existsSync(join(first.installDir, '../.claude-plugin/marketplace.json'))).toBe(true);

  expect(JSON.parse(readFileSync(agConfig, 'utf8'))).toEqual({
    ...existing,
    entries: [...existing.entries, { path: currentSkills }],
  });
  expect(readlinkSync(join(home, '.codex/skills/orbit'))).toBe(currentSkills);
  expect(readlinkSync(join(home, '.agents/skills/orbit'))).toBe(currentSkills);

  expect(json('setup', '--yes').action).toBe('unchanged');
  const doc = json('doctor');
  expect(doc).toMatchObject({
    installed: true,
    healthy: true,
    registration: { status: 'registered' },
  });

  const un = json('uninstall', '--yes');
  expect(un.removedCurrent).toBe(true);
  expect(un.removedReleases).toBe(true);
  expect(existsSync(join(home, '.codex/skills/orbit'))).toBe(false);
  expect(existsSync(join(home, '.agents/skills/orbit'))).toBe(false);
  expect(JSON.parse(readFileSync(agConfig, 'utf8'))).toEqual(existing);
});

test('setup replaces old versioned Antigravity path with current symlink and preserves filters', () => {
  const old = join(home, '.config/orbit/releases/0.76.0/plugin/skills');
  const agConfig = seed('.gemini/config/skills.json', JSON.stringify({
    entries: [{ path: old, exclude: ['arena'] }],
  }));
  const next = json('setup', '--host', 'antigravity', '--yes');
  expect(next.action).toBe('updated');
  expect(next.registration.filtered).toBe(true);
  expect(JSON.parse(readFileSync(agConfig, 'utf8')).entries).toEqual([
    { path: join(home, '.config/orbit/current/plugin/skills'), exclude: ['arena'] },
  ]);
});

test('setup leaves malformed Antigravity config alone and requires TTY without --yes', () => {
  const unattended = run('setup');
  expect(unattended.status).toBe(1);
  expect(unattended.stderr).toContain('interactive terminal');
  const config = seed('.gemini/config/skills.json', '{ broken');
  expect(run('setup', '--host', 'antigravity', '--yes').status).toBe(1);
  expect(readFileSync(config, 'utf8')).toBe('{ broken');
  expect(existsSync(join(home, '.config/orbit/releases'))).toBe(false);
});

test('link, unlink, use, and prune manage releases and current symlink safely', () => {
  stageRelease(bundleDir, home, '0.75.0');
  stageRelease(bundleDir, home, '0.76.0');
  stageRelease(bundleDir, home, '0.77.0');
  installBundle(bundleDir, home, '0.78.0');

  const linked = json('link', worktreeRoot);
  expect(linked.repoPath).toBe(realpathSync(worktreeRoot));
  expect(json('status').bundle).toMatchObject({ linked: true });

  const unlinked = json('unlink');
  expect(unlinked).toMatchObject({ unlinked: true, activeVersion: '0.78.0' });
  expect(json('status').bundle).toMatchObject({ linked: false, activeVersion: '0.78.0' });

  const used = json('use', '0.76.0');
  expect(used.version).toBe('0.76.0');

  const pruned = pruneReleases(home, 2);
  // Keeps 2 newest (0.78.0, 0.77.0) plus currently active 0.76.0; drops 0.75.0.
  expect(pruned).toEqual(['0.75.0']);
  expect(existsSync(join(home, '.config/orbit/releases/0.76.0'))).toBe(true);
  expect(existsSync(join(home, '.config/orbit/releases/0.75.0'))).toBe(false);

  const updateInfo = checkNpmUpdate('0.78.0', '@aayushbtw/orbit', () => '0.79.0');
  expect(updateInfo).toEqual({ currentVersion: '0.78.0', latestVersion: '0.79.0', updateAvailable: true });
});

test('hosts refuses to overwrite a non-orbit skill symlink or directory', () => {
  const customSkill = join(home, 'custom-skill');
  mkdirSync(customSkill, { recursive: true });
  mkdirSync(join(home, '.codex/skills'), { recursive: true });
  symlinkSync(customSkill, join(home, '.codex/skills/orbit'));

  const inspected = json('hosts', 'list');
  const codex = inspected.find((h) => h.host === 'codex');
  expect(codex.status).toBe('invalid');
  expect(run('hosts', 'enable', 'codex').status).toBe(1);
  expect(readlinkSync(join(home, '.codex/skills/orbit'))).toBe(customSkill);
});

test('migrates legacy models.md, strips backticks in AGENTS.md, and layers project overrides', () => {
  const original = 'Personal settings.\n\n' + headings + '| advisor | Planning | one/advice | high |\n';
  const legacy = seed('.claude/rules/orbit-models.md', original);
  const project = seed('repo/AGENTS.md', '## Workflow\n\n### Models\n\n' + headings
    + '| `advisor` | | `two/advice` | |\n'
    + '| `code` | Code edits | `three/coder` | `medium` |\n\n'
    + '## Elsewhere\n' + headings
    + '| code | | ignored/model | |\n');

  const rows = json('models', 'set', 'writing', 'one/model/with-slash', '--effort', 'medium');
  const configPath = join(home, '.config/orbit/config.json');
  expect(existsSync(configPath)).toBe(true);
  expect(readFileSync(legacy, 'utf8')).toBe(original);

  expect(rows.find((row) => row.task === 'advisor')).toMatchObject({
    target: 'two/advice',
    targetSource: realpathSync(project),
    effort: 'high',
    effortSource: configPath,
  });
  expect(rows.find((row) => row.task === 'code')).toMatchObject({
    target: 'three/coder',
    effort: 'medium',
  });
  expect(rows.find((row) => row.task === 'writing')).toMatchObject({
    kind: 'work-type',
    target: 'one/model/with-slash',
    targetSource: configPath,
  });

  // Project .orbit/config.json takes precedence over AGENTS.md and user config
  json('models', 'set', 'code', 'four/override', '--effort', 'high', '--project');
  const afterProject = json('models', 'list');
  expect(afterProject.find((r) => r.task === 'code')).toMatchObject({
    target: 'four/override',
    effort: 'high',
    targetSource: join(realpathSync(workspace), '.orbit/config.json'),
  });

  expect(run('models', 'set', 'writing', 'x/y | invalid').status).toBe(1);
  const cleared = json('models', 'unset', 'writing');
  expect(cleared.find((row) => row.task === 'writing')).toBeUndefined();
});

test('profiles can save, switch, inspect, and delete independently', () => {
  json('models', 'set', 'code', 'codex/gpt-6.2-sol', '--effort', 'medium');
  json('profile', 'save', 'fast-mode');
  json('models', 'set', 'code', 'grok/grok-4.7-build-fast', '--effort', 'low');

  expect(json('models', 'explain', 'code').target).toBe('grok/grok-4.7-build-fast');
  json('profile', 'use', 'default');
  expect(json('models', 'explain', 'code').target).toBe('codex/gpt-6.2-sol');

  const profiles = json('profile', 'list');
  expect(profiles.find((p) => p.name === 'default').active).toBe(true);
  expect(profiles.find((p) => p.name === 'fast-mode').active).toBe(false);

  expect(run('profile', 'delete', 'default').status).toBe(1);
  json('profile', 'delete', 'fast-mode');
  expect(json('profile', 'list').length).toBe(1);
});

test('models sync ingests ACP payloads and orbit init scaffolds AGENTS.md + .orbit/config.json', () => {
  seed('repo/package.json', JSON.stringify({ name: 'demo', scripts: { check: 'vpr check' } }));
  seed('repo/bun.lock', '');
  const capFile = seed('caps.json', JSON.stringify({
    structuredContent: {
      inheritedProviderInstanceId: 'antigravity',
      inheritedModel: 'gemini-pro-orchestrator-neon',
      providers: [
        {
          providerInstanceId: 'codex',
          driverKind: 'codex',
          canRunCrossProviderChildTask: true,
          models: [{ id: 'gpt-6.2-sol', options: [{ id: 'reasoningEffort', values: ['low', 'medium', 'high', 'ultra'] }] }],
        },
      ],
    },
  }));

  const synced = json('models', 'sync', '--from', capFile);
  expect(synced.enabledProviders).toEqual(['codex']);

  const initRes = json('init', '--land', 'pr', '--config', '--yes');
  expect(initRes.updatedAgents).toBe(true);
  expect(initRes.createdConfig).toBe(true);
  const agents = readFileSync(join(workspace, 'AGENTS.md'), 'utf8');
  expect(agents).toContain('## Workflow');
  expect(agents).toContain('- Check: `bun run check`.');
  expect(agents).toContain('- Land: pr');

  // Interactive check without TTY errors clearly
  expect(runWithEnv({ PATH: '' }, 'init').status).toBe(1);
});

test('externally managed Claude and Grok installs are reported and never touched', () => {
  const external = join(home, 'src/orbit');
  mkdirSync(join(external, 'plugin'), { recursive: true });
  const files = [
    seed('.claude/plugins/installed_plugins.json', JSON.stringify({
      plugins: { 'orbit@orbit': [{ scope: 'user', version: '0.70.0', installPath: join(home, '.claude/plugins/cache/orbit/orbit/0.70.0') }] },
    })),
    seed('.claude/plugins/known_marketplaces.json', JSON.stringify({ orbit: { installLocation: external } })),
    seed('.grok/installed-plugins/registry.json', JSON.stringify({ repos: { orbit: { path: join(external, 'plugin') } } })),
  ];
  const snapshot = () => files.map((file) => readFileSync(file, 'utf8'));
  const before = snapshot();
  const fake = fakeBin(['claude', 'grok']);
  const ok = (...args) => jsonWithEnv(fake.env, ...args);

  const oldManifest = join(stageRelease(bundleDir, home, '0.76.0'), 'plugin/.claude-plugin/plugin.json');
  writeFileSync(oldManifest, JSON.stringify({ ...JSON.parse(readFileSync(oldManifest, 'utf8')), version: '0.76.0' }));
  const setup = ok('setup', '--yes');
  expect(skippedHosts(setup.hosts)).toEqual(['claude', 'grok']);
  expect(setup.hosts.find((h) => h.host === 'claude').detail).toContain(`externally managed at ${external}`);

  const listed = ok('hosts', 'list');
  expect(listed.find((h) => h.host === 'claude')).toMatchObject({ status: 'external', path: external });
  expect(listed.find((h) => h.host === 'grok')).toMatchObject({ status: 'external', path: join(external, 'plugin') });

  const explicit = runWithEnv(fake.env, 'setup', '--host', 'claude', '--yes');
  expect(explicit.status).toBe(1);
  expect(explicit.stderr).toContain(`externally managed at ${external}`);
  const enable = runWithEnv(fake.env, 'hosts', 'enable', 'grok');
  expect(enable.status).toBe(1);
  expect(enable.stderr).toContain('does not manage');

  expect(skippedHosts(ok('use', '0.76.0').hosts)).toEqual(['claude', 'grok']);
  expect(skippedHosts(ok('link', worktreeRoot).hosts)).toEqual(['claude', 'grok']);
  expect(skippedHosts(ok('unlink').hosts)).toEqual(['claude', 'grok']);
  ok('use', '0.76.0');
  expect(skippedHosts(ok('update', '0.78.0', '--yes').hosts)).toEqual(['claude', 'grok']);
  expect(skippedHosts(ok('hosts', 'sync', '--all'))).toEqual(['claude', 'grok']);

  const doctor = ok('doctor', '--fix');
  expect(doctor.healthy).toBe(true);
  expect(doctor.fixes.filter((fix) => /claude|grok/.test(fix))).toEqual([]);
  expect(doctor.hosts.filter((h) => h.status === 'external').map((h) => h.host)).toEqual(['claude', 'grok']);

  expect(ok('hosts', 'disable', 'claude', 'grok').map((h) => h.action)).toEqual(['skipped', 'skipped']);
  expect(skippedHosts(ok('uninstall', '--yes').hosts)).toEqual(['claude', 'grok']);
  expect(fake.calls()).toEqual([]);
  expect(snapshot()).toEqual(before);
});

test('an Orbit-managed stale Claude marketplace is still updated and uninstalled', () => {
  seed('.claude/plugins/installed_plugins.json', JSON.stringify({
    plugins: { 'orbit@orbit': [{ scope: 'user', version: '0.70.0' }] },
  }));
  seed('.claude/plugins/known_marketplaces.json', JSON.stringify({
    orbit: { installLocation: join(home, '.config/orbit/releases/0.70.0') },
  }));
  const fake = fakeBin(['claude']);
  const setup = jsonWithEnv(fake.env, 'setup', '--yes');
  expect(setup.hosts.find((h) => h.host === 'claude').action).toBe('updated');
  expect(fake.calls()).toEqual([
    'claude plugin marketplace remove orbit',
    `claude plugin marketplace add ${join(home, '.config/orbit/current')}`,
    'claude plugin update orbit@orbit',
  ]);
  jsonWithEnv(fake.env, 'uninstall', '--yes');
  expect(fake.calls().at(-1)).toBe('claude plugin uninstall orbit@orbit');
});

test('update takes [targetVersion] or --to instead of colliding with --version', () => {
  const expected = { currentVersion: '0.78.0', latestVersion: '0.79.0', updateAvailable: true };
  expect(json('update', '0.79.0', '--check')).toEqual(expected);
  expect(json('update', '--to', 'v0.79.0', '--check')).toEqual(expected);
  expect(json('update', 'v0.79.0', '--to', '0.79.0', '--check')).toEqual(expected);

  const conflict = run('update', '0.79.0', '--to', '0.80.0', '--check');
  expect(conflict.status).toBe(1);
  expect(conflict.stderr).toContain('Conflicting target versions');
  const invalid = run('update', 'newest', '--check');
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain('Invalid target version');
  expect(run('--version').stdout.trim()).toBe('0.78.0');
  expect(run('update', '--help').stdout).toContain('--to <version>');
});

test('globalOrbitBin resolves the npm global prefix bin and falls back to orbit', () => {
  const prefix = join(home, 'npm-global');
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  writeFileSync(join(prefix, 'bin', 'orbit'), '');
  const calls = [];
  expect(globalOrbitBin((cmd, args) => {
    calls.push([cmd, ...args]);
    return `${prefix}\n`;
  }, 'darwin')).toBe(join(prefix, 'bin', 'orbit'));
  expect(calls).toEqual([['npm', 'prefix', '-g']]);
  expect(globalOrbitBin(() => join(home, 'missing'), 'darwin')).toBe('orbit');
  expect(globalOrbitBin(() => { throw new Error('npm missing'); }, 'darwin')).toBe('orbit');
});

test('stageRelease replaces a partial release left by an interrupted run', () => {
  const partial = join(home, '.config/orbit/releases/0.78.0');
  mkdirSync(join(partial, 'plugin/skills'), { recursive: true });
  writeFileSync(join(partial, 'plugin/leftover.txt'), 'partial');

  expect(stageRelease(bundleDir, home, '0.78.0')).toBe(partial);
  expect(existsSync(join(partial, 'plugin/skills/start/SKILL.md'))).toBe(true);
  expect(existsSync(join(partial, 'plugin/leftover.txt'))).toBe(false);
  expect(readdirSync(join(home, '.config/orbit/releases')).filter((name) => name.startsWith('.stage-'))).toEqual([]);
});

test('malformed .orbit/config.json is reported by status and doctor instead of crashing', () => {
  const bad = seed('repo/.orbit/config.json', '{ broken');
  expect(json('status').projectConfigError).toContain(join('.orbit', 'config.json'));

  const doctor = json('doctor');
  expect(doctor.healthy).toBe(false);
  expect(doctor.projectConfigError).toContain(join('.orbit', 'config.json'));
  expect(doctor.issues.some((issue) => issue.startsWith('project config:'))).toBe(true);

  const edit = run('models', 'set', 'code', 'x/y', '--project');
  expect(edit.status).toBe(1);
  expect(edit.stderr).toContain('Fix or reset');
  expect(readFileSync(bad, 'utf8')).toBe('{ broken');

  seed('repo/.orbit/config.json', JSON.stringify({ tasks: [] }));
  expect(json('status').projectConfigError).toContain('tasks must be an object');
  expect(json('models', 'reset', '--project', '--yes').find((r) => r.task === 'code').target).toBe('inherit');
  expect(json('status').projectConfigError).toBeUndefined();
});

test('CLI role names, defaults and config sources match what plugin rules tell the lead', () => {
  const rules = readFileSync(join(worktreeRoot, 'plugin/rules.md'), 'utf8');
  for (const file of ['plugin/rules.md', 'plugin/skills/rules/SKILL.md', 'plugin/skills/setup/SKILL.md']) {
    expect(readFileSync(join(worktreeRoot, file), 'utf8')).toContain('~/.config/orbit/config.json');
  }
  expect(rules).toContain('orbit models resolve <task> --json');

  const defaults = Object.fromEntries(json('models', 'list').map((row) => [row.task, row]));
  for (const role of ['gitops', 'verifier', 'advisor', 'judgment', 'code', 'other-family']) {
    expect(defaults[role]).toBeDefined();
  }
  const ruleDefaults = [...rules.matchAll(/`([a-z-]+)` defaults to `([a-z]+)`/g)];
  expect(ruleDefaults.map(([, role]) => role)).toEqual(['judgment', 'code']);
  for (const [, role, model] of ruleDefaults) expect(defaults[role].target).toBe(model);

  seed('.config/orbit/models.md', 'Written by /orbit:setup.\n\n' + headings
    + '| other-family | Panel seat | codex, grok, inherit | |\n'
    + '| verifier | Pre-land verifier | other-family, inherit | |\n'
    + '| judgment | | claudeAgent/claude-opus-5-5 | high |\n');
  const legacy = json('models', 'list');
  expect(legacy.find((r) => r.task === 'verifier')).toMatchObject({ target: 'other-family, inherit', onAllFailed: 'inherit' });
  expect(legacy.find((r) => r.task === 'judgment')).toMatchObject({ target: 'claudeAgent/claude-opus-5-5', effort: 'high' });
  expect(legacy.find((r) => r.task === 'other-family')).toMatchObject({ target: 'codex, grok, inherit' });

  json('models', 'set', 'gitops', 'claudeAgent/claude-sonnet-5-5', '--effort', 'low');
  json('models', 'set', 'hard', 'claudeAgent/claude-fable-5-2');
  const saved = JSON.parse(readFileSync(join(home, '.config/orbit/config.json'), 'utf8'));
  expect(Object.keys(saved.profiles.default.tasks).sort()).toEqual(['gitops', 'judgment', 'verifier']);
  expect(saved.profiles.default.panels['other-family']).toEqual(['codex', 'grok', 'inherit']);
  expect(json('models', 'resolve', 'judgment').target).toMatchObject({ model: 'claude-fable-5-2' });

  seed('.config/orbit/config.json', JSON.stringify({
    version: 1,
    activeProfile: 'default',
    profiles: { default: { tasks: { hard: { target: 'a/b' }, writing: { target: 'c/d' } }, panels: {}, workTypes: [] } },
  }));
  const renamed = json('models', 'list');
  expect(renamed.find((r) => r.task === 'judgment').target).toBe('a/b');
  expect(renamed.find((r) => r.task === 'writing')).toMatchObject({ kind: 'work-type', target: 'c/d' });
});
