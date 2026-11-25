import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clash } from './branches.mjs';
import { bundleMarker, stampBundleMarker, verifyRevisionEvidence } from './revision.mjs';

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
if (args[0] === 'auth' && args[1] === 'session') {
  writeFileSync(state + '.auth', args[2] + ' ' + (args[2] === 'issue' ? flag('--subject') : args[3]) + '\\n', { flag: 'a' });
  if (args[2] === 'issue') console.log(JSON.stringify({ sessionId: 'stub-session', token: 'stub-token' }));
  process.exit(0);
}
if (args[0] === 'thread' && args[1] === 'start') {
  readFileSync(0);
  const project = args[2];
  const worktreePath = args.includes('--worktree') ? join(process.env.STUB_WORKTREES, basename(project), 'wt') : null;
  if (worktreePath) {
    mkdirSync(join(worktreePath, '..'), { recursive: true });
    execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', flag('--branch'), worktreePath, flag('--worktree')]);
  }
  writeFileSync(state, JSON.stringify({ threadId: 'stub-thread', title: flag('--title'), worktreePath }));
  const agent = spawn('sh', ['-c', process.env.STUB_AGENT + '\\ntouch "$STUB_DONE"'], { cwd: worktreePath ?? project, detached: true, stdio: 'ignore', env: { ...process.env, STUB_DONE: done } });
  const reply = () => { console.log(JSON.stringify({ threadId: 'stub-thread', reply: 'done' })); process.exit(process.env.STUB_ASKS ? 2 : 0); };
  if (args.includes('--wait')) agent.on('exit', reply);
  else { agent.unref(); reply(); }
  return;
}
const s = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : null;
if (args[0] === 'thread' && args[1] === 'list') { console.log(JSON.stringify(s ? [s] : [])); process.exit(0); }
if (args[0] === 'thread' && args[1] === 'show') {
  const child = JSON.parse(process.env.STUB_CHILDREN ?? '[]').find((t) => t.threadId === args.at(-1));
  if (child) { console.log(JSON.stringify({ thread: { ...child, link: 't3://' + child.threadId, pendingRequestCount: 0, activeRunId: null }, messages: [] })); process.exit(0); }
  const shows = JSON.parse(process.env.STUB_SHOWS ?? '[[]]');
  const n = s.shows ?? 0;
  writeFileSync(state, JSON.stringify({ ...s, shows: n + 1 }));
  const asks = Boolean(process.env.STUB_ASKS);
  const activeRunId = asks || !existsSync(done) ? 'stub-run' : null;
  console.log(JSON.stringify({ thread: { threadId: s.threadId, projectId: 'stub-project', link: 't3://stub', providerInstanceId: 'stub', model: 'stub', runtimeMode: 'full-access', worktreePath: s.worktreePath, pendingRequestCount: asks ? 1 : 0, activeRunId }, messages: shows[Math.min(n, shows.length - 1)] }));
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

const PAGE = 2;

async function t3Server(onCall, listed, activity, pending) {
  const organized = [];
  const lists = [];
  const reads = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      const { id, method, params } = JSON.parse(body);
      if (req.headers.authorization !== 'Bearer stub-token') { res.writeHead(401).end(); return; }
      let result = {};
      if (method === 'tools/call' && params.name === 't3_thread_list') {
        lists.push(params.arguments);
        const { cursor } = params.arguments;
        const page = { threads: listed.slice(cursor, cursor + PAGE), nextCursor: cursor + PAGE < listed.length ? cursor + PAGE : null };
        result = { content: [{ type: 'text', text: JSON.stringify(page) }] };
      } else if (method === 'tools/call' && params.name === 't3_thread_read') {
        reads.push(params.arguments);
        const { threadId, afterPosition } = params.arguments;
        result = activity[threadId] === 'error'
          ? { isError: true, content: [{ type: 'text', text: 'activity unavailable' }] }
          : { content: [], structuredContent: { items: (activity[threadId] ?? []).filter((i) => i.position > afterPosition), hasMore: false, nextPosition: null } };
      } else if (method === 'tools/call' && params.name === 't3_pending_request') {
        result = { content: [], structuredContent: { requests: (pending[params.arguments.threadId] ?? []).map((requestId) => ({ requestId })) } };
      } else if (method === 'tools/call') {
        organized.push(params.arguments);
        await onCall();
        result = { content: [], structuredContent: {} };
      }
      if (id === undefined) { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'stub-mcp' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { organized, lists, reads, origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

function runLane(argv, env, started = () => {}) {
  return new Promise((done) => {
    const lane = spawn(process.execPath, argv, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    started(lane);
    let stderr = '';
    lane.stderr.on('data', (d) => { stderr += d; });
    lane.on('close', (status) => done({ status, stderr }));
  });
}

const CLAUDE_STUB = `#!/bin/sh
if [ "$1 $2 $3" = "plugin marketplace list" ]; then echo '[]'; fi
exit 0
`;

async function withProject(setup, agent, { args = [], env: extra = {}, exit = 0, kill = false, interruptOrganize = false, starts = true, installed = true, listed = [], activity = {}, pending = {}, inspect = () => null } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-lane-test-')));
  let launcherErr = '';
  let interrupted = false;
  const t3 = await t3Server(async () => {
    if (!interruptOrganize || interrupted) return;
    interrupted = true;
    process.kill(Number(launcherErr.match(/worker (\d+)/)[1]), 'SIGTERM');
    await sleep(500);
  }, listed, activity, pending);
  try {
    mkdirSync(join(root, 't3home', 'userdata'), { recursive: true });
    writeFileSync(join(root, 't3home', 'userdata', 'server-runtime.json'), JSON.stringify({ origin: t3.origin }));
    const project = join(root, 'project');
    git(root, 'init', '-q', '-b', 'main', project);
    git(project, 'commit', '-q', '--allow-empty', '-m', 'base');
    for (const args of setup) git(project, ...args);
    const stub = join(root, 't3');
    writeFileSync(stub, STUB);
    chmodSync(stub, 0o755);
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'claude'), CLAUDE_STUB);
    chmodSync(join(root, 'bin', 'claude'), 0o755);
    const base = git(project, 'rev-parse', 'HEAD');
    const before = branches(project);
    const env = {
      ...process.env,
      T3CODE_CLI_PATH: stub, STUB_STATE: join(root, 'state.json'), STUB_WORKTREES: join(root, 'worktrees'), STUB_AGENT: agent, STUB_SAW: join(root, 'saw'),
      CLAUDE_CONFIG_DIR: join(root, 'claude'), T3CODE_HOME: join(root, 't3home'), STUB_CHILDREN: JSON.stringify(listed),
      PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH}`,
      ...extra,
    };
    const argv = [join(here, 'lane.mjs'), '--head', 'HEAD', '--scenario', 'probe', '--project', project, ...(installed ? ['--installed'] : []), '--out', join(root, 'out.json'), ...args];
    if (kill) {
      await killLauncher(argv, env);
    } else {
      const lane = await runLane(argv, env, (child) => child.stderr.on('data', (d) => { launcherErr += d; }));
      assert.equal(lane.status, exit, lane.stderr);
    }
    const out = JSON.parse(readFileSync(join(root, 'out.json'), 'utf8'));
    const worktrees = git(project, 'worktree', 'list', '--porcelain');
    const after = branches(project);
    const seen = await inspect({ project, out });
    if (starts) await until(() => existsSync(`${env.STUB_STATE}.done`), 'the stub agent finished');
    return { root, base, before, after, worktrees, out, seen, saw: tryRead(env.STUB_SAW)?.trim(), organized: t3.organized, lists: t3.lists, reads: t3.reads, auth: tryRead(`${env.STUB_STATE}.auth`) };
  } finally {
    t3.close();
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

const commit = 'git -c user.name=t -c user.email=t@t.invalid commit -q --allow-empty';

test('cleanup removes a worktree and branch the thread makes off the lane commit, and keeps a branch it makes off the base', async () => {
  const agent = `${commit} -m work && git worktree add -q -b t3/1a2b "$STUB_WORKTREES/child" HEAD && sleep 1 && git -C "$STUB_WORKTREES/child" branch -m t3/child && git branch stranger HEAD~2`;
  const { base, before, after, worktrees, out } = await withProject([], agent, { env: { ORBIT_LANE_POLL_MS: '100' } });
  assert.equal(after, `${before}\nrefs/heads/stranger ${base}`);
  assert.equal(worktrees.split('\n\n').length, 1, worktrees);
  const child = out.branches.filter((b) => !b.ref.includes('orbit-lane/'));
  assert.deepEqual(child.map((b) => b.ref), ['refs/heads/t3/child'], 'a renamed branch is listed once, under its new name; a branch off the base is not listed');
  assert.ok(child[0].worktree.endsWith('/child'), child[0].worktree);
});

test('a --root lane runs on the project root and puts the root, its worktrees and branches back', async () => {
  const lead = `echo .claude/worktrees >> .git/info/exclude && git worktree add -q -b worktree-fix-x .claude/worktrees/fix-x HEAD && git worktree lock .claude/worktrees/fix-x && git -C .claude/worktrees/fix-x branch -m fix/x && git -C .claude/worktrees/fix-x ${commit.slice(4)} -m prereq`;
  const child = `git worktree add -q -b t3/child "$STUB_WORKTREES/child" HEAD && git -C "$STUB_WORKTREES/child" ${commit.slice(4)} -m unit`;
  const { before, after, worktrees, out, seen } = await withProject([['config', 'orbit.laneProject', 'true']], `${lead} && ${child}`, {
    args: ['--root'],
    inspect: ({ project }) => ({
      head: git(project, 'symbolic-ref', 'HEAD'),
      status: git(project, 'status', '--porcelain', '--ignored'),
      claude: existsSync(join(project, '.claude')),
      exclude: readFileSync(join(project, '.git', 'info', 'exclude'), 'utf8'),
    }),
  });
  assert.equal(out.thread.worktreePath, null);
  assert.equal(after, before);
  assert.equal(worktrees.split('\n\n').length, 1, worktrees);
  assert.equal(seen.head, 'refs/heads/main');
  assert.equal(seen.status, '');
  assert.equal(seen.claude, false);
  assert.doesNotMatch(seen.exclude, /\.claude\/worktrees/);
  assert.deepEqual(out.branches.map((b) => b.ref).filter((ref) => !ref.includes('orbit-lane/')).sort(), ['refs/heads/fix/x', 'refs/heads/t3/child']);
});

test('a --root lane refuses a project the lane did not build and leaves its root alone', async () => {
  const { before, after, out, seen } = await withProject([], 'true', {
    args: ['--root'], exit: 1, starts: false,
    inspect: ({ project }) => git(project, 'symbolic-ref', 'HEAD'),
  });
  assert.match(out.error, /--root runs only in a scenario project the lane built/);
  assert.equal(out.thread, null);
  assert.equal(seen, 'refs/heads/main');
  assert.equal(after, before);
});

test('cleanup removes a worktree whose branch the thread made off the lane commit and then reset to the base', async () => {
  const agent = `git worktree add -q -b t3/owner "$STUB_WORKTREES/owner" HEAD && git -C "$STUB_WORKTREES/owner" reset -q --hard HEAD~1`;
  const { before, after, worktrees } = await withProject([], agent);
  assert.equal(after, before);
  assert.equal(worktrees.split('\n\n').length, 1, worktrees);
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

const sessions = (n) => 'issue mcp-client\nrevoke stub-session\n'.repeat(n);

test('a lane whose run completed lists its threads, settles its thread and revokes each session it used', async () => {
  const { out, organized, auth } = await withProject([], 'true');
  assert.equal(out.status, 'completed');
  assert.deepEqual(organized, [{ threadId: 'stub-thread', action: 'settle' }]);
  assert.equal(auth, sessions(3), 'one session each for t3_thread_list, the activity read and the settle');
});

test('a lane whose thread waits on its own question archives the thread', async () => {
  const { out, organized, auth } = await withProject([], 'true', {
    args: ['--timeout', '0.05'], env: { ORBIT_LANE_POLL_MS: '20', STUB_ASKS: '1' }, exit: 2,
  });
  assert.equal(out.status, 'waiting');
  assert.deepEqual(organized, [{ threadId: 'stub-thread', action: 'archive' }]);
  assert.equal(auth, sessions(3));
});

test('a signal while the lane settles its thread issues and revokes one session for the settle', async () => {
  const { organized, auth } = await withProject([], 'true', { interruptOrganize: true });
  assert.deepEqual(organized, [{ threadId: 'stub-thread', action: 'settle' }]);
  assert.equal(auth, sessions(3));
});

test('a lane whose thread still runs at the deadline leaves the thread alone', async () => {
  const { out, organized, auth } = await withProject([], sees(3), {
    args: ['--timeout', '0.01'], env: { ORBIT_LANE_POLL_MS: '20' }, exit: 1,
  });
  assert.equal(out.status, 'timeout');
  assert.deepEqual(organized, []);
  assert.equal(auth, sessions(2));
});

test("a non-Claude lead's children come from t3_thread_list with subagents, each with its provider and model", async () => {
  const thread = (threadId, parentThreadId, providerInstanceId, model) => ({ threadId, parentThreadId, providerInstanceId, model, worktreePath: null });
  const listed = [
    thread('other-lead', null, 'claudeAgent', 'claude-opus-5-5'),
    thread('code-child', 'stub-thread', 'claudeAgent', 'claude-opus-5-5'),
    thread('stranger', 'other-lead', 'codex', 'gpt-6.1-sol'),
    thread('advisor-child', 'stub-thread', 'claudeAgent', 'claude-fable-5-2'),
    thread('grandchild', 'code-child', 'claudeAgent', 'claude-opus-5-5'),
  ];
  const activity = {
    'stub-thread': [{ position: 0, itemId: 'a', type: 'dynamic_tool', status: 'completed', text: JSON.stringify({ toolName: 't3-code.delegate_task', input: { role: 'review' } }) }],
    'grandchild': [{ position: 0, itemId: 'b', type: 'command_execution', status: 'completed', text: '$ /bin/zsh -lc "git status"\n' }],
  };
  const { out, organized, lists, reads } = await withProject([], 'true', { args: ['--provider', 'antigravity', '--model', 'stub'], listed, activity });
  assert.equal(out.activitySource, 't3-activity');
  assert.deepEqual(out.toolCalls, [
    { name: 'mcp__t3-code__delegate_task', input: { role: 'review' }, sidechain: false },
    { name: 'Bash', input: { command: 'git status' }, sidechain: true },
  ]);
  assert.deepEqual(reads.map((r) => [r.threadId, r.view, r.afterPosition]), [['stub-thread', 'activity', -1], ['code-child', 'activity', -1], ['advisor-child', 'activity', -1], ['grandchild', 'activity', -1]]);
  assert.deepEqual(out.threads.map(({ threadId, parentThreadId, providerInstanceId, model }) => [threadId, parentThreadId, providerInstanceId, model]), [
    ['stub-thread', null, 'stub', 'stub'],
    ['code-child', 'stub-thread', 'claudeAgent', 'claude-opus-5-5'],
    ['advisor-child', 'stub-thread', 'claudeAgent', 'claude-fable-5-2'],
    ['grandchild', 'code-child', 'claudeAgent', 'claude-opus-5-5'],
  ]);
  assert.deepEqual(lists.map((l) => [l.projectId, l.includeSubagents, l.cursor]), [['stub-project', true, 0], ['stub-project', true, 2], ['stub-project', true, 4]]);
  assert.deepEqual(organized.map((o) => o.threadId).sort(), ['advisor-child', 'code-child', 'grandchild', 'stub-thread']);
});

test('a lane with a non-Claude --provider reads its tool calls from T3 activity, with no session', async () => {
  const { out } = await withProject([], 'true', { args: ['--provider', 'codex', '--model', 'stub'] });
  assert.equal(out.status, 'completed');
  assert.equal(out.activitySource, 't3-activity');
  assert.deepEqual(out.toolCalls, []);
  assert.equal(out.session, null);
  assert.equal(out.pendingQuestion, null);
  assert.equal(out.revision.mode, 'installed');
  assert.equal(out.revision.loader, 'installed');
  assert.equal(out.revision.proven, false);
  assert.equal(out.revision.provider, 'stub');
});

test('a --head lane with a non-Claude --provider refuses the exact-head claim before it starts a thread', async () => {
  const { out } = await withProject([], 'true', { installed: false, args: ['--provider', 'codex'], exit: 1, starts: false });
  assert.equal(out.thread, null);
  assert.equal(out.marketplace, null);
  assert.deepEqual(out.revision, { requestedSha: out.head.sha, mode: 'head', provider: 'codex', loader: 'unsupported', marker: null, proven: false, evidence: out.revision.evidence });
  assert.match(out.revision.evidence, /codex/);
  assert.match(out.error, /--installed/);
});

test('a --head lane whose project default resolves to a non-Claude provider fails as unproven after the run', async () => {
  const { out } = await withProject([], 'true', { installed: false, exit: 1 });
  assert.equal(out.status, 'failed');
  assert.equal(out.thread.providerInstanceId, 'stub');
  assert.equal(out.revision.loader, 'unsupported');
  assert.equal(out.revision.provider, 'stub');
  assert.equal(out.revision.proven, false);
  assert.match(out.error, /--installed/);
});

test('a stamped bundle marker proves only the lane that stamped it', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-revision-test-'));
  try {
    const plugin = join(root, 'plugin');
    mkdirSync(join(plugin, 'skills', 'rules'), { recursive: true });
    writeFileSync(join(plugin, 'rules.md'), '# Rules\n');
    writeFileSync(join(plugin, 'skills', 'rules', 'SKILL.md'), '---\nname: rules\n---\nbody\n');
    const sha = 'a'.repeat(40);
    const marker = bundleMarker(sha, '1a2b3c4d');
    assert.equal(marker, 'orbit-lane-rev-aaaaaaaaaaaa-1a2b3c4d');
    stampBundleMarker(plugin, marker);
    const rules = readFileSync(join(plugin, 'rules.md'), 'utf8');
    assert.ok(rules.startsWith('# Rules\n') && rules.includes(`<!-- ${marker} -->`), rules);
    assert.ok(readFileSync(join(plugin, 'skills', 'rules', 'SKILL.md'), 'utf8').startsWith('---\nname: rules\n---\n'), 'frontmatter stays first');
    const session = (name, text) => { const path = join(root, name); writeFileSync(path, JSON.stringify({ type: 'attachment', content: text }) + '\n'); return path; };
    assert.deepEqual(verifyRevisionEvidence({ marker, session: session('ours.jsonl', rules) }), { proven: true, evidence: 'marker observed in lead session' });
    assert.equal(verifyRevisionEvidence({ marker, session: session('other.jsonl', `<!-- ${bundleMarker(sha, '9f9f9f9f')} -->`) }).proven, false, "another lane's marker");
    const runDirOnly = verifyRevisionEvidence({ marker, session: session('rundir.jsonl', `${tmpdir()}/orbit-lane-1a2b3c4d/plugin orbit@orbit-head-1a2b3c4d`) });
    assert.deepEqual(runDirOnly, { proven: false, evidence: 'marker absent from lead session' });
    assert.deepEqual(verifyRevisionEvidence({ marker, session: null }), { proven: false, evidence: 'no lead session file found to verify bundle marker' });
    assert.equal(verifyRevisionEvidence({ marker, session: null, messages: [{ role: 'assistant', text: `saw ${marker}` }] }).evidence, 'marker observed in lead messages');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a waiting non-Claude lead's pending question comes from t3_pending_request", async () => {
  const { out } = await withProject([], 'true', {
    args: ['--timeout', '0.05'], env: { ORBIT_LANE_POLL_MS: '20', STUB_ASKS: '1' }, exit: 2, pending: { 'stub-thread': ['req-1'] },
  });
  assert.equal(out.status, 'waiting');
  assert.deepEqual(out.pendingQuestion, [{ name: 'request_user_input', input: { requestId: 'req-1' } }]);
});

test('a lane whose T3 activity read fails keeps toolCalls null and still completes', async () => {
  const { out } = await withProject([], 'true', { activity: { 'stub-thread': 'error' } });
  assert.equal(out.status, 'completed');
  assert.equal(out.activitySource, null);
  assert.equal(out.toolCalls, null);
});

test('a lane branch name that differs from an existing branch only in case clashes', () => {
  const existing = new Map([['refs/heads/Orbit-Lane/probe-1a2b', 'x'], ['refs/heads/main', 'y']]);
  assert.equal(clash(existing, 'refs/heads/orbit-lane/probe-1a2b'), 'refs/heads/Orbit-Lane/probe-1a2b');
  assert.equal(clash(existing, 'refs/heads/orbit-lane/probe-9f9f'), undefined);
});
