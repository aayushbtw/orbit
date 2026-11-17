import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
export const PLUGIN_DIR = resolve(REPO, 'plugin');
const LANE = resolve(HERE, '../t3/lane.mjs');

const PROJECT = {
  'package.json': JSON.stringify({ name: 'skyforge', version: '0.1.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n',
  'AGENTS.md': `# Skyforge

A small top-down action game. Pure ES modules, no dependencies.

## Workflow

- Check: \`npm test\`

### Models

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| \`shader-math\` | Shader and camera math, render bugs | opus | high, xhigh after 2 failed tries |
| \`look-review\` | Reviewing screenshots and judging the look | opus | medium |
| \`data-tuning\` | Skill, item and enemy stats, numbers, the input map | sonnet | low |
| \`docs\` | Docs and plan edits | sonnet | low |
| \`phase-planning\` | Phase planning and design calls | opus | high |
| \`cross-file-system\` | A system across files: combat, enemy AI, saving, skill tree | opus | high |
| \`single-file-feature\` | A feature inside one file: interact key, HUD | sonnet | medium |
| \`gitops\` | | | medium |
`,
  'src/camera.js': `export function createCamera({ width, height }) {
  return { x: 0, y: 0, zoom: 1, width, height };
}

export function setZoom(camera, zoom) {
  camera.zoom = Math.min(8, Math.max(0.5, zoom));
}

export function follow(camera, target, smoothing = 0.15) {
  camera.x += (target.x - camera.x) * smoothing;
  camera.y += (target.y - camera.y) * smoothing;
}

export function worldToScreen(camera, point) {
  const dx = Math.round(point.x - camera.x);
  const dy = Math.round(point.y - camera.y);
  return {
    x: dx * camera.zoom + camera.width / 2,
    y: dy * camera.zoom + camera.height / 2,
  };
}
`,
  'src/hud.js': `export function hpLabel(entity) {
  return \`\${entity.name} \${Math.max(0, entity.hp)}/\${entity.maxHp}\`;
}

export function hpBar(entity, width = 10) {
  const filled = Math.round((Math.max(0, entity.hp) / entity.maxHp) * width);
  return '#'.repeat(filled) + '-'.repeat(width - filled);
}
`,
  'data/enemies.json': JSON.stringify({
    goblin: { hp: 20, damage: 4, speed: 1.6 },
    slime: { hp: 12, damage: 2, speed: 0.8 },
    skeleton: { hp: 35, damage: 6, speed: 1.1 },
  }, null, 2) + '\n',
  'test/camera.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, follow, setZoom, worldToScreen } from '../src/camera.js';

test('the camera target sits at screen center', () => {
  const camera = createCamera({ width: 320, height: 180 });
  camera.x = 50;
  camera.y = 40;
  assert.deepEqual(worldToScreen(camera, { x: 50, y: 40 }), { x: 160, y: 90 });
});

test('zoom 2 doubles distance from center', () => {
  const camera = createCamera({ width: 320, height: 180 });
  setZoom(camera, 2);
  assert.deepEqual(worldToScreen(camera, { x: 10, y: -5 }), { x: 180, y: 80 });
});

test('zoom clamps to its range', () => {
  const camera = createCamera({ width: 320, height: 180 });
  setZoom(camera, 20);
  assert.equal(camera.zoom, 8);
  setZoom(camera, 0.1);
  assert.equal(camera.zoom, 0.5);
});

test('follow eases toward the target', () => {
  const camera = createCamera({ width: 320, height: 180 });
  follow(camera, { x: 100, y: 0 }, 0.5);
  assert.equal(camera.x, 50);
});
`,
};

function git(cwd, ...args) {
  execFileSync('git', ['-c', 'user.name=Skyforge', '-c', 'user.email=dev@skyforge.local', ...args], { cwd, stdio: 'ignore' });
}

export function scaffold(settings) {
  const dir = join(tmpdir(), `skyforge-${randomBytes(3).toString('hex')}`);
  const files = settings ? { ...PROJECT, '.claude/settings.json': JSON.stringify(settings, null, 2) + '\n' } : PROJECT;
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Initial skyforge prototype');
  git(dir, 'init', '-q', '--bare', '-b', 'main', `${dir}-origin.git`);
  git(dir, 'remote', 'add', 'origin', `${dir}-origin.git`);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  return dir;
}

export const readJsonl = (path) => existsSync(path)
  ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
  : [];

export function orbitRev() {
  const run = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    return { sha: run('rev-parse', 'HEAD').trim(), dirty: run('status', '--porcelain').trim() !== '' };
  } catch {
    return { sha: null, dirty: null };
  }
}

export function createLeads({ host, model, provider, keep, timeoutMs, maxTurns, graceMs }) {
  let t3;
  if (host === 't3') {
    t3 = [process.env.T3CODE_CLI_PATH, 't3'].filter(Boolean).find((c) => {
      try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
    });
    if (!t3) throw new Error(`no T3 CLI runs: tried T3CODE_CLI_PATH (${process.env.T3CODE_CLI_PATH ?? 'unset'}) and t3 on PATH`);
  }

  const t3Projects = new Set();
  const release = (project) => {
    if (t3Projects.delete(project)) {
      try { execFileSync(t3, ['project', 'remove', '--force', project], { stdio: 'ignore' }); } catch (e) { console.error(`t3 project remove ${project}: ${e.message}`); }
    }
    if (keep) return;
    rmSync(project, { recursive: true, force: true });
    rmSync(`${project}-origin.git`, { recursive: true, force: true });
  };

  const stop = (pid) => {
    try { process.kill(-pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, graceMs).unref();
  };

  const awaitLaneWorkerJson = async (outDir) => {
    for (const end = Date.now() + timeoutMs; !existsSync(join(outDir, 'lane.json')) && Date.now() < end;) await new Promise((r) => setTimeout(r, 1000));
  };

  const live = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      const exits = [...live.values()];
      for (const pid of live.keys()) stop(pid);
      await Promise.all(exits);
      process.exit(1);
    });
  }

  function startLead(outDir, prompt, hooks) {
    const errFd = openSync(join(outDir, 'stderr.log'), 'w');
    if (host === 'claude') {
      const project = scaffold();
      const settings = join(outDir, 'settings.json');
      writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'orbit@orbit': false }, hooks }, null, 2));
      const outFd = openSync(join(outDir, 'stream.jsonl'), 'w');
      const child = spawn('claude', [
        '-p', '--model', model, '--plugin-dir', PLUGIN_DIR, '--settings', settings, '--setting-sources', 'project,local',
        '--permission-mode', 'bypassPermissions', '--max-turns', String(maxTurns), '--output-format', 'stream-json', '--verbose',
      ], { cwd: project, detached: true, stdio: ['pipe', outFd, errFd] });
      child.stdin.end(prompt);
      return { project, child, fds: [outFd, errFd] };
    }
    const project = scaffold({ hooks });
    t3Projects.add(project);
    try {
      execFileSync(t3, ['project', 'add', project], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      release(project);
      throw new Error(`t3 project add ${project}: ${e.stderr?.toString().trim() || e.message}`);
    }
    const outFd = openSync(join(outDir, 'stdout.log'), 'w');
    const args = [LANE, '--head', 'HEAD', '--scenario', 'routing', '--message', prompt, '--project', project, '--out', join(outDir, 'lane.json'), '--timeout', String(timeoutMs / 60_000 - 2)];
    if (provider) args.push('--provider', provider);
    if (model) args.push('--model', model);
    const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', outFd, errFd] });
    return { project, child, fds: [outFd, errFd] };
  }

  function runLead(outDir, { prompt, matcher, hookArgs = [] }) {
    mkdirSync(outDir, { recursive: true });
    const log = join(outDir, 'spawns.jsonl');
    writeFileSync(log, '');
    const command = [process.execPath, join(HERE, 'hook.mjs'), log, ...hookArgs].map((a) => JSON.stringify(a)).join(' ');
    const hook = [{ matcher, hooks: [{ type: 'command', command }] }];
    const { project, child, fds } = startLead(outDir, prompt, { PreToolUse: hook, PostToolUse: hook });

    const exited = new Promise((done) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stop(child.pid);
      }, timeoutMs);
      child.on('exit', async (code) => {
        clearTimeout(timer);
        for (const fd of fds) closeSync(fd);
        if (host === 't3') await awaitLaneWorkerJson(outDir);
        live.delete(child.pid);
        release(project);
        done({ outDir, project, exit: timedOut ? 'timeout' : `code ${code}` });
      });
    });
    live.set(child.pid, exited);
    return exited;
  }

  return { runLead };
}
