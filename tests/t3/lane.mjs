import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { clash, deleteLaneBranches, listBranches } from './branches.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { HOMES, READERS, kindOf } from './sessions.mjs';

const ORBIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CODEX_USER_ORBITS = [
  { path: join(HOMES.codex, 'skills', 'orbit'), saved: 'codex-skills-orbit' },
  { path: join(homedir(), '.agents', 'skills', 'orbit'), saved: 'agents-skills-orbit' },
];
const LOCK = join(tmpdir(), 'orbit-lane.lock');
const LANE_START = Date.now();

const { values: opts } = parseArgs({
  options: {
    head: { type: 'string' },
    scenario: { type: 'string' },
    message: { type: 'string' },
    out: { type: 'string' },
    project: { type: 'string' },
    installed: { type: 'boolean', default: false },
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
const lexists = (path) => { try { lstatSync(path); return true; } catch { return false; } };

const slug = opts.scenario;
const message = opts.message ?? SCENARIOS[slug]?.prompt;
const id = randomBytes(4).toString('hex');
const out = resolve(opts.out ?? join(tmpdir(), `orbit-lane-${slug}-${id}.json`));
const timeoutMs = Number(opts.timeout) * 60_000;
const wakeMs = opts.wake === undefined ? 0 : Number(opts.wake) * 60_000;
const wakeCount = Number(opts.wakes ?? 1);
const POLL_MS = Number(process.env.ORBIT_LANE_POLL_MS ?? 10_000);
const marketplace = opts.installed ? null : `orbit-head-${id}`;
const runDir = join(tmpdir(), `orbit-lane-${id}`);
const title = `orbit lane ${slug} ${id}`;
const branch = `orbit-lane/${slug}-${id}`;
const sessionCtx = { message, since: LANE_START, homes: HOMES };

const result = {
  scenario: slug ?? null, message: message ?? null,
  head: { ref: opts.head ?? null, sha: null }, project: null, laneCommit: null,
  orbit: opts.installed ? 'installed' : 'head', marketplace: null,
  exit: 1, status: 'error', reply: null, error: null, wake: null, wakes: [],
  pendingQuestion: null, thread: null, threads: [], messages: [],
  session: null, firstTurnInputTokens: null, toolCalls: null,
};

let started = false;
function finish() {
  if (opts.out || started) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log(out);
  }
  process.exit(result.exit);
}

function fail(error) {
  console.error(error);
  result.error = error;
  finish();
}

if (!opts.head || !slug) fail('usage: node tests/t3/lane.mjs --head <ref> --scenario <slug> [--message <text>] [--out <file>] [--project <dir>] [--installed] [--provider <id> --model <slug>] [--timeout <minutes>] [--wake <minutes> [--wakes <n>]]');
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
      for (const [path, text] of Object.entries(files)) writeFileSync(join(build, path), text);
      run('git', ['-C', build, 'add', '-A']);
      run('git', ['-C', build, '-c', 'user.name=orbit lane', '-c', 'user.email=lane@orbit.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
    }
    renameSync(build, dir);
  }
  if (tryRun(cli, ['thread', 'list', '--project', dir, '--json']) === null) run(cli, ['project', 'add', dir, '--title', basename(dir)]);
  return dir;
}

const commonDir = (dir) => run('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
const orbitCommon = commonDir(ORBIT);
const fixture = opts.project ? null : SCENARIOS[slug]?.project;
let base;
try {
  result.project = opts.project ? resolve(opts.project) : fixture ? await withLock(() => scratchProject(fixture)) : dirname(orbitCommon);
  base = commonDir(result.project) === orbitCommon
    ? result.head.sha
    : run('git', ['-C', result.project, 'rev-parse', '--verify', 'HEAD^{commit}']);
} catch (e) {
  fail(fixture ? `scenario project ${fixture.name}: ${gitError(e)}` : `--project ${result.project}: ${gitError(e)}`);
}
const project = result.project;

const unregister = (name) => {
  tryRun('claude', ['plugin', 'uninstall', `orbit@${name}`, '--scope', 'user']);
  tryRun('claude', ['plugin', 'marketplace', 'remove', name]);
};

const holdRecord = (dir) => join(dir, 'codex-skills.json');

function restoreCodexSkills(dir) {
  const record = holdRecord(dir);
  const held = tryRead(record);
  if (!held) return;
  let restored = true;
  for (const { path, saved } of JSON.parse(held)) {
    const from = join(dir, saved);
    if (!lexists(from)) continue;
    try {
      if (!lexists(path)) {
        mkdirSync(dirname(path), { recursive: true });
        renameSync(from, path);
        continue;
      }
      // Next to the skills root, not in it: Codex loads a folder there under any name.
      const keep = join(dirname(dirname(path)), `orbit.${basename(dir)}`);
      if (lexists(keep)) throw new Error(`${keep} exists too`);
      renameSync(from, keep);
      console.error(`warning: ${path} exists again, so the copy the lane moved aside is kept at ${keep}`);
    } catch (e) {
      restored = false;
      console.error(`warning: could not put ${from} back at ${path}: ${e.message}`);
    }
  }
  if (restored) rmSync(record);
}

const removeRunDir = (dir) => existsSync(holdRecord(dir))
  ? console.error(`warning: kept ${dir}, because it still holds a skills folder listed in codex-skills.json`)
  : rmSync(dir, { recursive: true, force: true });

function holdCodexSkills(liveRunDirs) {
  const holder = liveRunDirs.find((dir) => existsSync(holdRecord(dir)));
  if (holder) throw new Error(`another Codex lane (${holder}) holds the user's orbit skills folders; run Codex lanes one at a time`);
  const held = CODEX_USER_ORBITS.filter(({ path }) => lexists(path))
    .map(({ path, saved }) => ({ path, saved, target: lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null }));
  if (!held.length) return;
  undo.push(() => restoreCodexSkills(runDir));
  writeFileSync(holdRecord(runDir), JSON.stringify(held) + '\n');
  for (const { path, saved } of held) renameSync(path, join(runDir, saved));
}

function reap() {
  const live = [];
  for (const m of JSON.parse(run('claude', ['plugin', 'marketplace', 'list', '--json']))) {
    if (!m.name?.startsWith('orbit-head-') || !m.path) continue;
    const pid = Number(tryRead(join(m.path, 'lane.pid')));
    if (pid && alive(pid)) { live.push(m.path); continue; }
    restoreCodexSkills(m.path);
    unregister(m.name);
    removeRunDir(m.path);
    console.error(`reaped ${m.name}, left by a lane that is no longer running`);
  }
  return live;
}

function buildLaneCommit() {
  const index = join(tmpdir(), `orbit-lane-${id}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const existing = tryRun('git', ['-C', project, 'show', `${base}:.claude/settings.json`]);
    const settings = existing ? JSON.parse(existing) : {};
    const user = JSON.parse(tryRead(join(HOMES.claude, 'settings.json')) ?? '{}');
    const enabledOrbits = [user, settings]
      .flatMap((s) => Object.entries(s.enabledPlugins ?? {}))
      .filter(([key, on]) => key.startsWith('orbit@') && on)
      .map(([key]) => [key, false]);
    settings.enabledPlugins = { ...settings.enabledPlugins, ...Object.fromEntries(enabledOrbits), [`orbit@${marketplace}`]: true };
    run('git', ['-C', project, 'read-tree', base], { env });
    const blob = run('git', ['-C', project, 'hash-object', '-w', '--stdin'], { input: JSON.stringify(settings, null, 2) + '\n' });
    run('git', ['-C', project, 'update-index', '--add', '--cacheinfo', `100644,${blob},.claude/settings.json`], { env });
    if (codexLane) {
      const link = run('git', ['-C', project, 'hash-object', '-w', '--stdin'], { input: join(runDir, 'plugin') });
      run('git', ['-C', project, 'update-index', '--add', '--cacheinfo', `120000,${link},.agents/skills/orbit`], { env });
    }
    const tree = run('git', ['-C', project, 'write-tree'], { env });
    return run('git', ['-C', project, '-c', 'user.name=orbit lane', '-c', 'user.email=lane@orbit.invalid', 'commit-tree', tree, '-p', base, '-m', `orbit lane ${slug} ${id}: load orbit from ${marketplace}`]);
  } finally {
    rmSync(index, { force: true });
  }
}

const undo = [];
let cleaning;
const cleanup = () => cleaning ??= withLock(async () => {
  while (undo.length) {
    try { await undo.pop()(); } catch (e) { console.error(`cleanup: ${e.message}`); }
  }
});

let live = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    live?.kill('SIGTERM');
    Object.assign(result, { status: 'interrupted', exit: 1, error: `interrupted by ${signal}` });
    await cleanup();
    finish();
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
    const liveRunDirs = reap();
    undo.push(() => tryRun('claude', ['plugin', 'marketplace', 'remove', marketplace]));
    run('claude', ['plugin', 'marketplace', 'add', runDir]);
    result.marketplace = marketplace;
    undo.push(() => tryRun('claude', ['plugin', 'uninstall', `orbit@${marketplace}`, '--scope', 'user']));
    run('claude', ['plugin', 'install', `orbit@${marketplace}`, '--scope', 'user']);
    run('claude', ['plugin', 'disable', `orbit@${marketplace}`, '--scope', 'user']);
    if (codexLane) holdCodexSkills(liveRunDirs);
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

const codexLane = !opts.installed && kindOf(opts.provider) === 'codex';

function recordThreads(threadId) {
  threadId ??= JSON.parse(tryRun(cli, ['thread', 'list', '--project', project, '--json']) ?? '[]').find((t) => t.title === title)?.threadId;
  if (!threadId) return;
  const lead = { threadId, link: null, waiting: result.status === 'waiting', parentThreadId: null };
  result.threads = [lead];

  const shown = JSON.parse(run(cli, ['thread', 'show', '--json', '--messages', '1000', threadId]));
  const { link, providerInstanceId, model, runtimeMode, branch: threadBranch, worktreePath, pendingRequestCount } = shown.thread;
  result.thread = { threadId, link, providerInstanceId, model, runtimeMode, branch: threadBranch, worktreePath };
  if (result.orbit === 'head' && !codexLane && kindOf(providerInstanceId) === 'codex') {
    result.orbit = 'installed';
    console.error(`warning: the thread runs on ${providerInstanceId}, but the lane linked the head orbit only for --provider codex, so Codex loaded the user's own orbit, if any. orbit is "installed". Pass --provider ${providerInstanceId} to load the head.`);
  }
  result.messages = shown.messages.map(({ role, text }) => ({ role, text }));
  lead.link = link;
  lead.waiting ||= pendingRequestCount > 0;
  if (!worktreePath) return;

  const childIds = new Set(Object.values(READERS).flatMap((reader) => reader.childIds(reader.sessions(worktreePath, sessionCtx))));
  const children = [...childIds].flatMap((id) => {
    const child = JSON.parse(tryRun(cli, ['thread', 'show', '--json', id]) ?? 'null')?.thread;
    return child ? [{ threadId: id, link: child.link ?? null, waiting: child.pendingRequestCount > 0, parentThreadId: child.parentThreadId ?? null }] : [];
  });
  for (let grew = true; grew;) {
    const listed = new Set(result.threads.map((t) => t.threadId));
    const next = children.filter((c) => !listed.has(c.threadId) && listed.has(c.parentThreadId));
    result.threads.push(...next);
    grew = next.length > 0;
  }
}

function readSession({ providerInstanceId, worktreePath }) {
  const kind = kindOf(providerInstanceId);
  const reader = READERS[kind];
  const lead = reader?.lead(reader.sessions(worktreePath, sessionCtx), worktreePath, sessionCtx);
  if (!lead) {
    console.error(`warning: ${reader ? `no ${kind} session for the lead in ${reader.where(worktreePath, sessionCtx)}` : `no session reader for provider ${providerInstanceId}`}, so session, toolCalls and firstTurnInputTokens are null`);
    return;
  }
  result.session = lead.file;
  result.firstTurnInputTokens = lead.firstTurnInputTokens;
  result.toolCalls = lead.toolCalls;
  if (result.status === 'waiting') result.pendingQuestion = lead.pending.length ? lead.pending : null;
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
  if (opts.installed) {
    result.laneCommit = base;
  } else {
    await loadHead();
    result.laneCommit = buildLaneCommit();
  }

  const before = listBranches(project);
  const laneRef = `refs/heads/${branch}`;
  const taken = clash(before, laneRef);
  if (taken) throw new Error(`the lane branch ${branch} matches the existing ${taken} when case is ignored, so the lane will not create it; run the lane again for a new id`);
  undo.push(() => {
    if (!result.thread) {
      try { recordThreads(); } catch (e) { console.error(`cleanup: ${gitError(e)}`); }
    }
    const worktrees = (tryRun('git', ['-C', project, 'worktree', 'list', '--porcelain']) ?? '').split('\n\n').map((b) => b.split('\n'));
    const path = result.thread?.worktreePath
      ?? worktrees.find((lines) => lines.includes(`branch refs/heads/${branch}`))?.[0].replace(/^worktree /, '');
    const checkedOut = worktrees.find((lines) => lines[0] === `worktree ${path}`)?.find((l) => l.startsWith('branch '))?.slice('branch '.length);
    if (path) {
      tryRun('git', ['-C', project, 'worktree', 'remove', '--force', path]);
      // T3 keeps one folder per project for its worktrees and never removes it.
      try { rmdirSync(dirname(path)); } catch {}
    }
    deleteLaneBranches(project, { before, createdAt: result.laneCommit, refs: [laneRef, checkedOut] });
    tryRun('git', ['-C', project, 'worktree', 'prune']);
  });
  if (result.status === 'interrupted') return;
  const args = ['thread', 'start', project, '-', '--worktree', result.laneCommit, '--branch', branch, '--title', title, '--wait', '--json'];
  if (opts.provider) args.push('--provider', opts.provider);
  if (opts.model) args.push('--model', opts.model);
  const { code, stdout, stderr, timedOut } = await startThread(args);
  if (result.status === 'interrupted') return;

  let reply = null;
  try { reply = JSON.parse(stdout); } catch {}
  result.status = timedOut ? 'timeout' : code === 2 ? 'waiting' : code === 0 ? 'completed' : 'failed';
  result.exit = { completed: 0, waiting: 2 }[result.status] ?? 1;
  result.reply = reply?.reply ?? null;
  result.error = reply?.error ?? (result.status === 'timeout' ? `no reply within ${opts.timeout} minutes` : result.status === 'failed' ? stderr.trim() || `t3 exited ${code}` : null);
  recordThreads(reply?.threadId);
  if (!result.thread) return;
  if (timedOut) console.error(`timed out; the thread keeps running in T3: ${result.thread.link}`);
  if (wakeMs && result.status === 'completed') {
    await holdForWake(result.thread.threadId);
    recordThreads(result.thread.threadId);
  }
  if (result.thread.worktreePath) readSession(result.thread);
}

started = true;
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
finish();
