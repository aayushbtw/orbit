import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { clash, deleteLaneBranches, isAncestor, laneBranches, listBranches, listWorktrees } from './branches.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { CLAUDE_HOME, claude, isClaude, pendingQuestions, readT3ActivityTree } from './sessions.mjs';

const ORBIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCK = join(tmpdir(), 'orbit-lane.lock');
const LANE_PROJECT = 'orbit.laneProject';
const LANE_START = Date.now();

const { values: opts } = parseArgs({
  options: {
    head: { type: 'string' },
    scenario: { type: 'string' },
    message: { type: 'string' },
    out: { type: 'string' },
    project: { type: 'string' },
    installed: { type: 'boolean', default: false },
    root: { type: 'boolean', default: false },
    provider: { type: 'string' },
    model: { type: 'string' },
    timeout: { type: 'string', default: '30' },
    wake: { type: 'string' },
    wakes: { type: 'string' },
  },
});

const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...extra }).trim();
const tryRun = (cmd, args, extra) => { try { return run(cmd, args, extra); } catch { return null; } };
const tryRead = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const gitError = (e) => (e.stderr?.toString().trim() || e.message);

const slug = opts.scenario;
const message = opts.message ?? SCENARIOS[slug]?.prompt;
const workerId = process.env.ORBIT_LANE_WORKER_ID;
const id = workerId ?? randomBytes(4).toString('hex');
const out = resolve(opts.out ?? join(tmpdir(), `orbit-lane-${slug}-${id}.json`));

const ORPHANING_LAUNCHER = `const { openSync } = require('node:fs');
const { spawn } = require('node:child_process');
const [log, ...args] = process.argv.slice(1);
const fd = openSync(log, 'w');
const worker = spawn(process.execPath, args, { detached: true, stdio: ['ignore', fd, fd] });
worker.unref();
process.stdout.write(String(worker.pid));`;

async function launch() {
  const log = `${out}.log`;
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const pid = Number(run(process.execPath, ['-e', ORPHANING_LAUNCHER, log, fileURLToPath(import.meta.url), ...process.argv.slice(2), '--out', out], { env: { ...process.env, ORBIT_LANE_WORKER_ID: id } }));
  console.error(`worker ${pid} runs the lane, logs to ${log} and writes ${out}`);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      console.error(`worker ${pid} keeps running and will write ${out}. Stop it with kill ${pid}.`);
      process.exit(1);
    });
  }
  let shown = 0;
  const drain = () => {
    const text = readFileSync(log);
    process.stderr.write(text.subarray(shown));
    shown = text.length;
  };
  for (; alive(pid); await sleep(200)) drain();
  drain();
  console.log(out);
  let exit = 1;
  try { exit = JSON.parse(readFileSync(out, 'utf8')).exit; } catch {}
  process.exit(exit);
}

if (!opts.head || !slug) {
  console.error('usage: node tests/t3/lane.mjs --head <ref> --scenario <slug> [--message <text>] [--out <file>] [--project <dir>] [--installed] [--root] [--provider <id> --model <slug>] [--timeout <minutes>] [--wake <minutes> [--wakes <n>]]');
  process.exit(1);
}
if (!workerId) await launch();

const memoryDir = `${out.replace(/\.json$/, '')}.memory`;
const timeoutMs = Number(opts.timeout) * 60_000;
const wakeMs = opts.wake === undefined ? 0 : Number(opts.wake) * 60_000;
const wakeCount = Number(opts.wakes ?? 1);
const POLL_MS = Number(process.env.ORBIT_LANE_POLL_MS ?? 10_000);
const marketplace = opts.installed ? null : `orbit-head-${id}`;
const runDir = join(tmpdir(), `orbit-lane-${id}`);
const title = `orbit lane ${slug} ${id}`;
const branch = `orbit-lane/${slug}-${id}`;
const sessionCtx = { message, since: LANE_START, home: CLAUDE_HOME };

const result = {
  scenario: slug ?? null, message: message ?? null,
  head: { ref: opts.head ?? null, sha: null }, project: null, laneCommit: null,
  orbit: opts.installed ? 'installed' : 'head', marketplace: null, memoryDir,
  exit: 1, status: 'error', reply: null, error: null, wake: null, wakes: [],
  pendingQuestion: null, thread: null, threads: [], messages: [],
  session: null, firstTurnInputTokens: null, activitySource: null, toolCalls: null, branches: null, kept: null,
};

function save() {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
}

function finish() {
  save();
  process.exit(result.exit);
}

function fail(error) {
  console.error(error);
  result.error = error;
  finish();
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`--scenario must be lowercase letters, digits and hyphens, got ${slug}`);
if (!message) fail(`--scenario ${slug} is not built in (${Object.keys(SCENARIOS).join(', ')}), so it needs --message`);
if (!(timeoutMs > 0)) fail(`--timeout must be a positive number of minutes, got ${opts.timeout}`);
if (opts.wake !== undefined && !(wakeMs > 0)) fail(`--wake must be a positive number of minutes, got ${opts.wake}`);
if (opts.wakes !== undefined && opts.wake === undefined) fail('--wakes needs --wake');
if (!(Number.isInteger(wakeCount) && wakeCount > 0)) fail(`--wakes must be a positive whole number, got ${opts.wakes}`);

const candidates = [process.env.T3CODE_CLI_PATH, 't3'].filter(Boolean);
const cli = candidates.find((c) => tryRun(c, ['--version']) !== null);
if (!cli) fail(`no T3 CLI runs: tried T3CODE_CLI_PATH (${process.env.T3CODE_CLI_PATH ?? 'unset'}) and t3 on PATH. Install T3 Code or set T3CODE_CLI_PATH.`);

try {
  result.head.sha = run('git', ['-C', ORBIT, 'rev-parse', '--verify', `${opts.head}^{commit}`]);
} catch (e) {
  fail(gitError(e));
}

let locked = false;
async function withLock(fn) {
  if (locked) return fn();
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, 'pid'), String(process.pid));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(tryRead(join(LOCK, 'pid')));
      let age = 0;
      try { age = Date.now() - statSync(LOCK).mtimeMs; } catch { continue; }
      if (pid ? !alive(pid) : age > 5000) { rmSync(LOCK, { recursive: true, force: true }); continue; }
      await sleep(200);
    }
  }
  locked = true;
  try { return await fn(); } finally { rmSync(LOCK, { recursive: true, force: true }); locked = false; }
}

function scratchProject({ name, commits }) {
  const hash = createHash('sha256').update(JSON.stringify(commits)).digest('hex').slice(0, 8);
  const dir = join(realpathSync(tmpdir()), `orbit-lane-project-${name}-${hash}`);
  if (!existsSync(dir)) {
    const build = `${dir}.${id}`;
    run('git', ['init', '-q', '-b', 'main', build]);
    for (const { message, files } of commits) {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(build, path)), { recursive: true });
        writeFileSync(join(build, path), text);
      }
      run('git', ['-C', build, 'add', '-A']);
      run('git', ['-C', build, '-c', 'user.name=orbit lane', '-c', 'user.email=lane@orbit.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
    }
    renameSync(build, dir);
  }
  run('git', ['-C', dir, 'config', '--local', LANE_PROJECT, 'true']);
  if (tryRun(cli, ['thread', 'list', '--project', dir, '--json']) === null) run(cli, ['project', 'add', dir, '--title', basename(dir)]);
  return dir;
}

const commonDir = (dir) => run('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
const orbitCommon = commonDir(ORBIT);
const fixture = opts.project ? null : SCENARIOS[slug]?.project;
let base;
let rootBranch = null;
try {
  result.project = opts.project ? resolve(opts.project) : fixture ? await withLock(() => scratchProject(fixture)) : dirname(orbitCommon);
  const isOrbit = commonDir(result.project) === orbitCommon;
  if (opts.root && tryRun('git', ['-C', result.project, 'config', '--local', '--bool', '--get', LANE_PROJECT]) !== 'true') {
    throw new Error(`--root runs only in a scenario project the lane built, which sets ${LANE_PROJECT} in its git config, because its cleanup checks the root out with -f and force-removes worktrees and branches made off the lane commit; drop --project or point it at such a project`);
  }
  if (!isOrbit) {
    const headRef = tryRun('git', ['-C', result.project, 'symbolic-ref', '-q', 'HEAD']);
    if (headRef?.startsWith('refs/heads/orbit-lane/')) throw new Error(`the project root is on ${headRef}, so a --root lane is using it; wait for that lane to end`);
    if (opts.root && !headRef) throw new Error('--root needs the project root on a branch, so cleanup can switch back to it');
    if (opts.root && run('git', ['-C', result.project, 'status', '--porcelain'])) throw new Error('--root needs a clean project root, because the lane switches it to the lane commit');
    rootBranch = opts.root ? headRef.slice('refs/heads/'.length) : null;
  }
  base = isOrbit ? result.head.sha : run('git', ['-C', result.project, 'rev-parse', '--verify', 'HEAD^{commit}']);
} catch (e) {
  fail(fixture ? `scenario project ${fixture.name}: ${gitError(e)}` : `--project ${result.project}: ${gitError(e)}`);
}
const project = result.project;
const prerequisite = SCENARIOS[slug]?.prerequisite;

const unregister = (name) => {
  tryRun('claude', ['plugin', 'uninstall', `orbit@${name}`, '--scope', 'user']);
  tryRun('claude', ['plugin', 'marketplace', 'remove', name]);
};

const removeRunDir = (dir) => rmSync(dir, { recursive: true, force: true });

function reap() {
  for (const m of JSON.parse(run('claude', ['plugin', 'marketplace', 'list', '--json']))) {
    if (!m.name?.startsWith('orbit-head-') || !m.path) continue;
    const pid = Number(tryRead(join(m.path, 'lane.pid')));
    if (pid && alive(pid)) continue;
    unregister(m.name);
    removeRunDir(m.path);
    console.error(`reaped ${m.name}, left by a lane that is no longer running`);
  }
}

function buildLaneCommit() {
  const index = join(tmpdir(), `orbit-lane-${id}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const tracked = (path) => JSON.parse(tryRun('git', ['-C', project, 'show', `${base}:${path}`]) ?? '{}');
  const add = (mode, path, input) => {
    const blob = run('git', ['-C', project, 'hash-object', '-w', '--stdin'], { input });
    run('git', ['-C', project, 'update-index', '--add', '--cacheinfo', `${mode},${blob},${path}`], { env });
  };
  const json = (value) => JSON.stringify(value, null, 2) + '\n';
  try {
    run('git', ['-C', project, 'read-tree', base], { env });
    add('100644', '.claude/settings.local.json', json({ ...tracked('.claude/settings.local.json'), autoMemoryDirectory: memoryDir }));
    if (marketplace) {
      const settings = tracked('.claude/settings.json');
      const user = JSON.parse(tryRead(join(CLAUDE_HOME, 'settings.json')) ?? '{}');
      const enabledOrbits = [user, settings]
        .flatMap((s) => Object.entries(s.enabledPlugins ?? {}))
        .filter(([key, on]) => key.startsWith('orbit@') && on)
        .map(([key]) => [key, false]);
      settings.enabledPlugins = { ...settings.enabledPlugins, ...Object.fromEntries(enabledOrbits), [`orbit@${marketplace}`]: true };
      add('100644', '.claude/settings.json', json(settings));
    }
    const tree = run('git', ['-C', project, 'write-tree'], { env });
    return run('git', ['-C', project, '-c', 'user.name=orbit lane', '-c', 'user.email=lane@orbit.invalid', 'commit-tree', tree, '-p', base, '-m', `orbit lane ${slug} ${id}${marketplace ? `: load orbit from ${marketplace}` : ''}`]);
  } finally {
    rmSync(index, { force: true });
  }
}

const runState = (threadId) => {
  const thread = JSON.parse(tryRun(cli, ['thread', 'show', '--json', threadId]) ?? 'null')?.thread;
  return !thread ? 'unknown' : thread.pendingRequestCount > 0 ? 'waiting' : thread.activeRunId ? 'running' : 'idle';
};
const doneWithWorktree = (state) => state === 'idle' || state === 'waiting';
const END_ACTION = { idle: 'settle', waiting: 'archive' };

// Children count too, because cleanup removes their worktrees.
function laneState() {
  for (const { threadId } of result.threads.length ? result.threads : [result.thread]) {
    const state = runState(threadId);
    if (!doneWithWorktree(state)) return state;
  }
  return 'idle';
}

async function runStateAfterGrace({ link }) {
  const deadline = Date.now() + timeoutMs;
  let state = laneState();
  if (!doneWithWorktree(state)) console.error(`thread ${link} or a child is ${state}, so cleanup waits up to ${opts.timeout} minutes for them to go idle`);
  while (!doneWithWorktree(state) && Date.now() < deadline) {
    await sleep(POLL_MS);
    state = laneState();
  }
  return state;
}

function laneWorktree() {
  const worktrees = listWorktrees(project).filter((w) => w.path !== project);
  const path = result.thread?.worktreePath ?? worktrees.find((w) => w.branch === `refs/heads/${branch}`)?.path;
  return { path, checkedOut: worktrees.find((w) => w.path === path)?.branch };
}

const branchWatch = new Map();
function watchBranches(before) {
  for (const { ref, tip, born, renamedFrom } of laneBranches(project, { before, createdAt: result.laneCommit })) {
    const old = renamedFrom.map((from) => branchWatch.get(from)).find(Boolean);
    for (const from of renamedFrom) branchWatch.delete(from);
    const seen = branchWatch.get(ref) ?? { ref, born, tip, worktree: old?.worktree ?? null, child: false };
    seen.tip = tip;
    seen.worktree = listWorktrees(project).find((w) => w.branch === ref)?.path ?? seen.worktree;
    if (prerequisite) seen.adds = tryRun('git', ['-C', project, 'log', '--diff-filter=A', '--reverse', '--format=%H', tip, '--', prerequisite])?.split('\n')[0] || null;
    branchWatch.set(ref, seen);
  }
}

function recordBranches() {
  // A child with isolation "shared" reports the lead's worktree, which stays the lead's.
  const childWorktrees = new Set(result.threads.filter((t) => t.parentThreadId).map((t) => t.worktreePath).filter((path) => path && path !== result.thread?.worktreePath));
  result.branches = [...branchWatch.values()].map((b) => ({ ...b, child: childWorktrees.has(b.worktree) }));
}

function keep(state) {
  const { path, checkedOut } = laneWorktree();
  const left = {
    worktree: path ?? null,
    branch: (checkedOut ?? `refs/heads/${branch}`).replace(/^refs\/heads\//, ''),
    marketplace: result.marketplace,
    runDir: existsSync(runDir) ? runDir : null,
  };
  result.kept = { ...left, rootBranch };
  const root = rootBranch ? ` The project root ${project} stays on ${left.branch}, so run git -C ${project} checkout ${rootBranch} once the thread ends.` : '';
  console.error(`warning: after ${opts.timeout} minutes thread ${result.thread.link} is ${state}, not idle, so cleanup undid nothing and kept ${Object.values(left).filter(Boolean).join(', ')}. The next lane's reaper removes the marketplace once worker ${process.pid} is dead. Remove the worktree with git worktree remove and delete the branch by hand.${root}`);
}

const undo = [];
let watching = null;
let cleaning;
const cleanup = () => cleaning ??= (async () => {
  if (!undo.length) return;
  if (!result.thread) {
    try { await recordThreads(); } catch (e) { console.error(`cleanup: ${gitError(e)}`); }
  }
  const state = result.thread ? await runStateAfterGrace(result.thread) : 'idle';
  if (watching) {
    clearInterval(watching.timer);
    try { watchBranches(watching.before); } catch (e) { console.error(`cleanup: ${gitError(e)}`); }
    recordBranches();
  }
  if (!doneWithWorktree(state)) return keep(state);
  await withLock(async () => {
    while (undo.length) {
      try { await undo.pop()(); } catch (e) { console.error(`cleanup: ${e.message}`); }
    }
  });
})();

// The CLI reaches the server's /mcp tools with an mcp-client session but has no organize command and lists no subagent threads, so the lane does the same.
async function withMcp(fn) {
  let sessionId;
  try {
    const issue = run(cli, ['auth', 'session', 'issue', '--subject', 'mcp-client', '--scope', 'orchestration:read', '--scope', 'orchestration:operate', '--ttl', '5m', '--label', title, '--json']);
    // Read before JSON.parse, so output that fails to parse still gets its session revoked.
    sessionId = issue.match(/"sessionId"\s*:\s*"([^"]+)"/)?.[1];
    const issued = JSON.parse(issue);
    const { origin } = JSON.parse(readFileSync(join(process.env.T3CODE_HOME ?? join(homedir(), '.t3'), 'userdata', 'server-runtime.json'), 'utf8'));
    let session = null;
    let n = 0;
    const rpc = async (method, params, notify = false) => {
      const res = await fetch(new URL('/mcp', origin), {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session && { 'mcp-session-id': session }) },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(!notify && { id: ++n }) }),
      });
      session ??= res.headers.get('mcp-session-id');
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} got HTTP ${res.status} ${text}`);
      if (notify) return null;
      const reply = JSON.parse(text.trimStart().startsWith('{') ? text : text.split('\n').findLast((l) => l.startsWith('data:')).slice(5));
      if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
      return reply.result;
    };
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'orbit-lane', version: '1' } });
    await rpc('notifications/initialized', {}, true);
    return await fn(async (name, args) => {
      const done = await rpc('tools/call', { name, arguments: args });
      const text = done.content?.find((c) => c.text)?.text;
      if (done.isError) throw new Error(text ?? 'tool error');
      return done.structuredContent ?? JSON.parse(text ?? '{}');
    });
  } finally {
    if (sessionId) tryRun(cli, ['auth', 'session', 'revoke', sessionId]);
  }
}

const organize = (calls) => withMcp(async (tool) => {
  for (const call of calls) {
    try {
      await tool('t3_thread_organize', call);
      console.error(`${call.action}d thread ${call.threadId}`);
    } catch (e) {
      console.error(`warning: could not ${call.action} thread ${call.threadId}: ${e.message}`);
    }
  }
});

const projectThreads = (projectId) => withMcp(async (tool) => {
  const threads = [];
  for (let cursor = 0; cursor !== null;) {
    const page = await tool('t3_thread_list', { projectId, includeSubagents: true, limit: 100, cursor });
    threads.push(...(page.threads ?? []));
    cursor = page.nextCursor ?? null;
  }
  return threads;
});

async function endThreads() {
  const calls = result.threads.flatMap(({ threadId }) => {
    const action = END_ACTION[runState(threadId)];
    return action ? [{ threadId, action }] : [];
  });
  if (!calls.length) return;
  try {
    await organize(calls);
  } catch (e) {
    console.error(`warning: could not settle or archive ${calls.map((c) => c.threadId).join(', ')}: ${gitError(e)}`);
  }
}

let ending;
const end = () => ending ??= (async () => {
  save();
  await endThreads();
  process.exit(result.exit);
})();

let live = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    live?.kill('SIGTERM');
    Object.assign(result, { status: 'interrupted', exit: 1, error: `interrupted by ${signal}` });
    await cleanup();
    await end();
  });
}

async function loadHead() {
  undo.push(() => removeRunDir(runDir));
  mkdirSync(join(runDir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(runDir, 'lane.pid'), String(process.pid));
  run('tar', ['-x', '-C', runDir], { input: execFileSync('git', ['-C', ORBIT, 'archive', result.head.sha, 'plugin'], { maxBuffer: 256 * 1024 * 1024 }) });
  const manifest = JSON.parse(run('git', ['-C', ORBIT, 'show', `${result.head.sha}:.claude-plugin/marketplace.json`]));
  writeFileSync(join(runDir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ ...manifest, name: marketplace }, null, 2) + '\n');

  await withLock(() => {
    reap();
    undo.push(() => tryRun('claude', ['plugin', 'marketplace', 'remove', marketplace]));
    run('claude', ['plugin', 'marketplace', 'add', runDir]);
    result.marketplace = marketplace;
    undo.push(() => tryRun('claude', ['plugin', 'uninstall', `orbit@${marketplace}`, '--scope', 'user']));
    run('claude', ['plugin', 'install', `orbit@${marketplace}`, '--scope', 'user']);
    run('claude', ['plugin', 'disable', `orbit@${marketplace}`, '--scope', 'user']);
  });
}

function startThread(args) {
  return new Promise((done) => {
    const child = spawn(cli, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    live = child;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 10_000).unref();
    }, timeoutMs);
    const settle = (code) => { clearTimeout(timer); live = null; done({ code, stdout, stderr, timedOut }); };
    child.on('error', (e) => { stderr += e.message; settle(null); });
    child.on('close', settle);
    child.stdin.end(message);
  });
}

const descendants = (threads, rootId) => {
  const found = new Set([rootId]);
  for (let grew = true; grew;) {
    const next = threads.filter((t) => found.has(t.parentThreadId) && !found.has(t.threadId));
    for (const t of next) found.add(t.threadId);
    grew = next.length > 0;
  }
  found.delete(rootId);
  return found;
};

async function listedChildIds(projectId, threadId) {
  if (!projectId) return [];
  try {
    return [...descendants(await projectThreads(projectId), threadId)];
  } catch (e) {
    console.error(`warning: t3_thread_list could not list subagent threads (${e.message}), so only child ids in Claude session files count`);
    return [];
  }
}

async function recordThreads(threadId) {
  threadId ??= JSON.parse(tryRun(cli, ['thread', 'list', '--project', project, '--json']) ?? '[]').find((t) => t.title === title)?.threadId;
  if (!threadId) return;
  const lead = { threadId, link: null, waiting: result.status === 'waiting', parentThreadId: null, worktreePath: null, providerInstanceId: null, model: null };
  result.threads = [lead];

  const shown = JSON.parse(run(cli, ['thread', 'show', '--json', '--messages', '1000', threadId]));
  const { projectId, link, providerInstanceId, model, runtimeMode, branch: threadBranch, worktreePath, pendingRequestCount } = shown.thread;
  result.thread = { threadId, link, providerInstanceId, model, runtimeMode, branch: threadBranch, worktreePath };
  result.messages = shown.messages.map(({ role, text }) => ({ role, text }));
  Object.assign(lead, { link, waiting: lead.waiting || pendingRequestCount > 0, worktreePath: worktreePath ?? null, providerInstanceId: providerInstanceId ?? null, model: model ?? null });

  const childIds = new Set([
    ...await listedChildIds(projectId, threadId),
    ...sessionDirs().flatMap((dir) => claude.childIds(claude.sessions(dir, sessionCtx))),
  ]);
  const children = [...childIds].flatMap((id) => {
    const child = JSON.parse(tryRun(cli, ['thread', 'show', '--json', id]) ?? 'null')?.thread;
    return child ? [{ threadId: id, link: child.link ?? null, waiting: child.pendingRequestCount > 0, parentThreadId: child.parentThreadId ?? null, worktreePath: child.worktreePath ?? null, providerInstanceId: child.providerInstanceId ?? null, model: child.model ?? null }] : [];
  });
  for (let grew = true; grew;) {
    const listed = new Set(result.threads.map((t) => t.threadId));
    const next = children.filter((c) => !listed.has(c.threadId) && listed.has(c.parentThreadId));
    result.threads.push(...next);
    grew = next.length > 0;
  }
}

// A thread on the project root has no worktreePath, and Claude Code moves its session to the folder of the worktree EnterWorktree makes.
const sessionDirs = () => result.thread.worktreePath
  ? [result.thread.worktreePath]
  : [project, ...listWorktrees(project).map((w) => w.path).filter((path) => path.startsWith(join(project, '.claude', 'worktrees') + '/'))];

async function readSession({ threadId, providerInstanceId }) {
  const dirs = sessionDirs();
  const lead = isClaude(providerInstanceId) && dirs.map((dir) => claude.lead(claude.sessions(dir, sessionCtx), dir, sessionCtx)).find(Boolean);
  if (lead) {
    result.activitySource = 'claude-jsonl';
    result.session = lead.file;
    result.firstTurnInputTokens = lead.firstTurnInputTokens;
    result.toolCalls = lead.toolCalls;
    if (result.status === 'waiting') result.pendingQuestion = lead.pending.length ? lead.pending : null;
    return;
  }
  const why = isClaude(providerInstanceId) ? `no Claude session for the lead in ${dirs.map((dir) => claude.where(dir, sessionCtx)).join(' or ')}` : `the lead runs on ${providerInstanceId}`;
  try {
    await withMcp(async (tool) => {
      const { toolCalls, pending } = await readT3ActivityTree(tool, threadId, result.threads);
      result.toolCalls = toolCalls;
      result.activitySource = 't3-activity';
      if (result.status === 'waiting') result.pendingQuestion = await pendingQuestions(tool, threadId, pending);
    });
    console.error(`${why}, so toolCalls come from t3_thread_read activity; session and firstTurnInputTokens stay null`);
  } catch (e) {
    console.error(`warning: ${why}, and t3_thread_read activity failed (${e.message}), so session, toolCalls and firstTurnInputTokens are null and only outcome checks grade this lane`);
  }
}

function wakeRuns(threadId) {
  let shown;
  try { shown = JSON.parse(run(cli, ['thread', 'show', '--json', '--messages', '1000', threadId])); } catch { return []; }
  if (shown.thread.activeRunId) return [];
  const firstRun = shown.messages.find((m) => m.runId)?.runId;
  return [...Map.groupBy(shown.messages.filter((m) => m.role === 'assistant' && m.runId !== firstRun), (m) => m.runId).values()];
}

async function holdForWake(threadId) {
  result.wake = 'none';
  const seen = new Map();
  for (const deadline = Date.now() + wakeMs; ; await sleep(POLL_MS)) {
    const woke = wakeRuns(threadId);
    if (woke.length) {
      result.wake = 'arrived';
      result.wakes = woke.map((msgs) => {
        if (!seen.has(msgs[0].runId)) seen.set(msgs[0].runId, new Date().toISOString());
        return { at: seen.get(msgs[0].runId), text: msgs.at(-1).text };
      });
    }
    if (woke.length >= wakeCount || Date.now() >= deadline) return;
  }
}

async function lane() {
  mkdirSync(memoryDir, { recursive: true });
  if (!opts.installed) await loadHead();
  result.laneCommit = buildLaneCommit();

  const before = listBranches(project);
  const laneRef = `refs/heads/${branch}`;
  const taken = clash(before, laneRef);
  if (taken) throw new Error(`the lane branch ${branch} matches the existing ${taken} when case is ignored, so the lane will not create it; run the lane again for a new id`);
  const worktreesBefore = new Set(listWorktrees(project).map((w) => w.path));
  undo.push(() => {
    // A branch born at the lane commit can be reset off it, as an owner's reset to trunk does, so its worktree counts too.
    const ours = new Set(laneBranches(project, { before, createdAt: result.laneCommit }).map((b) => b.ref));
    const made = listWorktrees(project)
      .filter((w) => !worktreesBefore.has(w.path) && (ours.has(w.branch) || (w.head && isAncestor(project, result.laneCommit, w.head))))
      .map((w) => w.path);
    for (const path of new Set([laneWorktree().path, ...made].filter(Boolean))) {
      // EnterWorktree locks its worktree, and only a second --force removes a locked one.
      tryRun('git', ['-C', project, 'worktree', 'remove', '--force', '--force', path]);
      // T3 keeps one folder per project for its worktrees, and EnterWorktree one under .claude; neither is removed.
      try { rmdirSync(dirname(path)); } catch {}
    }
    deleteLaneBranches(project, { before, createdAt: result.laneCommit });
    tryRun('git', ['-C', project, 'worktree', 'prune']);
    if (rootBranch) try { rmdirSync(join(project, '.claude')); } catch {}
  });
  // Checked again under the lock, because a parallel --root lane may have taken the root since the first check.
  if (rootBranch) await withLock(() => {
    const onRoot = tryRun('git', ['-C', project, 'symbolic-ref', '-q', 'HEAD']) === `refs/heads/${rootBranch}`;
    if (!onRoot || run('git', ['-C', project, 'status', '--porcelain'])) throw new Error(`the project root left ${rootBranch} or gained edits since the lane started, so another --root lane may hold it; wait for that lane to end`);
    const exclude = join(commonDir(project), 'info', 'exclude');
    const excluded = tryRead(exclude);
    undo.push(() => {
      tryRun('git', ['-C', project, 'checkout', '-q', '-f', rootBranch]);
      if (excluded !== null && tryRead(exclude) !== excluded) writeFileSync(exclude, excluded);
    });
    run('git', ['-C', project, 'checkout', '-q', '-b', branch, result.laneCommit]);
  });
  if (result.status === 'interrupted') return;
  const args = ['thread', 'start', project, '-', ...(rootBranch ? [] : ['--worktree', result.laneCommit, '--branch', branch]), '--title', title, '--wait', '--json'];
  if (opts.provider) args.push('--provider', opts.provider);
  if (opts.model) args.push('--model', opts.model);
  watching = { before, timer: setInterval(() => { try { watchBranches(before); } catch {} }, Math.min(POLL_MS, 5000)) };
  const { code, stdout, stderr, timedOut } = await startThread(args);
  if (result.status === 'interrupted') return;

  let reply = null;
  try { reply = JSON.parse(stdout); } catch {}
  result.status = timedOut ? 'timeout' : code === 2 ? 'waiting' : code === 0 ? 'completed' : 'failed';
  result.exit = { completed: 0, waiting: 2 }[result.status] ?? 1;
  result.reply = reply?.reply ?? null;
  result.error = reply?.error ?? (result.status === 'timeout' ? `no reply within ${opts.timeout} minutes` : result.status === 'failed' ? stderr.trim() || `t3 exited ${code}` : null);
  await recordThreads(reply?.threadId);
  if (!result.thread) return;
  if (wakeMs && result.status === 'completed') {
    await holdForWake(result.thread.threadId);
    await recordThreads(result.thread.threadId);
  }
  await readSession(result.thread);
}

try {
  await lane();
} catch (e) {
  result.status = 'failed';
  result.exit = 1;
  result.error = gitError(e);
  console.error(result.error);
} finally {
  await cleanup();
}
await end();
