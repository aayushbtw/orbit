import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clash } from './branches.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { encoding: 'utf8' }).trim();
const branches = (dir) => git(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads');
const tryRead = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(ok, what, ms = 30_000) {
  for (const deadline = Date.now() + ms; !ok(); await sleep(50)) {
    if (Date.now() > deadline) throw new Error(`gave up waiting until ${what}`);
  }
}

const STUB = `#!/usr/bin/env node
const { execFileSync, spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const args = process.argv.slice(2);
const state = process.env.STUB_STATE;
const done = state + '.done';
const flag = (name) => args[args.indexOf(name) + 1];
if (args[0] === '--version') { console.log('stub'); process.exit(0); }
if (args[0] === 'thread' && args[1] === 'start') {
  readFileSync(0);
  const project = args[2];
  const worktreePath = join(process.env.STUB_WORKTREES, basename(project), 'wt');
  mkdirSync(join(worktreePath, '..'), { recursive: true });
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', flag('--branch'), worktreePath, flag('--worktree')]);
  writeFileSync(state, JSON.stringify({ threadId: 'stub-thread', title: flag('--title'), worktreePath }));
  const agent = spawn('sh', ['-c', process.env.STUB_AGENT + '\\ntouch "$STUB_DONE"'], { cwd: worktreePath, detached: true, stdio: 'ignore', env: { ...process.env, STUB_DONE: done } });
  const reply = () => { console.log(JSON.stringify({ threadId: 'stub-thread', reply: 'done' })); process.exit(process.env.STUB_ASKS ? 2 : 0); };
  if (args.includes('--wait')) agent.on('exit', reply);
  else { agent.unref(); reply(); }
  return;
}
const s = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : null;
if (args[0] === 'thread' && args[1] === 'list') { console.log(JSON.stringify(s ? [s] : [])); process.exit(0); }
if (args[0] === 'thread' && args[1] === 'show') {
  const shows = JSON.parse(process.env.STUB_SHOWS ?? '[[]]');
  const n = s.shows ?? 0;
  writeFileSync(state, JSON.stringify({ ...s, shows: n + 1 }));
  const asks = Boolean(process.env.STUB_ASKS);
  const activeRunId = asks || !existsSync(done) ? 'stub-run' : null;
  console.log(JSON.stringify({ thread: { threadId: s.threadId, link: 't3://stub', providerInstanceId: 'stub', model: 'stub', runtimeMode: 'full-access', worktreePath: s.worktreePath, pendingRequestCount: asks ? 1 : 0, activeRunId }, messages: shows[Math.min(n, shows.length - 1)] }));
  process.exit(0);
}
process.exit(1);
`;

const sees = (seconds) => `d=$(pwd); sleep ${seconds}; if test -d "$d"; then echo kept; else echo gone; fi > "$STUB_SAW"`;

async function killLauncher(argv, env) {
  const launcher = spawn(process.execPath, argv, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  launcher.stderr.on('data', (d) => { stderr += d; });
  await until(() => existsSync(env.STUB_STATE) && /worker \d+/.test(stderr), 'the thread started');
  const worker = Number(stderr.match(/worker (\d+)/)[1]);
  launcher.kill('SIGKILL');
  await until(() => !alive(worker), `worker ${worker} exited`);
}

async function withProject(setup, agent, { args = [], env: extra = {}, exit = 0, kill = false, inspect = () => null } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-lane-test-')));
  try {
    const project = join(root, 'project');
    git(root, 'init', '-q', '-b', 'main', project);
    git(project, 'commit', '-q', '--allow-empty', '-m', 'base');
    for (const args of setup) git(project, ...args);
    const stub = join(root, 't3');
    writeFileSync(stub, STUB);
    chmodSync(stub, 0o755);
    const base = git(project, 'rev-parse', 'HEAD');
    const before = branches(project);
    const env = {
      ...process.env,
      T3CODE_CLI_PATH: stub, STUB_STATE: join(root, 'state.json'), STUB_WORKTREES: join(root, 'worktrees'), STUB_AGENT: agent, STUB_SAW: join(root, 'saw'),
      CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex'), GROK_HOME: join(root, 'grok'),
      ...extra,
    };
    const argv = [join(here, 'lane.mjs'), '--head', 'HEAD', '--scenario', 'probe', '--project', project, '--installed', '--out', join(root, 'out.json'), ...args];
    if (kill) {
      await killLauncher(argv, env);
    } else {
      const lane = spawnSync(process.execPath, argv, { encoding: 'utf8', env });
      assert.equal(lane.status, exit, lane.stderr);
    }
    const out = JSON.parse(readFileSync(join(root, 'out.json'), 'utf8'));
    const worktrees = git(project, 'worktree', 'list', '--porcelain');
    const after = branches(project);
    const seen = await inspect({ project, out });
    await until(() => existsSync(`${env.STUB_STATE}.done`), 'the stub agent finished');
    return { root, base, before, after, worktrees, out, seen, saw: tryRead(env.STUB_SAW)?.trim() };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const ref of ['refs/heads/feature/keep', 'refs/heads/Main']) {
  test(`cleanup keeps every earlier branch when the thread checks out ${ref}, a case variant of one`, async () => {
    const { before, after } = await withProject([['branch', 'Feature/Keep']], `git symbolic-ref HEAD ${ref}`);
    assert.equal(after, before);
  });
}

test('cleanup keeps every earlier branch when the thread points HEAD outside refs/heads', async () => {
  const { before, after } = await withProject([['branch', '1'], ['update-ref', 'refs/tags/v1', 'HEAD']], 'git symbolic-ref HEAD refs/tags/v1');
  assert.equal(after, before);
});

test('cleanup deletes the lane branch after the thread renames it and commits on it', async () => {
  const { before, after, worktrees } = await withProject([['branch', 'Feature/Keep']], 'git branch -m feat/renamed && git -c user.name=t -c user.email=t@t.invalid commit -q --allow-empty -m work');
  assert.equal(after, before);
  assert.equal(worktrees.split('\n\n').length, 1, worktrees);
});

test('cleanup deletes the lane branch when the thread leaves it checked out', async () => {
  const { before, after } = await withProject([], 'true');
  assert.equal(after, before);
});

const lead = [{ role: 'user', text: 'go', runId: 'r1' }, { role: 'assistant', text: 'started', runId: 'r1' }];
const wakeA = { role: 'assistant', text: 'wake a', runId: 'r2' };
const wakeB = { role: 'assistant', text: 'wake b', runId: 'r3' };
const holdFor = async (wake, shows) => (await withProject([], 'true', {
  args: ['--wake', wake, '--wakes', '2'],
  env: { ORBIT_LANE_POLL_MS: '20', STUB_SHOWS: JSON.stringify(shows) },
})).out;

test('--wakes 2 keeps polling past the first wake run until the second arrives', async () => {
  const out = await holdFor('1', [lead, [...lead, wakeA], [...lead, wakeA], [...lead, wakeA, wakeB]]);
  assert.equal(out.wake, 'arrived');
  assert.deepEqual(out.wakes.map((w) => w.text), ['wake a', 'wake b']);
  assert.equal(out.status, 'completed');
});

test('--wakes 2 returns at the --wake deadline with the one wake run that came', async () => {
  const out = await holdFor('0.005', [lead, [...lead, wakeA]]);
  assert.equal(out.wake, 'arrived');
  assert.deepEqual(out.wakes.map((w) => w.text), ['wake a']);
  assert.equal(out.status, 'completed');
});

const remember = `"${process.execPath}" -e 'const fs = require("node:fs"); const dir = JSON.parse(fs.readFileSync(".claude/settings.local.json", "utf8")).autoMemoryDirectory; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + "/MEMORY.md", "lane note")'`;

test('an --installed lane commit on the base points Claude auto memory at the lane memory folder', async () => {
  const { root, base, out, seen } = await withProject([], remember, {
    inspect: ({ project, out }) => ({
      memory: tryRead(join(out.memoryDir, 'MEMORY.md')),
      parent: git(project, 'rev-parse', `${out.laneCommit}^`),
      local: JSON.parse(git(project, 'show', `${out.laneCommit}:.claude/settings.local.json`)),
    }),
  });
  assert.equal(seen.memory, 'lane note');
  assert.equal(out.memoryDir, join(root, 'out.memory'));
  assert.ok(out.memoryDir.startsWith(root + sep), out.memoryDir);
  assert.doesNotMatch(out.memoryDir, /\.claude[/\\]projects/);
  assert.equal(seen.parent, base);
  assert.equal(seen.local.autoMemoryDirectory, out.memoryDir);
});

test('a lane whose launcher is killed still completes and cleans up only after the thread ends', async () => {
  const { before, after, worktrees, out, saw } = await withProject([], sees(2), { kill: true });
  assert.equal(out.status, 'completed');
  assert.equal(saw, 'kept');
  assert.equal(after, before);
  assert.equal(worktrees.split('\n\n').length, 1, worktrees);
});

test('a timed-out lane waits for the thread to go idle before it removes the worktree', async () => {
  const { before, after, worktrees, out, saw } = await withProject([], sees(3.2), {
    args: ['--timeout', '0.04'], env: { ORBIT_LANE_POLL_MS: '20' }, exit: 1,
  });
  assert.equal(out.status, 'timeout');
  assert.equal(out.kept, null);
  assert.equal(saw, 'kept');
  assert.equal(after, before);
  assert.equal(worktrees.split('\n\n').length, 1, worktrees);
});

test('a lane whose thread still runs after the grace keeps the worktree and branch', async () => {
  const { worktrees, out, saw } = await withProject([], sees(3), {
    args: ['--timeout', '0.01'], env: { ORBIT_LANE_POLL_MS: '20' }, exit: 1,
  });
  assert.equal(out.status, 'timeout');
  assert.equal(out.kept.worktree, out.thread.worktreePath);
  assert.match(out.kept.branch, /^orbit-lane\/probe-[0-9a-f]{8}$/);
  assert.ok(worktrees.includes(`worktree ${out.kept.worktree}`), worktrees);
  assert.equal(saw, 'kept');
});

test('a lane whose thread waits on a question cleans up at once, though the run stays open', async () => {
  const { before, after, worktrees, out } = await withProject([], 'true', {
    args: ['--timeout', '0.05'], env: { ORBIT_LANE_POLL_MS: '20', STUB_ASKS: '1' }, exit: 2,
  });
  assert.equal(out.status, 'waiting');
  assert.equal(out.kept, null);
  assert.equal(after, before);
  assert.equal(worktrees.split('\n\n').length, 1, worktrees);
});

test('a lane branch name that differs from an existing branch only in case clashes', () => {
  const existing = new Map([['refs/heads/Orbit-Lane/probe-1a2b', 'x'], ['refs/heads/main', 'y']]);
  assert.equal(clash(existing, 'refs/heads/orbit-lane/probe-1a2b'), 'refs/heads/Orbit-Lane/probe-1a2b');
  assert.equal(clash(existing, 'refs/heads/orbit-lane/probe-9f9f'), undefined);
});
