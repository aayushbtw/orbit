import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  applySkillsRegistration,
  defaultConfigPath,
  formatCheckStatus,
  inspectSkillsConfig,
  removeSkillsRegistration,
} from '../src/antigravity.js';

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-ag-skills-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeOrbitPlugin(root: string, version = '0.74.0'): string {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'orbit', version }, null, 2));
  return join(root, 'skills');
}

function orbit(home: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '', T3_ACP_MCP_NODE: '' },
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('missing file reports file missing, creates config on apply, and second apply is unchanged', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    mkdirSync(home, { recursive: true });
    const skillsDir = makeOrbitPlugin(join(tmp, 'orbit-plugin'));
    const configPath = defaultConfigPath(home);

    const check = inspectSkillsConfig({ configPath, skillsDir, home });
    expect(check).toEqual({ status: 'missing-file', configPath, skillsDir });
    expect(formatCheckStatus(check)).toBe(`not registered (${skillsDir} not in ${configPath}, file missing)`);

    expect(applySkillsRegistration({ configPath, skillsDir, home })).toEqual({ action: 'registered', configPath, skillsDir });
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ entries: [{ path: skillsDir }] });
    expect(applySkillsRegistration({ configPath, skillsDir, home })).toEqual({
      action: 'unchanged',
      configPath,
      skillsDir,
      filtered: false,
    });
  });
});

test('existing file preserves inherits, other entries, and entries with missing or non-string path', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const skillsDir = makeOrbitPlugin(join(tmp, 'orbit-plugin'));
    const otherDir = join(tmp, 'other-skills');
    mkdirSync(otherDir, { recursive: true });
    mkdirSync(dirname(configPath), { recursive: true });
    const entries = [{ path: otherDir, exclude: ['draft'] }, { note: 'missing path' }, { path: 42 }, null];
    writeFileSync(configPath, JSON.stringify({ inherits: ['global'], extraFlag: true, entries }, null, 2));

    const check = inspectSkillsConfig({ configPath, skillsDir, home });
    expect(check).toEqual({ status: 'unregistered', configPath, skillsDir });
    expect(formatCheckStatus(check)).toBe(`not registered (${skillsDir} not in ${configPath})`);

    expect(applySkillsRegistration({ configPath, skillsDir, home }).action).toBe('registered');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
      inherits: ['global'],
      extraFlag: true,
      entries: [...entries, { path: skillsDir }],
    });
  });
});

test('valid object without entries key is unregistered and apply adds entries', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const skillsDir = makeOrbitPlugin(join(tmp, 'orbit-plugin'));
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ inherits: ['defaults'] }, null, 2));

    expect(inspectSkillsConfig({ configPath, skillsDir, home })).toEqual({ status: 'unregistered', configPath, skillsDir });
    expect(applySkillsRegistration({ configPath, skillsDir, home }).action).toBe('registered');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ inherits: ['defaults'], entries: [{ path: skillsDir }] });
  });
});

test('tilde path and trailing slash match canonical skillsDir and detect filtered entries', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const skillsDir = makeOrbitPlugin(join(home, 'orbit-plugin'));
    mkdirSync(dirname(configPath), { recursive: true });

    writeFileSync(configPath, JSON.stringify({ entries: [{ path: '~/orbit-plugin/skills/' }] }, null, 2));
    const unfiltered = inspectSkillsConfig({ configPath, skillsDir, home });
    expect(unfiltered).toEqual({
      status: 'registered',
      configPath,
      skillsDir,
      matchedPath: '~/orbit-plugin/skills/',
      filtered: false,
    });
    expect(formatCheckStatus(unfiltered)).toBe(`registered (~/orbit-plugin/skills/ in ${configPath})`);

    writeFileSync(configPath, JSON.stringify({ entries: [{ path: `${skillsDir}/`, include_only: ['start'] }] }, null, 2));
    const filtered = inspectSkillsConfig({ configPath, skillsDir, home });
    expect(filtered).toMatchObject({ status: 'registered', filtered: true });
    expect(formatCheckStatus(filtered)).toBe(`registered (${skillsDir}/ in ${configPath}, filtered)`);
  });
});

test('stale orbit entries are replaced in place, deduplicated, and preserve filters and non-orbit entries', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const currentSkills = makeOrbitPlugin(join(tmp, 'orbit-new'), '0.75.0');
    const oldOrbitSkills = makeOrbitPlugin(join(tmp, 'orbit-old'), '0.72.0');
    const ghostOrbitSkills = join(home, '.claude', 'plugins', 'cache', 'orbit', 'orbit', '0.73.0', 'skills');
    const otherSkills = join(tmp, 'other-skills');
    mkdirSync(otherSkills, { recursive: true });
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      inherits: ['base'],
      entries: [
        { path: otherSkills },
        { path: oldOrbitSkills, include_only: ['start', 'setup'], exclude: ['debug'] },
        { path: ghostOrbitSkills },
      ],
    }, null, 2));

    const check = inspectSkillsConfig({ configPath, skillsDir: currentSkills, home });
    expect(check).toEqual({ status: 'stale', configPath, skillsDir: currentSkills, stalePaths: [oldOrbitSkills, ghostOrbitSkills] });
    expect(formatCheckStatus(check)).toBe(`stale (${oldOrbitSkills}, ${ghostOrbitSkills} -> ${currentSkills} in ${configPath})`);

    expect(applySkillsRegistration({ configPath, skillsDir: currentSkills, home })).toEqual({
      action: 'updated',
      configPath,
      skillsDir: currentSkills,
      stalePaths: [oldOrbitSkills, ghostOrbitSkills],
    });
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
      inherits: ['base'],
      entries: [
        { path: otherSkills },
        { path: currentSkills, include_only: ['start', 'setup'], exclude: ['debug'] },
      ],
    });
  });
});

test('stale alongside already-present skillsDir drops stale entries without duplicating skillsDir', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const currentSkills = makeOrbitPlugin(join(tmp, 'orbit-new'), '0.75.0');
    const oldOrbitSkills = makeOrbitPlugin(join(tmp, 'orbit-old'), '0.72.0');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ entries: [{ path: oldOrbitSkills }, { path: currentSkills }] }, null, 2));

    expect(inspectSkillsConfig({ configPath, skillsDir: currentSkills, home }).status).toBe('stale');
    expect(applySkillsRegistration({ configPath, skillsDir: currentSkills, home }).action).toBe('updated');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ entries: [{ path: currentSkills }] });
  });
});

test('invalid JSON, non-object root, and non-array entries fail apply without modifying the file', () => {
  for (const raw of ['{ not valid json', 'null\n', '[]\n', '"hello"\n', JSON.stringify({ entries: 'not-an-array' })]) {
    withTempDir((tmp) => {
      const home = join(tmp, 'home');
      const configPath = defaultConfigPath(home);
      const skillsDir = makeOrbitPlugin(join(tmp, 'orbit-plugin'));
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, raw);

      const check = inspectSkillsConfig({ configPath, skillsDir, home });
      expect(check.status).toBe('invalid');
      expect(formatCheckStatus(check)).toMatch(/^invalid \(/);
      expect(() => applySkillsRegistration({ configPath, skillsDir, home })).toThrow(/invalid Antigravity skills config/);
      expect(readFileSync(configPath, 'utf8')).toBe(raw);
    });
  }
});

test('apply fails when skillsDir does not exist or is a file', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const filePath = join(tmp, 'not-a-dir');
    writeFileSync(filePath, 'x');

    expect(() => applySkillsRegistration({ configPath, skillsDir: join(tmp, 'does-not-exist'), home })).toThrow(/does not exist/);
    expect(() => applySkillsRegistration({ configPath, skillsDir: filePath, home })).toThrow(/not a directory/);
    expect(existsSync(configPath)).toBe(false);
  });
});

test('apply updates symlinked skills.json target atomically without breaking the symlink', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const realConfigPath = join(tmp, 'dotfiles', 'skills.json');
    const skillsDir = makeOrbitPlugin(join(tmp, 'orbit-plugin'));
    mkdirSync(dirname(realConfigPath), { recursive: true });
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(realConfigPath, JSON.stringify({ entries: [] }, null, 2));
    symlinkSync(realConfigPath, configPath);

    expect(applySkillsRegistration({ configPath, skillsDir, home }).action).toBe('registered');
    expect(lstatSync(configPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(configPath)).toBe(realpathSync(realConfigPath));
    expect(JSON.parse(readFileSync(realConfigPath, 'utf8'))).toEqual({ entries: [{ path: skillsDir }] });
  });
});

test('orbit doctor detects Antigravity status read-only, and install registers the current bundle', () => {
  withTempDir((tmp) => {
    const homeNoAg = join(tmp, 'home-no-ag');
    mkdirSync(homeNoAg, { recursive: true });
    const noAg = orbit(homeNoAg, 'doctor');
    expect(noAg.hosts.find((h: { host: string }) => h.host === 'antigravity')).toMatchObject({ detected: false, status: 'missing-file' });
    expect(existsSync(join(homeNoAg, '.gemini'))).toBe(false);

    const home = join(tmp, 'home-with-ag');
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
    const before = orbit(home, 'doctor');
    expect(before.hosts.find((h: { host: string }) => h.host === 'antigravity')).toMatchObject({ detected: true, status: 'missing-file' });
    expect(existsSync(defaultConfigPath(home))).toBe(false);

    orbit(home, 'install', '--host', 'antigravity', '--yes');
    const after = orbit(home, 'doctor');
    expect(after.registration).toMatchObject({ status: 'registered', configPath: defaultConfigPath(home) });
    expect(JSON.parse(readFileSync(defaultConfigPath(home), 'utf8'))).toEqual({
      entries: [{ path: join(home, '.config/orbit/current/plugin/skills') }],
    });
  });
});

test('recognizes dangling current symlink path and removeSkillsRegistration preserves non-orbit entries', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const currentSkills = join(home, '.config', 'orbit', 'current', 'plugin', 'skills');
    const liveSkills = makeOrbitPlugin(join(tmp, 'live-plugin'), '0.78.0');
    const otherDir = join(tmp, 'other-skills');
    mkdirSync(otherDir, { recursive: true });
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ inherits: ['global'], entries: [{ path: otherDir }, { path: currentSkills }] }));

    const check = inspectSkillsConfig({ configPath, skillsDir: liveSkills, home });
    expect(check).toMatchObject({ status: 'stale', stalePaths: [currentSkills] });

    expect(removeSkillsRegistration({ configPath, home })).toMatchObject({ action: 'removed', removedPaths: [currentSkills] });
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ inherits: ['global'], entries: [{ path: otherDir }] });
    expect(removeSkillsRegistration({ configPath, home }).action).toBe('unchanged');
  });
});
