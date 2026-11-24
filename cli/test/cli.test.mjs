import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
import { checkNpmUpdate, installBundle, pruneReleases, stageRelease } from '../src/bundle.js';

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
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '' },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
}

function runWithEnv(env, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
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

  expect(rows.find((row) => row.task === 'plan')).toMatchObject({
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
  expect(cleared.find((row) => row.task === 'writing')).toMatchObject({
    userTarget: '',
    userEffort: '',
    target: 'inherit',
  });
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
