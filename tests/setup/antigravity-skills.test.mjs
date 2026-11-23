import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applySkillsRegistration,
  defaultConfigPath,
  formatCheckStatus,
  inspectSkillsConfig,
} from '../../plugin/skills/setup/scripts/antigravity-skills.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const scriptPath = join(repoRoot, 'plugin/skills/setup/scripts/antigravity-skills.mjs');
const doctorPath = join(repoRoot, 'plugin/skills/setup/scripts/doctor.sh');

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-ag-skills-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeOrbitPlugin(root, version = '0.74.0') {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'orbit', version }, null, 2),
  );
  return join(root, 'skills');
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function buildFakeBin(binDir) {
  mkdirSync(binDir, { recursive: true });
  symlinkSync(process.execPath, join(binDir, 'node'));
  for (const name of ['bash', 'dirname', 'uname', 'head', 'grep', 'jq']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0) {
      const target = found.stdout.trim();
      if (target) symlinkSync(target, join(binDir, name));
    }
  }
}

test('missing file reports file missing, creates config on apply, and second apply is unchanged', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    mkdirSync(home, { recursive: true });
    const skillsDir = makeOrbitPlugin(join(tmp, 'orbit-plugin'));
    const configPath = defaultConfigPath(home);

    const check = inspectSkillsConfig({ configPath, skillsDir, home });
    assert.deepEqual(check, { status: 'missing-file', configPath, skillsDir });
    assert.equal(
      formatCheckStatus(check),
      `not registered (${skillsDir} not in ${configPath}, file missing)`,
    );

    const cliCheck = runCli(['--check', '--skills-dir', skillsDir, '--config', configPath], { HOME: home });
    assert.equal(cliCheck.status, 0, cliCheck.stderr);
    assert.equal(cliCheck.stdout.trim(), formatCheckStatus(check));

    const firstApply = runCli(['--apply', '--skills-dir', skillsDir, '--config', configPath], { HOME: home });
    assert.equal(firstApply.status, 0, firstApply.stderr);
    assert.match(firstApply.stdout.trim(), /^registered /);

    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(written, { entries: [{ path: skillsDir }] });

    const secondApply = applySkillsRegistration({ configPath, skillsDir, home });
    assert.deepEqual(secondApply, {
      action: 'unchanged',
      configPath,
      skillsDir,
      filtered: false,
    });

    const cliSecond = runCli(['--apply', '--skills-dir', skillsDir, '--config', configPath], { HOME: home });
    assert.equal(cliSecond.status, 0, cliSecond.stderr);
    assert.match(cliSecond.stdout.trim(), /^unchanged /);
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

    const initial = {
      inherits: ['global'],
      extraFlag: true,
      entries: [
        { path: otherDir, exclude: ['draft'] },
        { note: 'missing path' },
        { path: 42 },
        null,
      ],
    };
    writeFileSync(configPath, JSON.stringify(initial, null, 2));

    const check = inspectSkillsConfig({ configPath, skillsDir, home });
    assert.deepEqual(check, { status: 'unregistered', configPath, skillsDir });
    assert.equal(formatCheckStatus(check), `not registered (${skillsDir} not in ${configPath})`);

    const result = applySkillsRegistration({ configPath, skillsDir, home });
    assert.equal(result.action, 'registered');

    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(written, {
      inherits: ['global'],
      extraFlag: true,
      entries: [
        { path: otherDir, exclude: ['draft'] },
        { note: 'missing path' },
        { path: 42 },
        null,
        { path: skillsDir },
      ],
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

    const check = inspectSkillsConfig({ configPath, skillsDir, home });
    assert.deepEqual(check, { status: 'unregistered', configPath, skillsDir });

    const applied = applySkillsRegistration({ configPath, skillsDir, home });
    assert.equal(applied.action, 'registered');

    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(written, {
      inherits: ['defaults'],
      entries: [{ path: skillsDir }],
    });
  });
});

test('tilde path and trailing slash match canonical skillsDir and detect filtered entries', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const skillsDir = makeOrbitPlugin(join(home, 'orbit-plugin'));
    mkdirSync(dirname(configPath), { recursive: true });

    writeFileSync(
      configPath,
      JSON.stringify({ entries: [{ path: '~/orbit-plugin/skills/' }] }, null, 2),
    );
    const unfiltered = inspectSkillsConfig({ configPath, skillsDir, home });
    assert.deepEqual(unfiltered, {
      status: 'registered',
      configPath,
      skillsDir,
      matchedPath: '~/orbit-plugin/skills/',
      filtered: false,
    });
    assert.equal(
      formatCheckStatus(unfiltered),
      `registered (~/orbit-plugin/skills/ in ${configPath})`,
    );

    writeFileSync(
      configPath,
      JSON.stringify({ entries: [{ path: `${skillsDir}/`, include_only: ['start'] }] }, null, 2),
    );
    const filtered = inspectSkillsConfig({ configPath, skillsDir, home });
    assert.equal(filtered.status, 'registered');
    assert.equal(filtered.filtered, true);
    assert.equal(
      formatCheckStatus(filtered),
      `registered (${skillsDir}/ in ${configPath}, filtered)`,
    );
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

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          inherits: ['base'],
          entries: [
            { path: otherSkills },
            { path: oldOrbitSkills, include_only: ['start', 'setup'], exclude: ['debug'] },
            { path: ghostOrbitSkills },
          ],
        },
        null,
        2,
      ),
    );

    const check = inspectSkillsConfig({ configPath, skillsDir: currentSkills, home });
    assert.deepEqual(check, {
      status: 'stale',
      configPath,
      skillsDir: currentSkills,
      stalePaths: [oldOrbitSkills, ghostOrbitSkills],
    });
    assert.equal(
      formatCheckStatus(check),
      `stale (${oldOrbitSkills}, ${ghostOrbitSkills} -> ${currentSkills} in ${configPath})`,
    );

    const updated = applySkillsRegistration({ configPath, skillsDir: currentSkills, home });
    assert.deepEqual(updated, {
      action: 'updated',
      configPath,
      skillsDir: currentSkills,
      stalePaths: [oldOrbitSkills, ghostOrbitSkills],
    });

    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(written, {
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

    writeFileSync(
      configPath,
      JSON.stringify({ entries: [{ path: oldOrbitSkills }, { path: currentSkills }] }, null, 2),
    );

    const check = inspectSkillsConfig({ configPath, skillsDir: currentSkills, home });
    assert.equal(check.status, 'stale');

    const updated = applySkillsRegistration({ configPath, skillsDir: currentSkills, home });
    assert.equal(updated.action, 'updated');

    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(written, { entries: [{ path: currentSkills }] });
  });
});

test('invalid JSON, non-object root, and non-array entries fail apply without modifying the file', () => {
  const cases = [
    '{ not valid json',
    'null\n',
    '[]\n',
    '"hello"\n',
    JSON.stringify({ entries: 'not-an-array' }),
  ];

  for (const raw of cases) {
    withTempDir((tmp) => {
      const home = join(tmp, 'home');
      const configPath = defaultConfigPath(home);
      const skillsDir = makeOrbitPlugin(join(tmp, 'orbit-plugin'));
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, raw);

      const check = inspectSkillsConfig({ configPath, skillsDir, home });
      assert.equal(check.status, 'invalid');
      assert.match(formatCheckStatus(check), /^invalid \(/);

      const cliApply = runCli(['--apply', '--skills-dir', skillsDir, '--config', configPath], { HOME: home });
      assert.notEqual(cliApply.status, 0);
      assert.equal(readFileSync(configPath, 'utf8'), raw);
    });
  }
});

test('apply fails when skillsDir does not exist or is a file', () => {
  withTempDir((tmp) => {
    const home = join(tmp, 'home');
    const configPath = defaultConfigPath(home);
    const missingDir = join(tmp, 'does-not-exist');
    const filePath = join(tmp, 'not-a-dir');
    writeFileSync(filePath, 'x');

    const missingRes = runCli(['--apply', '--skills-dir', missingDir, '--config', configPath], { HOME: home });
    assert.notEqual(missingRes.status, 0);
    assert.equal(existsSync(configPath), false);

    const fileRes = runCli(['--apply', '--skills-dir', filePath, '--config', configPath], { HOME: home });
    assert.notEqual(fileRes.status, 0);
    assert.equal(existsSync(configPath), false);
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

    const result = applySkillsRegistration({ configPath, skillsDir, home });
    assert.equal(result.action, 'registered');
    assert.equal(lstatSync(configPath).isSymbolicLink(), true);
    assert.equal(realpathSync(configPath), realpathSync(realConfigPath));
    assert.deepEqual(JSON.parse(readFileSync(realConfigPath, 'utf8')), {
      entries: [{ path: skillsDir }],
    });
  });
});

test('doctor.sh reports skills dir, detects Antigravity status read-only, and prefers non-lane orbit install', () => {
  withTempDir((tmp) => {
    const fakeBin = join(tmp, 'bin');
    buildFakeBin(fakeBin);

    const homeNoAg = join(tmp, 'home-no-ag');
    mkdirSync(homeNoAg, { recursive: true });

    const noAgRun = spawnSync('bash', [doctorPath], {
      encoding: 'utf8',
      env: { HOME: homeNoAg, PATH: fakeBin },
    });
    assert.equal(noAgRun.status, 0, noAgRun.stderr);
    assert.match(noAgRun.stdout, /^orbit skills dir: .+$/m);
    assert.match(
      noAgRun.stdout,
      /^antigravity skills: not detected \(no agy or ~\/\.gemini\/config\)$/m,
    );
    assert.deepEqual(readdirSync(homeNoAg), []);

    const homeWithAg = join(tmp, 'home-with-ag');
    mkdirSync(join(homeWithAg, '.gemini', 'config'), { recursive: true });
    const pluginsDir = join(homeWithAg, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });

    const lanePluginDir = join(tmp, 'lane-market', 'plugin');
    makeOrbitPlugin(lanePluginDir, '0.73.0');
    const mainPluginDir = join(tmp, 'main-market', 'plugin');
    const mainSkillsDir = makeOrbitPlugin(mainPluginDir, '0.74.0');

    mkdirSync(join(tmp, 'lane-market', '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'lane-market', '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'orbit', source: 'plugin' }] }),
    );
    mkdirSync(join(tmp, 'main-market', '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'main-market', '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'orbit', source: 'plugin' }] }),
    );

    writeFileSync(
      join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({
        plugins: {
          'orbit@orbit-head-abc123': [{ scope: 'user', version: '0.73.0', installPath: lanePluginDir }],
          'orbit@orbit': [{ scope: 'user', version: '0.74.0', installPath: mainPluginDir }],
        },
      }),
    );
    writeFileSync(
      join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        'orbit-head-abc123': { installLocation: join(tmp, 'lane-market') },
        orbit: { installLocation: join(tmp, 'main-market') },
      }),
    );

    const beforeApply = spawnSync('bash', [doctorPath], {
      encoding: 'utf8',
      env: { HOME: homeWithAg, PATH: fakeBin },
    });
    assert.equal(beforeApply.status, 0, beforeApply.stderr);
    const expectedSkillsDir = realpathSync(mainSkillsDir);
    assert.match(beforeApply.stdout, new RegExp(`^install: orbit@orbit record 0\\.74\\.0`, 'm'));
    assert.match(
      beforeApply.stdout,
      new RegExp(`^orbit skills dir: ${expectedSkillsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    );
    assert.match(beforeApply.stdout, /^antigravity skills: not registered \(/m);
    assert.equal(existsSync(defaultConfigPath(homeWithAg)), false);

    const applied = runCli(
      ['--apply', '--skills-dir', expectedSkillsDir, '--config', defaultConfigPath(homeWithAg)],
      { HOME: homeWithAg },
    );
    assert.equal(applied.status, 0, applied.stderr);

    const afterApply = spawnSync('bash', [doctorPath], {
      encoding: 'utf8',
      env: { HOME: homeWithAg, PATH: fakeBin },
    });
    assert.equal(afterApply.status, 0, afterApply.stderr);
    assert.match(afterApply.stdout, /^antigravity skills: registered \(/m);
  });
});
