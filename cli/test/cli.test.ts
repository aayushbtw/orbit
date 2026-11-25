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
import { checkNpmUpdate, globalOrbitBin, installBundle, pruneReleases, runGlobalOrbitInstall, stageRelease } from '../src/bundle.js';
import { setConfigHosts } from '../src/config.js';
import { RULES_BLOCK } from '../src/hosts.js';
const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
const bundleDir = fileURLToPath(new URL('../dist/plugin/', import.meta.url));
const worktreeRoot = fileURLToPath(new URL('../..', import.meta.url));
const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const nextVersion = version.replace(/^(\d+)\.(\d+)\.\d+$/, (_, major, minor) => `${major}.${Number(minor) + 1}.0`);
type Row = { host: string; action: string };
type Item = Record<string, any>;
const headings = '| Task | Use for | Model | Effort |\n| --- | --- | --- | --- |\n';
let home: string;
let workspace: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orbit-cli-test-'));
  workspace = join(home, 'repo');
  mkdirSync(workspace);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function seed(file: string, content: string): string {
  const path = join(home, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function run(...args: string[]) {
  return runWithEnv({ PATH: '' }, ...args);
}

function runWithEnv(env: Record<string, string>, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    env: { ...process.env, HOME: home, USERPROFILE: home, T3_ACP_MCP_NODE: '', CODEX_HOME: '', GROK_HOME: '', ...env },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
}

function fakeBin(names: string[]) {
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

function jsonWithEnv(env: Record<string, string>, ...args: string[]) {
  const { status, stdout, stderr } = runWithEnv(env, ...args, '--json');
  expect(stderr).toBe('');
  expect(status).toBe(0);
  return JSON.parse(stdout);
}

const skillNames = readdirSync(join(bundleDir, 'skills')).filter((name) => existsSync(join(bundleDir, 'skills', name, 'SKILL.md'))).sort();

function expectSkillLinks(dir: string): void {
  const currentSkills = join(home, '.config/orbit/current/plugin/skills');
  for (const name of skillNames) expect(readlinkSync(join(dir, name))).toBe(join(currentSkills, name));
}

function hostRow(rows: Item[], host: string): Item {
  return rows.find((h) => h.host === host)!;
}

function json(...args: string[]) {
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
  expect(existsSync(join(first.installDir, 'manifest.json'))).toBe(true);

  expect(JSON.parse(readFileSync(agConfig, 'utf8'))).toEqual({
    ...existing,
    entries: [...existing.entries, { path: currentSkills }],
  });
  expect(readlinkSync(join(home, '.codex/skills/orbit'))).toBe(currentSkills);
  expect(readlinkSync(join(home, '.agents/skills/orbit'))).toBe(currentSkills);
  expect(readFileSync(join(home, '.codex/AGENTS.md'), 'utf8')).toBe(`${RULES_BLOCK}\n`);
  expect(readFileSync(join(home, '.gemini/config/AGENTS.md'), 'utf8')).toBe(`${RULES_BLOCK}\n`);
  expect(existsSync(join(home, '.agents/AGENTS.md'))).toBe(false);

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
  expect(existsSync(join(home, '.codex/AGENTS.md'))).toBe(false);
  expect(existsSync(join(home, '.gemini/config/AGENTS.md'))).toBe(false);
  expect(JSON.parse(readFileSync(agConfig, 'utf8'))).toEqual(existing);
});

test('the rules line is one marked block that leaves the rest of each instructions file alone, byte for byte', () => {
  const userText = '# Mine\n\nKeep replies short.\n';
  const codexRules = seed('.codex/AGENTS.md', userText);
  const dotfile = seed('dotfiles/gemini.md', 'Gemini notes.');
  const geminiRules = join(home, '.gemini/config/AGENTS.md');
  mkdirSync(dirname(geminiRules), { recursive: true });
  symlinkSync(dotfile, geminiRules);
  const withBlock = `${userText}\n${RULES_BLOCK}\n`;
  expect(run('hosts', 'list').stdout).not.toContain('rules line missing');

  json('setup', '--host', 'codex', '--host', 'antigravity', '--yes');
  expect(readFileSync(codexRules, 'utf8')).toBe(withBlock);
  expect(lstatSync(geminiRules).isSymbolicLink()).toBe(true);
  expect(readFileSync(dotfile, 'utf8')).toBe(`Gemini notes.\n${RULES_BLOCK}\n`);

  expect(json('hosts', 'enable', 'codex')[0].action).toBe('unchanged');
  expect(readFileSync(codexRules, 'utf8')).toBe(withBlock);

  writeFileSync(codexRules, withBlock.replace('first reply', 'reply'));
  expect(json('hosts', 'list').find((h: Item) => h.host === 'codex').rules).toEqual({ path: codexRules, present: false });
  const listed = run('hosts', 'list').stdout.split('\n').filter((line) => line.includes('rules line missing'));
  expect(listed).toEqual([expect.stringMatching(new RegExp(`^codex: .*; rules line missing from ${codexRules}$`))]);
  const drift = json('doctor');
  expect(drift.healthy).toBe(false);
  expect(drift.issues).toContain(`codex: orbit rules line missing from ${codexRules}`);
  const fixed = json('doctor', '--fix');
  expect(fixed.fixes).toContain('codex: updated');
  expect(fixed.healthy).toBe(true);
  expect(readFileSync(codexRules, 'utf8')).toBe(withBlock);

  writeFileSync(codexRules, `${userText}<!-- orbit:rules:start -->\nedited\n`);
  const broken = run('hosts', 'enable', 'codex');
  expect(broken.status).toBe(1);
  expect(broken.stderr).toContain('<!-- orbit:rules:end -->');
  writeFileSync(codexRules, withBlock);

  expect(json('hosts', 'disable', 'codex')[0].action).toBe('removed');
  expect(readFileSync(codexRules, 'utf8')).toBe(userText);
  json('uninstall', '--yes');
  expect(lstatSync(geminiRules).isSymbolicLink()).toBe(true);
  expect(readFileSync(dotfile, 'utf8')).toBe('Gemini notes.');
});

test('codex and grok paths follow CODEX_HOME and GROK_HOME', () => {
  const codexHome = join(home, 'codex-home');
  const grokHome = join(home, 'grok-home');
  const env = { PATH: '', CODEX_HOME: codexHome, GROK_HOME: grokHome };

  jsonWithEnv(env, 'setup', '--host', 'codex', '--host', 'grok', '--yes');
  expect(readlinkSync(join(codexHome, 'skills/orbit'))).toBe(join(home, '.config/orbit/current/plugin/skills'));
  expectSkillLinks(join(grokHome, 'skills'));
  expect(readFileSync(join(codexHome, 'AGENTS.md'), 'utf8')).toBe(`${RULES_BLOCK}\n`);
  expect(readFileSync(join(grokHome, 'AGENTS.md'), 'utf8')).toBe(`${RULES_BLOCK}\n`);
  expect(existsSync(join(home, '.codex'))).toBe(false);
  expect(existsSync(join(home, '.grok'))).toBe(false);

  const rows: Item[] = jsonWithEnv(env, 'hosts', 'list');
  expect(hostRow(rows, 'grok')).toMatchObject({ status: 'registered', path: join(grokHome, 'skills'), rules: { path: join(grokHome, 'AGENTS.md'), present: true } });
  expect(hostRow(rows, 'codex')).toMatchObject({ status: 'registered', path: join(codexHome, 'skills/orbit') });

  jsonWithEnv(env, 'hosts', 'disable', 'codex', 'grok');
  expect(existsSync(join(codexHome, 'skills/orbit'))).toBe(false);
  expect(readdirSync(join(grokHome, 'skills'))).toEqual([]);
  expect(existsSync(join(codexHome, 'AGENTS.md'))).toBe(false);
  expect(existsSync(join(grokHome, 'AGENTS.md'))).toBe(false);
});

test('claude and grok get one symlink per skill and the same rules block, and disable removes both', () => {
  const ownSkill = seed('.claude/skills/own/SKILL.md', 'mine');
  const userRules = '# Mine\n';
  const claudeRules = seed('.claude/CLAUDE.md', userRules);
  const grokRules = join(home, '.grok/AGENTS.md');

  const setup = json('setup', '--host', 'claude', '--host', 'grok', '--yes');
  expect(setup.hosts.map((h: Row) => h.action)).toEqual(['registered', 'registered']);
  expectSkillLinks(join(home, '.claude/skills'));
  expectSkillLinks(join(home, '.grok/skills'));
  expect(readFileSync(claudeRules, 'utf8')).toBe(`${userRules}\n${RULES_BLOCK}\n`);
  expect(readFileSync(grokRules, 'utf8')).toBe(`${RULES_BLOCK}\n`);

  const rows: Item[] = json('hosts', 'list');
  expect(hostRow(rows, 'claude')).toMatchObject({ status: 'registered', rules: { path: claudeRules, present: true } });
  expect(hostRow(rows, 'grok')).toMatchObject({ status: 'registered', rules: { path: grokRules, present: true } });
  expect(json('hosts', 'sync').map((h: Row) => h.action)).toEqual(['unchanged', 'unchanged']);

  expect(json('hosts', 'disable', 'claude', 'grok').map((h: Row) => h.action)).toEqual(['removed', 'removed']);
  expect(readdirSync(join(home, '.claude/skills'))).toEqual(['own']);
  expect(readFileSync(ownSkill, 'utf8')).toBe('mine');
  expect(readdirSync(join(home, '.grok/skills'))).toEqual([]);
  expect(readFileSync(claudeRules, 'utf8')).toBe(userRules);
  expect(existsSync(grokRules)).toBe(false);
});

test('a non-orbit skill with an orbit skill name blocks claude before any symlink is written', () => {
  const collision = seed('.claude/skills/start/SKILL.md', 'my own start');

  const setup = run('setup', '--host', 'claude', '--yes');
  expect(setup.status).toBe(1);
  expect(setup.stderr).toContain(join(home, '.claude/skills/start'));
  expect(readdirSync(join(home, '.claude/skills'))).toEqual(['start']);
  expect(existsSync(join(home, '.config/orbit/releases'))).toBe(false);

  json('setup', '--host', 'codex', '--yes');
  expect(hostRow(json('hosts', 'list'), 'claude').status).toBe('invalid');
  expect(run('hosts', 'enable', 'claude').status).toBe(1);
  expect(readdirSync(join(home, '.claude/skills'))).toEqual(['start']);
  expect(readFileSync(collision, 'utf8')).toBe('my own start');
  expect(existsSync(join(home, '.claude/CLAUDE.md'))).toBe(false);
});

test('sync repoints and prunes orbit skill links and leaves every other entry alone', () => {
  json('setup', '--host', 'claude', '--yes');
  const skills = join(home, '.claude/skills');
  const custom = join(home, 'custom-skill');
  mkdirSync(custom);
  symlinkSync(custom, join(skills, 'mine'));
  seed('.claude/skills/own/SKILL.md', 'mine');
  rmSync(join(skills, 'start'));
  symlinkSync(join(home, '.config/orbit/releases/0.1.0/plugin/skills/start'), join(skills, 'start'));
  symlinkSync(join(home, '.config/orbit/current/plugin/skills/retired'), join(skills, 'retired'));

  const stale = hostRow(json('hosts', 'list'), 'claude');
  expect(stale.status).toBe('stale');
  expect(stale.stalePaths).toEqual([join(skills, 'start'), join(skills, 'retired')]);

  expect(json('hosts', 'sync')[0].action).toBe('updated');
  expectSkillLinks(skills);
  expect(existsSync(join(skills, 'retired'))).toBe(false);
  expect(readlinkSync(join(skills, 'mine'))).toBe(custom);
  expect(hostRow(json('hosts', 'list'), 'claude').status).toBe('registered');

  json('uninstall', '--yes');
  expect(readdirSync(skills).sort()).toEqual(['mine', 'own']);
});

test('a legacy claude or grok orbit plugin is reported as stale with its uninstall command, and neither CLI runs', () => {
  seed('.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'orbit@orbit': [{ scope: 'user', version: '0.70.0' }] } }));
  seed('.grok/installed-plugins/registry.json', JSON.stringify({ version: 1, repos: { 'plugin-1': { plugins: { orbit: { version: '0.70.0' } } } } }));
  const fake = fakeBin(['claude', 'grok']);
  const ok = (...args: string[]) => jsonWithEnv(fake.env, ...args);
  const claudeCmd = 'claude plugin uninstall orbit@orbit';
  const grokCmd = 'grok plugin uninstall orbit';

  const before: Item[] = ok('hosts', 'list');
  expect(hostRow(before, 'claude')).toMatchObject({ detected: true, status: 'stale' });
  expect(hostRow(before, 'claude').detail).toContain(claudeCmd);
  expect(hostRow(before, 'grok')).toMatchObject({ detected: true, status: 'stale' });
  expect(hostRow(before, 'grok').detail).toContain(grokCmd);

  const setup = ok('setup', '--host', 'claude', '--host', 'grok', '--yes');
  expect(hostRow(setup.hosts, 'claude')).toMatchObject({ action: 'registered', command: claudeCmd });
  expect(hostRow(setup.hosts, 'grok')).toMatchObject({ action: 'registered', command: grokCmd });
  expectSkillLinks(join(home, '.claude/skills'));
  expectSkillLinks(join(home, '.grok/skills'));

  const after: Item[] = ok('hosts', 'list');
  expect(hostRow(after, 'claude').status).toBe('stale');
  expect(hostRow(after, 'claude').stalePaths).toBeUndefined();
  const doctor = ok('doctor');
  expect(doctor.issues).toEqual(expect.arrayContaining([expect.stringContaining(claudeCmd), expect.stringContaining(grokCmd)]));

  const removed = ok('hosts', 'disable', 'claude', 'grok');
  expect(removed.map((h: Item) => h.command)).toEqual([claudeCmd, grokCmd]);
  expect(readdirSync(join(home, '.claude/skills'))).toEqual([]);
  expect(fake.calls()).toEqual([]);
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
  stageRelease(bundleDir, home, '0.76.0');
  stageRelease(bundleDir, home, '0.77.0');
  stageRelease(bundleDir, home, '0.78.0');
  installBundle(bundleDir, home, version);

  const linked = json('link', worktreeRoot);
  expect(linked.repoPath).toBe(realpathSync(worktreeRoot));
  expect(json('status').bundle).toMatchObject({ linked: true });

  const unlinked = json('unlink');
  expect(unlinked).toMatchObject({ unlinked: true, activeVersion: version });
  expect(json('status').bundle).toMatchObject({ linked: false, activeVersion: version });

  const used = json('use', '0.77.0');
  expect(used.version).toBe('0.77.0');

  const pruned = pruneReleases(home, 2);
  // Keeps the 2 newest (the packaged version and 0.78.0) plus the active 0.77.0, and drops 0.76.0.
  expect(pruned).toEqual(['0.76.0']);
  expect(existsSync(join(home, '.config/orbit/releases/0.77.0'))).toBe(true);
  expect(existsSync(join(home, '.config/orbit/releases/0.76.0'))).toBe(false);

  const updateInfo = checkNpmUpdate('0.79.0', '@aayushbtw/orbit', () => '0.80.0');
  expect(updateInfo).toEqual({ currentVersion: '0.79.0', latestVersion: '0.80.0', updateAvailable: true });
});

test('hosts refuses to overwrite a non-orbit skill symlink or directory', () => {
  const customSkill = join(home, 'custom-skill');
  mkdirSync(customSkill, { recursive: true });
  mkdirSync(join(home, '.codex/skills'), { recursive: true });
  symlinkSync(customSkill, join(home, '.codex/skills/orbit'));

  const inspected = json('hosts', 'list');
  const codex = inspected.find((h: Item) => h.host === 'codex');
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

  expect(rows.find((row: Item) => row.task === 'advisor')).toMatchObject({
    target: 'two/advice',
    targetSource: realpathSync(project),
    effort: 'high',
    effortSource: configPath,
  });
  expect(rows.find((row: Item) => row.task === 'code')).toMatchObject({
    target: 'three/coder',
    effort: 'medium',
  });
  expect(rows.find((row: Item) => row.task === 'writing')).toMatchObject({
    kind: 'work-type',
    target: 'one/model/with-slash',
    targetSource: configPath,
  });

  // Project .orbit/config.json takes precedence over AGENTS.md and user config
  json('models', 'set', 'code', 'four/override', '--effort', 'high', '--project');
  const afterProject = json('models', 'list');
  expect(afterProject.find((r: Item) => r.task === 'code')).toMatchObject({
    target: 'four/override',
    effort: 'high',
    targetSource: join(realpathSync(workspace), '.orbit/config.json'),
  });

  expect(run('models', 'set', 'writing', 'x/y | invalid').status).toBe(1);
  const cleared = json('models', 'unset', 'writing');
  expect(cleared.find((row: Item) => row.task === 'writing')).toBeUndefined();
});

test('profiles can save, switch, inspect, and delete independently', () => {
  json('models', 'set', 'code', 'codex/gpt-6.2-sol', '--effort', 'medium');
  json('profile', 'save', 'fast-mode');
  json('models', 'set', 'code', 'grok/grok-4.7-build-fast', '--effort', 'low');

  expect(json('models', 'explain', 'code').target).toBe('grok/grok-4.7-build-fast');
  json('profile', 'use', 'default');
  expect(json('models', 'explain', 'code').target).toBe('codex/gpt-6.2-sol');

  const profiles = json('profile', 'list');
  expect(profiles.find((p: Item) => p.name === 'default').active).toBe(true);
  expect(profiles.find((p: Item) => p.name === 'fast-mode').active).toBe(false);

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

test('update takes [targetVersion] or --to instead of colliding with --version', () => {
  const expected = { currentVersion: version, latestVersion: nextVersion, updateAvailable: true };
  expect(json('update', nextVersion, '--check')).toEqual(expected);
  expect(json('update', '--to', `v${nextVersion}`, '--check')).toEqual(expected);
  expect(json('update', `v${nextVersion}`, '--to', nextVersion, '--check')).toEqual(expected);

  const conflict = run('update', nextVersion, '--to', '9.9.9', '--check');
  expect(conflict.status).toBe(1);
  expect(conflict.stderr).toContain('Conflicting target versions');
  const invalid = run('update', 'newest', '--check');
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain('Invalid target version');
  expect(run('--version').stdout.trim()).toBe(version);
  expect(run('update', '--help').stdout).toContain('--to <version>');
});

test('globalOrbitBin resolves the npm global prefix bin and falls back to orbit', () => {
  const prefix = join(home, 'npm-global');
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  writeFileSync(join(prefix, 'bin', 'orbit'), '');
  const calls: string[][] = [];
  expect(globalOrbitBin((cmd, args) => {
    calls.push([cmd, ...args]);
    return `${prefix}\n`;
  }, 'darwin')).toBe(join(prefix, 'bin', 'orbit'));
  expect(calls).toEqual([['npm', 'prefix', '-g']]);
  expect(globalOrbitBin(() => join(home, 'missing'), 'darwin')).toBe('orbit');
  expect(globalOrbitBin(() => { throw new Error('npm missing'); }, 'darwin')).toBe('orbit');
});

test('update runs the global orbit with piped stdout, inherited stderr, and a shell only on Windows', () => {
  const calls: unknown[][] = [];
  const fake = (file: string, args: string[], options: object) => {
    calls.push([file, args, options]);
    return '{"ok":true}';
  };
  expect(runGlobalOrbitInstall('/npm/bin/orbit', fake, 'darwin')).toBe('{"ok":true}');
  expect(runGlobalOrbitInstall('C:\\npm global\\orbit.cmd', fake, 'win32')).toBe('{"ok":true}');
  const stdio = ['ignore', 'pipe', 'inherit'];
  expect(calls).toEqual([
    ['/npm/bin/orbit', ['install', '--yes', '--json'], { encoding: 'utf8', stdio, shell: false }],
    ['"C:\\npm global\\orbit.cmd"', ['install', '--yes', '--json'], { encoding: 'utf8', stdio, shell: true }],
  ]);
});

test('setup doctor.sh is read-only, needs no bun or watch-pr, and points at the orbit CLI', () => {
  const doctor = join(worktreeRoot, 'plugin/skills/setup/scripts/doctor.sh');
  const res = spawnSync('bash', [doctor], { cwd: workspace, env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  expect(res.status).toBe(0);
  expect(res.stdout).toMatch(/^orbit missing\. Install: npm install -g @aayushbtw\/orbit, then orbit setup$/m);
  expect(res.stdout).not.toMatch(/bun|watch-pr|antigravity/);
  expect(readdirSync(home)).toEqual(['repo']);
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
  expect(doctor.issues.some((issue: string) => issue.startsWith('project config:'))).toBe(true);

  const edit = run('models', 'set', 'code', 'x/y', '--project');
  expect(edit.status).toBe(1);
  expect(edit.stderr).toContain('Fix or reset');
  expect(readFileSync(bad, 'utf8')).toBe('{ broken');

  seed('repo/.orbit/config.json', JSON.stringify({ tasks: [] }));
  expect(json('status').projectConfigError).toContain('tasks must be an object');
  expect(json('models', 'reset', '--project', '--yes').find((r: Item) => r.task === 'code').target).toBe('inherit');
  expect(json('status').projectConfigError).toBeUndefined();
});

test('malformed legacy models.md is reported and healed by models set instead of crashing', () => {
  const legacy = seed('.config/orbit/models.md', headings + '| interrogate | x | judgment, codex | |\n');
  const status = json('status');
  expect(status.legacyConfigError).toContain(legacy);
  expect(status.legacyConfigError).toContain('Invalid interrogate seat "codex"');
  expect(status.configSource).toBeNull();

  const doctor = json('doctor');
  expect(doctor.healthy).toBe(false);
  expect(doctor.legacyConfigError).toContain(legacy);
  expect(doctor.issues.some((issue: string) => issue.startsWith('legacy config:') && issue.includes(legacy))).toBe(true);

  expect(json('models', 'list').find((r: Item) => r.task === 'interrogate').target).toBe('judgment, other-family');
  expect(json('doctor', '--fix').fixes.some((fix: string) => fix.startsWith('migrated'))).toBe(false);

  const healed = json('models', 'set', 'interrogate', 'judgment, other-family');
  expect(healed.find((r: Item) => r.task === 'interrogate').targetSource).toBe(join(home, '.config/orbit/config.json'));
  expect(json('status').legacyConfigError).toBeUndefined();
  expect(json('doctor').legacyConfigError).toBeUndefined();
  expect(readFileSync(legacy, 'utf8')).toContain('judgment, codex');
});

test('hosts enable, hosts disable and setConfigHosts refuse to drop a malformed legacy models.md', () => {
  const legacyText = headings + '| interrogate | x | judgment, codex | |\n';
  const legacy = seed('.config/orbit/models.md', legacyText);
  const configPath = join(home, '.config/orbit/config.json');
  for (const args of [['hosts', 'enable', 'codex'], ['hosts', 'disable', 'codex']]) {
    const { status, stderr } = run(...args);
    expect(status).toBe(1);
    expect(stderr).toContain(legacy);
    expect(stderr).toContain('orbit models reset');
  }
  expect(() => setConfigHosts(home, ['codex'])).toThrow(legacy);
  expect(existsSync(configPath)).toBe(false);
  expect(existsSync(join(home, '.codex'))).toBe(false);
  expect(readFileSync(legacy, 'utf8')).toBe(legacyText);
  expect(json('status').legacyConfigError).toContain(legacy);
});

test('CLI role names, defaults and config sources match what plugin rules tell the lead', () => {
  const rules = readFileSync(join(worktreeRoot, 'plugin/rules.md'), 'utf8');
  for (const file of ['plugin/rules.md', 'plugin/skills/rules/SKILL.md', 'plugin/skills/setup/SKILL.md']) {
    expect(readFileSync(join(worktreeRoot, file), 'utf8')).toContain('~/.config/orbit/config.json');
  }
  expect(rules).toContain('orbit models resolve <task> --json');

  const defaults = Object.fromEntries(json('models', 'list').map((row: Item) => [row.task, row]));
  for (const role of ['gitops', 'verifier', 'advisor', 'judgment', 'code', 'other-family']) {
    expect(defaults[role]).toBeDefined();
  }
  expect(rules).toContain('All five roles default to `inherit`');
  expect(rules).not.toMatch(/defaults to `(?:opus|sonnet|haiku|fable)`/);
  for (const role of ['gitops', 'verifier', 'advisor', 'judgment', 'code']) expect(defaults[role].target).toBe('inherit');

  seed('.config/orbit/models.md', 'Written by /orbit:setup.\n\n' + headings
    + '| other-family | Panel seat | codex, grok, inherit | |\n'
    + '| verifier | Pre-land verifier | other-family, inherit | |\n'
    + '| judgment | | claudeAgent/claude-opus-5-5 | high |\n');
  const legacy = json('models', 'list');
  expect(legacy.find((r: Item) => r.task === 'verifier')).toMatchObject({ target: 'other-family, inherit', onAllFailed: 'inherit' });
  expect(legacy.find((r: Item) => r.task === 'judgment')).toMatchObject({ target: 'claudeAgent/claude-opus-5-5', effort: 'high' });
  expect(legacy.find((r: Item) => r.task === 'other-family')).toMatchObject({ target: 'codex, grok, inherit' });

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
  expect(renamed.find((r: Item) => r.task === 'judgment').target).toBe('a/b');
  expect(renamed.find((r: Item) => r.task === 'writing')).toMatchObject({ kind: 'work-type', target: 'c/d' });
});
