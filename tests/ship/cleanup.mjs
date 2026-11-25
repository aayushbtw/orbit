import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PLUGIN_DIR, createLeads, orbitRev, readJsonl } from '../routing/lead.mjs';
import { grade } from './grade.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROMPT = '/orbit:start fix the typo "teh" in README.md';
const PROJECT = {
  name: 'greet',
  message: 'Initial greet library',
  files: {
    'AGENTS.md': `# greet

A tiny greeting library. Plain ES modules, no dependencies.

## Workflow

- Check: \`node --test\`
- Land: main
`,
    'README.md': `# greet

A small library that says hello. Call \`greet(name)\` to get teh greeting for a name.
`,
    'src/greet.mjs': `export const greet = (name) => \`Hello, \${name}!\`;
`,
    'test/greet.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greet.mjs';

test('greet says hello by name', () => {
  assert.equal(greet('Ada'), 'Hello, Ada!');
});
`,
  },
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { values: opts } = parseArgs({
  options: {
    model: { type: 'string', default: 'opus' },
    runs: { type: 'string', default: '1' },
    ref: { type: 'string' },
    'plugin-dir': { type: 'string' },
    keep: { type: 'boolean', default: false },
    grade: { type: 'string' },
  },
});
if (!['opus', 'sonnet', 'fable', 'haiku'].includes(opts.model)) fail(`--model must be opus, sonnet, fable or haiku, got ${opts.model}`);
if (opts.ref && opts['plugin-dir']) fail('--ref and --plugin-dir are exclusive');
const runs = Number(opts.runs);
if (!Number.isInteger(runs) || runs < 1) fail(`--runs must be a positive integer, got ${opts.runs}`);

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function exportRef(ref, outRoot) {
  const sha = git(REPO, 'rev-parse', `${ref}^{commit}`).trim();
  const dir = join(outRoot, `orbit-${sha.slice(0, 12)}`);
  mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['-C', REPO, 'archive', '--format=tar', sha, 'plugin'], { maxBuffer: 1 << 28 }) });
  return { pluginDir: join(dir, 'plugin'), rev: { ref, sha, dirty: false } };
}

function pluginSource(outRoot) {
  if (opts.ref) return exportRef(opts.ref, outRoot);
  if (opts['plugin-dir']) {
    const pluginDir = resolve(opts['plugin-dir']);
    if (!existsSync(join(pluginDir, 'manifest.json'))) fail(`--plugin-dir ${pluginDir} has no manifest.json`);
    return { pluginDir, rev: orbitRev(pluginDir) };
  }
  return { pluginDir: PLUGIN_DIR, rev: orbitRev() };
}

function endState(project) {
  const root = realpathSync(project);
  const rel = (path) => relative(root, existsSync(path) ? realpathSync(path) : path) || '.';
  let originReadme = null;
  try { originReadme = git(`${project}-origin.git`, 'show', 'main:README.md'); } catch {}
  const worktrees = git(project, 'worktree', 'list', '--porcelain').split('\n\n').filter((b) => b.trim()).map((block) => {
    const path = block.match(/^worktree (.*)$/m)[1];
    let dirty = null;
    try { dirty = git(path, 'status', '--porcelain').trim() !== ''; } catch {}
    return { path: rel(path), branch: block.match(/^branch refs\/heads\/(.*)$/m)?.[1] ?? null, dirty };
  });
  return {
    originReadme,
    originLog: git(`${project}-origin.git`, 'log', '--oneline', 'main').trim().split('\n'),
    worktrees,
    branches: git(project, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n').filter(Boolean),
  };
}

const readJson = (path) => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
const money = (n) => n == null ? '$?' : `$${n.toFixed(2)}`;

function report(outDir, exit) {
  const state = readJson(join(outDir, 'state.json'));
  if (!state) return { outDir, checks: [{ id: 'landed', status: 'FAIL', detail: ['no state.json: the end state was not captured'] }], info: null };
  const meta = readJson(join(outDir, 'meta.json'));
  const { checks, info } = grade(readJsonl(join(outDir, 'stream.jsonl')), state);
  console.log(`\n${outDir} (${exit}) orbit ${meta?.ref ? `${meta.ref} ` : ''}${meta?.sha ?? 'unrecorded'}${meta?.dirty ? ' (dirty)' : ''}`);
  for (const c of checks) {
    console.log(`  ${c.status.padEnd(4)} ${c.id.padEnd(17)} ${c.detail[0]}`);
    for (const line of c.detail.slice(1)) console.log(`       ${' '.repeat(17)} ${line}`);
  }
  console.log(`  INFO ${info.end}, ${info.turns} turns, ${money(info.cost)}, tool calls lead ${info.calls.lead} subagents ${info.calls.subagents}`);
  console.log(`  INFO spawns: ${info.spawns.join(' | ') || 'none'}`);
  for (const line of info.exits) console.log(`  INFO ${line}`);
  return { outDir, checks, info, meta, exit };
}

const savedRuns = (root) => existsSync(join(root, 'state.json')) || existsSync(join(root, 'stream.jsonl'))
  ? [root]
  : (existsSync(root) ? readdirSync(root) : []).filter((d) => d.startsWith('run-')).sort().map((d) => join(root, d));

let reports;
if (opts.grade) {
  const dirs = savedRuns(resolve(opts.grade));
  if (!dirs.length) fail(`no runs to grade in ${resolve(opts.grade)}: expected state.json or run-*/ directories`);
  reports = dirs.map((d) => report(d, 'saved'));
} else {
  const outRoot = join(tmpdir(), `orbit-ship-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(outRoot, { recursive: true });
  const { pluginDir, rev } = pluginSource(outRoot);
  const leads = createLeads({
    host: 'claude', model: opts.model, keep: opts.keep, pluginDir, project: PROJECT,
    timeoutMs: 45 * 60 * 1000, maxTurns: 150, graceMs: 10_000,
  });
  console.log(`model=${opts.model} runs=${runs} plugin=${pluginDir} out=${outRoot}`);
  const finished = await Promise.all(Array.from({ length: runs }, (_, i) => {
    const outDir = join(outRoot, `run-${i + 1}`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ ...rev, pluginDir, model: opts.model, prompt: PROMPT }, null, 2) + '\n');
    return leads.runLead(outDir, {
      prompt: PROMPT,
      inspect: (project) => {
        try {
          writeFileSync(join(outDir, 'state.json'), JSON.stringify(endState(project), null, 2) + '\n');
        } catch (e) {
          console.error(`${outDir}: end state not captured: ${e.message}`);
        }
      },
    });
  }));
  reports = finished.map(({ outDir, exit }) => {
    const r = report(outDir, exit);
    writeFileSync(join(outDir, 'result.json'), JSON.stringify({ ...r.meta, exit, checks: r.checks, info: r.info }, null, 2) + '\n');
    return r;
  });
}

if (reports.length > 1) {
  console.log(`\nacross ${reports.length} runs:`);
  for (const { id } of reports[0].checks) {
    const statuses = reports.map((r) => r.checks.find((c) => c.id === id)?.status ?? 'N/A');
    const scored = statuses.filter((s) => s !== 'N/A');
    console.log(`  ${id.padEnd(17)} ${scored.filter((s) => s === 'PASS').length}/${scored.length}${scored.length < statuses.length ? ` (n/a ${statuses.length - scored.length})` : ''}`);
  }
}
process.exitCode = reports.some((r) => r.checks.some((c) => c.status === 'FAIL')) ? 1 : 0;
