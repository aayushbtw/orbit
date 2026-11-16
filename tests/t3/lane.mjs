import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ORBIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const LOCK = join(tmpdir(), 'orbit-lane.lock');
const SCENARIOS = {
  probe: 'Probe. Make no edits and load no skills. Run pwd, then list every skill whose name starts with orbit: with its description quoted verbatim.',
};

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
  },
});

const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...extra }).trim();
const tryRun = (cmd, args, extra) => { try { return run(cmd, args, extra); } catch { return null; } };
const tryRead = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const gitError = (e) => (e.stderr?.toString().trim() || e.message);
const readJsonl = (path) => (tryRead(path) ?? '').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });

const slug = opts.scenario;
const message = opts.message ?? SCENARIOS[slug];
const id = randomBytes(4).toString('hex');
const out = resolve(opts.out ?? join(tmpdir(), `orbit-lane-${slug}-${id}.json`));
const timeoutMs = Number(opts.timeout) * 60_000;
const marketplace = opts.installed ? null : `orbit-head-${id}`;
const title = `orbit lane ${slug} ${id}`;
const branch = `orbit-lane/${slug}-${id}`;

const result = {
  scenario: slug ?? null, message: message ?? null,
  head: { ref: opts.head ?? null, sha: null }, project: null, laneCommit: null,
  orbit: opts.installed ? 'installed' : 'head', marketplace: null,
  exit: 1, status: 'error', reply: null, error: null,
  pendingQuestion: null, thread: null, messages: [],
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

if (!opts.head || !slug) fail('usage: node tests/t3/lane.mjs --head <ref> --scenario <slug> [--message <text>] [--out <file>] [--project <dir>] [--installed] [--provider <id> --model <slug>] [--timeout <minutes>]');
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`--scenario must be lowercase letters, digits and hyphens, got ${slug}`);
if (!message) fail(`--scenario ${slug} is not built in (${Object.keys(SCENARIOS).join(', ')}), so it needs --message`);
if (!(timeoutMs > 0)) fail(`--timeout must be a positive number of minutes, got ${opts.timeout}`);

const candidates = [process.env.T3CODE_CLI_PATH, 't3'].filter(Boolean);
const cli = candidates.find((c) => tryRun(c, ['--version']) !== null);
if (!cli) fail(`no T3 CLI runs: tried T3CODE_CLI_PATH (${process.env.T3CODE_CLI_PATH ?? 'unset'}) and t3 on PATH. Install T3 Code or set T3CODE_CLI_PATH.`);

try {
  result.head.sha = run('git', ['-C', ORBIT, 'rev-parse', '--verify', `${opts.head}^{commit}`]);
} catch (e) {
  fail(gitError(e));
}

const commonDir = (dir) => run('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
const orbitCommon = commonDir(ORBIT);
let base;
try {
  result.project = opts.project ? resolve(opts.project) : dirname(orbitCommon);
  base = commonDir(result.project) === orbitCommon
    ? result.head.sha
    : run('git', ['-C', result.project, 'rev-parse', '--verify', 'HEAD^{commit}']);
} catch (e) {
  fail(`--project ${result.project}: ${gitError(e)}`);
}
const project = result.project;

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

const unregister = (name) => {
  tryRun('claude', ['plugin', 'uninstall', `orbit@${name}`, '--scope', 'user']);
  tryRun('claude', ['plugin', 'marketplace', 'remove', name]);
};

function reap() {
  for (const m of JSON.parse(run('claude', ['plugin', 'marketplace', 'list', '--json']))) {
    if (!m.name?.startsWith('orbit-head-') || !m.path) continue;
    const pid = Number(tryRead(join(m.path, 'lane.pid')));
    if (pid && alive(pid)) continue;
    unregister(m.name);
    rmSync(m.path, { recursive: true, force: true });
    console.error(`reaped ${m.name}, left by a lane that is no longer running`);
  }
}

function buildLaneCommit() {
  const index = join(tmpdir(), `orbit-lane-${id}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const existing = tryRun('git', ['-C', project, 'show', `${base}:.claude/settings.json`]);
    const settings = existing ? JSON.parse(existing) : {};
    settings.enabledPlugins = { ...settings.enabledPlugins, 'orbit@orbit': false, [`orbit@${marketplace}`]: true };
    run('git', ['-C', project, 'read-tree', base], { env });
    const blob = run('git', ['-C', project, 'hash-object', '-w', '--stdin'], { input: JSON.stringify(settings, null, 2) + '\n' });
    run('git', ['-C', project, 'update-index', '--add', '--cacheinfo', `100644,${blob},.claude/settings.json`], { env });
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
    await cleanup();
    process.exit(1);
  });
}

async function loadHead() {
  const runDir = join(tmpdir(), `orbit-lane-${id}`);
  undo.push(() => rmSync(runDir, { recursive: true, force: true }));
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

function readSession(worktreePath) {
  const dir = join(CLAUDE_DIR, 'projects', worktreePath.replace(/[^a-zA-Z0-9]/g, '-'));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)) : [];
  if (!files.length) {
    console.error(`warning: no Claude session found in ${dir}, so toolCalls and firstTurnInputTokens are null`);
    return;
  }
  const main = files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1);
  const subDir = join(main.slice(0, -'.jsonl'.length), 'subagents');
  const subs = existsSync(subDir) ? readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => join(subDir, f)) : [];
  const mainEntries = readJsonl(main);
  const usage = mainEntries.find((e) => e.type === 'assistant' && e.message?.usage)?.message.usage;

  const seen = new Set();
  const toolUses = (entries, sidechain) => entries
    .filter((e) => e.type === 'assistant' && Array.isArray(e.message?.content))
    .flatMap((e) => e.message.content.filter((c) => c.type === 'tool_use'))
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ id: c.id, name: c.name, input: c.input, sidechain }));
  const mainCalls = toolUses(mainEntries, false);
  const answered = new Set(mainEntries
    .filter((e) => e.type === 'user' && Array.isArray(e.message?.content))
    .flatMap((e) => e.message.content.filter((c) => c.type === 'tool_result').map((c) => c.tool_use_id)));

  result.session = main;
  result.firstTurnInputTokens = usage ? (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) : null;
  result.toolCalls = [...mainCalls, ...subs.flatMap((f) => toolUses(readJsonl(f), true))].map(({ id: _, ...call }) => call);
  if (result.status === 'waiting') {
    const pending = mainCalls.filter((c) => !answered.has(c.id)).map(({ name, input }) => ({ name, input }));
    result.pendingQuestion = pending.length ? pending : null;
  }
}

async function lane() {
  if (opts.installed) {
    result.laneCommit = base;
  } else {
    await loadHead();
    result.laneCommit = buildLaneCommit();
  }

  undo.push(() => {
    const porcelain = tryRun('git', ['-C', project, 'worktree', 'list', '--porcelain']) ?? '';
    const path = porcelain.split('\n\n').find((b) => b.split('\n').includes(`branch refs/heads/${branch}`))?.match(/^worktree (.+)$/m)?.[1];
    if (path) tryRun('git', ['-C', project, 'worktree', 'remove', '--force', path]);
    tryRun('git', ['-C', project, 'branch', '-D', branch]);
    tryRun('git', ['-C', project, 'worktree', 'prune']);
  });
  const args = ['thread', 'start', project, '-', '--worktree', result.laneCommit, '--branch', branch, '--title', title, '--wait', '--json'];
  if (opts.provider) args.push('--provider', opts.provider);
  if (opts.model) args.push('--model', opts.model);
  const { code, stdout, stderr, timedOut } = await startThread(args);

  let reply = null;
  try { reply = JSON.parse(stdout); } catch {}
  const threadId = reply?.threadId
    ?? JSON.parse(tryRun(cli, ['thread', 'list', '--project', project, '--json']) ?? '[]').find((t) => t.title === title)?.threadId;
  result.status = timedOut ? 'timeout' : code === 2 ? 'waiting' : code === 0 ? 'completed' : 'failed';
  result.exit = { completed: 0, waiting: 2 }[result.status] ?? 1;
  result.reply = reply?.reply ?? null;
  result.error = reply?.error ?? (result.status === 'timeout' ? `no reply within ${opts.timeout} minutes` : result.status === 'failed' ? stderr.trim() || `t3 exited ${code}` : null);
  if (!threadId) return;

  const shown = JSON.parse(run(cli, ['thread', 'show', '--json', '--messages', '1000', threadId]));
  const { link, providerInstanceId, model, runtimeMode, branch: threadBranch, worktreePath } = shown.thread;
  result.thread = { threadId, link, providerInstanceId, model, runtimeMode, branch: threadBranch, worktreePath };
  result.messages = shown.messages.map(({ role, text }) => ({ role, text }));
  if (timedOut) console.error(`timed out; the thread keeps running in T3: ${link}`);
  if (worktreePath) readSession(worktreePath);
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
