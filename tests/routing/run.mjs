import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(HERE, '../../plugin');
const TIMEOUT_MS = 25 * 60 * 1000;
const PROMPT = "/orbit:start the camera jitters when you zoom in past 4x, and goblins die way too fast, bump their HP to 40. I'll land it.";
const ROLES = new Set(['orbit:gitops', 'orbit:verifier', 'orbit:advisor', 'orbit:comment-sicko']);
const FRONTMATTER = Object.fromEntries(readdirSync(join(PLUGIN_DIR, 'agents')).filter((f) => f.endsWith('.md')).map((f) => {
  const frontmatter = readFileSync(join(PLUGIN_DIR, 'agents', f), 'utf8').split('---')[1] ?? '';
  return [`orbit:${f.slice(0, -3)}`, { model: frontmatter.match(/^model:\s*(\S+)/m)?.[1], effort: frontmatter.match(/^effort:\s*(\S+)/m)?.[1] }];
}));

const { values: opts } = parseArgs({
  options: {
    model: { type: 'string', default: 'opus' },
    runs: { type: 'string', default: '1' },
    keep: { type: 'boolean', default: false },
    grade: { type: 'string' },
  },
});
if (!['opus', 'sonnet', 'fable'].includes(opts.model)) throw new Error(`--model must be opus, sonnet or fable, got ${opts.model}`);
const runs = Number(opts.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, got ${opts.runs}`);

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

function scaffold() {
  const dir = join(tmpdir(), `skyforge-${randomBytes(3).toString('hex')}`);
  for (const [path, body] of Object.entries(PROJECT)) {
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

const removeProject = (project) => {
  rmSync(project, { recursive: true, force: true });
  rmSync(`${project}-origin.git`, { recursive: true, force: true });
};

const live = new Map();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const [pid, project] of live) {
      try { process.kill(-pid, 'SIGTERM'); } catch {}
      if (!opts.keep) removeProject(project);
    }
    process.exit(1);
  });
}

function runLead(outDir) {
  const project = scaffold();
  mkdirSync(outDir, { recursive: true });
  const log = join(outDir, 'spawns.jsonl');
  writeFileSync(log, '');
  const hook = [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: `node ${JSON.stringify(join(HERE, 'hook.mjs'))} ${JSON.stringify(log)}` }] }];
  const settings = join(outDir, 'settings.json');
  writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'orbit@orbit': false }, hooks: { PreToolUse: hook, PostToolUse: hook } }, null, 2));

  const streamFd = openSync(join(outDir, 'stream.jsonl'), 'w');
  const errFd = openSync(join(outDir, 'stderr.log'), 'w');
  const child = spawn('claude', [
    '-p', '--model', opts.model, '--plugin-dir', PLUGIN_DIR, '--settings', settings, '--setting-sources', 'project,local',
    '--permission-mode', 'bypassPermissions', '--max-turns', '80', '--output-format', 'stream-json', '--verbose',
  ], { cwd: project, detached: true, stdio: ['pipe', streamFd, errFd] });
  live.set(child.pid, project);
  child.stdin.end(PROMPT);

  return new Promise((done) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10_000).unref();
    }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      live.delete(child.pid);
      closeSync(streamFd);
      closeSync(errFd);
      if (!opts.keep) removeProject(project);
      done({ outDir, project, exit: timedOut ? 'timeout' : `code ${code}` });
    });
  });
}

const readJsonl = (path) => existsSync(path)
  ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
  : [];

function unitOf(input) {
  if (input.subagent_type !== 'orbit:poteto-agent') return null;
  const prompt = input.prompt ?? '';
  const fileLines = prompt.match(/^[ \t*_>-]*files?\s*:.*$/gim)?.join('\n') ?? '';
  const named = ['camera.js', 'enemies.json'].filter((f) => fileLines.includes(f));
  if (named.length === 1) return named[0] === 'camera.js' ? 'camera' : 'data';
  const camera = prompt.indexOf('camera.js');
  const data = prompt.indexOf('enemies.json');
  if (camera < 0 && data < 0) return null;
  if (camera < 0) return 'data';
  if (data < 0) return 'camera';
  // A brief names its own file before any it is told to leave alone.
  return camera < data ? 'camera' : 'data';
}

const describe = (c) => `#${c.n} ${c.subagent_type ?? 'general-purpose'} model=${c.model ?? '-'} effort=${c.effort ?? (c.effective ? `${c.effective} (frontmatter)` : '-')}`;

function routed(name, call, model, effort, workType) {
  if (!call) return { id: name, status: 'FAIL', detail: `no orbit:poteto-agent brief names the ${name.split('-')[0]} file` };
  const misses = [
    call.model !== model && `model=${call.model ?? '-'} want ${model}`,
    call.effort !== effort && `passed effort=${call.effort ?? '-'} want ${effort}`,
    !new RegExp(`Work type:\\s*\`?${workType}\`?`).test(call.prompt ?? '') && `prompt lacks "Work type: ${workType}"`,
  ].filter(Boolean);
  return { id: name, status: misses.length ? 'FAIL' : 'PASS', detail: `${describe(call)}${misses.length ? `; ${misses.join('; ')}` : ''}` };
}

function grade(records) {
  const calls = records
    .filter((r) => r.event === 'PreToolUse' && !r.agent_id)
    .map((r, i) => ({
      ...r.tool_input,
      n: i + 1,
      unit: unitOf(r.tool_input),
      effective: r.tool_input.effort ?? FRONTMATTER[r.tool_input.subagent_type]?.effort,
    }));
  const checks = [];

  const missing = calls.filter((c) => !c.effective);
  checks.push({
    id: 'effort-present',
    status: !calls.length ? 'N/A' : missing.length ? 'FAIL' : 'PASS',
    detail: missing.length ? missing.map(describe).join(', ') : `${calls.length} calls`,
  });

  let cameraSeen = 0;
  const over = [];
  for (const c of calls) {
    const stepUp = c.unit === 'camera' && cameraSeen >= 2 && c.effective === 'xhigh';
    if (['xhigh', 'max'].includes(c.effective) && !stepUp) over.push(c);
    if (c.unit === 'camera') cameraSeen++;
  }
  checks.push({
    id: 'effort-ceiling',
    status: !calls.length ? 'N/A' : over.length ? 'FAIL' : 'PASS',
    detail: over.length ? over.map(describe).join(', ') : 'none above high',
  });

  checks.push(routed('camera-routing', calls.find((c) => c.unit === 'camera'), 'opus', 'high', 'shader-math'));
  checks.push(routed('enemies-routing', calls.find((c) => c.unit === 'data'), 'sonnet', 'low', 'data-tuning'));

  const gitops = calls.filter((c) => c.subagent_type === 'orbit:gitops');
  const badGitops = gitops.filter((c) => (c.model ?? FRONTMATTER['orbit:gitops'].model) !== 'sonnet' || c.effort !== 'medium');
  checks.push({
    id: 'gitops-routing',
    status: !gitops.length ? 'N/A' : badGitops.length ? 'FAIL' : 'PASS',
    detail: badGitops.length ? badGitops.map(describe).join(', ') : `${gitops.length} calls`,
  });

  const unmatched = calls.filter((c) => c.subagent_type === 'orbit:poteto-agent' && !c.unit);
  const others = calls.filter((c) => c.subagent_type !== 'orbit:poteto-agent' && !ROLES.has(c.subagent_type));
  const childModels = records.filter((r) => r.event === 'PostToolUse' && !r.agent_id).map((r) => r.resolved_model ?? '?');
  const info = [
    `lead spawns: ${calls.map(describe).join(' | ') || 'none'}`,
    `spawns that omitted effort: ${calls.filter((c) => !('effort' in c)).map(describe).join(', ') || 'none'}`,
    `poteto-agent calls naming neither file: ${unmatched.map(describe).join(', ') || 'none'}`,
    `other non-role spawns: ${others.map(describe).join(', ') || 'none'}`,
    `reached gitops: ${gitops.length}, verifier: ${calls.filter((c) => c.subagent_type === 'orbit:verifier').length}, advisor: ${calls.filter((c) => c.subagent_type === 'orbit:advisor').length}`,
    `nested spawns from children: ${records.filter((r) => r.event === 'PreToolUse' && r.agent_id).length}`,
    `children ran on: ${childModels.join(', ') || 'none returned'}`,
  ];
  return { checks, info };
}

function leadSummary(outDir) {
  const results = readJsonl(join(outDir, 'stream.jsonl')).filter((e) => e.type === 'result');
  const last = results.at(-1);
  if (!last) return 'lead result: no result event in stream';
  const turns = results.reduce((sum, r) => sum + (r.num_turns ?? 0), 0);
  return `lead result: ${last.subtype}, ${turns} turns over ${results.length} wake-ups, $${last.total_cost_usd?.toFixed(2) ?? '?'}`;
}

const outRoot = opts.grade ? resolve(opts.grade) : join(tmpdir(), `orbit-routing-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const savedRuns = () => existsSync(join(outRoot, 'spawns.jsonl'))
  ? [outRoot]
  : (existsSync(outRoot) ? readdirSync(outRoot) : []).filter((d) => d.startsWith('run-')).sort().map((d) => join(outRoot, d));
const finished = opts.grade
  ? savedRuns().map((outDir) => ({ outDir, exit: 'saved' }))
  : (console.log(`model=${opts.model} runs=${runs} out=${outRoot}`),
    await Promise.all(Array.from({ length: runs }, (_, i) => runLead(join(outRoot, `run-${i + 1}`)))));
if (!finished.length) {
  console.error(`no runs to grade in ${outRoot}: expected spawns.jsonl or run-*/ directories`);
  process.exit(1);
}

const graded = finished.map((run, i) => {
  const { checks, info } = grade(readJsonl(join(run.outDir, 'spawns.jsonl')));
  console.log(`\nrun ${i + 1} (${run.exit})${opts.keep ? ` project=${run.project}` : ''}`);
  for (const c of checks) console.log(`  ${c.status.padEnd(4)} ${c.id.padEnd(16)} ${c.detail}`);
  for (const line of [leadSummary(run.outDir), ...info]) console.log(`  INFO ${line}`);
  return checks;
});

console.log(`\nacross ${graded.length} run(s):`);
for (const { id } of graded[0]) {
  const statuses = graded.map((checks) => checks.find((c) => c.id === id).status);
  const scored = statuses.filter((s) => s !== 'N/A');
  const na = statuses.length - scored.length;
  console.log(`  ${id.padEnd(16)} ${scored.filter((s) => s === 'PASS').length}/${scored.length}${na ? ` (n/a ${na})` : ''}`);
}

process.exitCode = graded.flat().some((c) => c.status === 'FAIL') ? 1 : 0;
