import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createLeads, orbitRev, readJsonl } from './lead.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLOWS = JSON.parse(readFileSync(join(HERE, 'flows.json'), 'utf8'));
const DELEGATE = /(^|__)delegate_task$/;
const NOT_ROUTES = new Set(['orbit:start', 'orbit:rules']);

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { values: opts } = parseArgs({
  options: {
    host: { type: 'string', default: 'claude' },
    model: { type: 'string' },
    provider: { type: 'string' },
    route: { type: 'string' },
    prompt: { type: 'string' },
    'grade-only': { type: 'string' },
    keep: { type: 'boolean', default: false },
    jobs: { type: 'string', default: '4' },
  },
});
if (!['claude', 't3'].includes(opts.host)) fail(`--host must be claude or t3, got ${opts.host}`);
if (opts.host === 'claude') {
  opts.model ??= 'opus';
  if (!['opus', 'sonnet', 'fable', 'haiku'].includes(opts.model)) fail(`--model must be opus, sonnet, fable or haiku, got ${opts.model}`);
  if (opts.provider) fail('--provider needs --host t3');
}
if (opts.route && opts.prompt) fail('--route and --prompt are exclusive');
if (opts.host === 't3' && !opts.route && !opts.prompt && !opts['grade-only']) {
  fail('--host t3 needs --route or --prompt: each route is a T3 lane thread, and a PR may run at most 4');
}
const jobs = Number(opts.jobs);
if (!Number.isInteger(jobs) || jobs < 1) fail(`--jobs must be a positive integer, got ${opts.jobs}`);

function selectFlows() {
  if (opts.prompt) return [{ route: 'prompt', prompt: opts.prompt, expect: '-' }];
  if (!opts.route) return FLOWS;
  return opts.route.split(',').map((slug) => FLOWS.find((f) => f.route === slug)
    ?? fail(`unknown route ${slug}; known: ${FLOWS.map((f) => f.route).join(', ')}`));
}

const isSpawn = (r) => r.tool_name === 'Agent' || r.tool_name === 'Task' || DELEGATE.test(r.tool_name ?? '');
const isRouteSkill = (r) => r.tool_name === 'Skill' && !NOT_ROUTES.has(r.tool_input?.skill);

function grade({ run, records }) {
  const leadSession = records[0]?.session_id;
  const isLead = (r) => !r.agent_id && (!r.session_id || !leadSession || r.session_id === leadSession);
  const first = records.find((r) => r.event === 'PreToolUse' && isLead(r) && (isRouteSkill(r) || isSpawn(r)));
  const { skill, args } = first?.tool_input ?? {};
  const got = !first ? 'no route'
    : isSpawn(first) ? 'spawn before Skill'
    : skill === 'orbit:playbook' ? [skill, args?.trim().split(/\s+/)[0]].filter(Boolean).join(' ')
    : skill;
  const status = run.expect === '-' ? 'N/A' : got === run.expect ? 'PASS' : 'FAIL';
  return { got, status };
}

function measured(outDir) {
  const last = readJsonl(join(outDir, 'stream.jsonl')).filter((e) => e.type === 'result').at(-1);
  return {
    turns: last?.num_turns ?? null,
    cost: last?.total_cost_usd ?? null,
    cache_read: last?.usage?.cache_read_input_tokens ?? null,
    cache_creation: last?.usage?.cache_creation_input_tokens ?? null,
  };
}

const header = (run) => `${run.sha ? `orbit ${run.sha}${run.dirty ? ' (dirty)' : ''}` : 'orbit unrecorded'} host=${run.host ?? '-'} model=${run.model ?? '-'}`;
const money = (n) => `$${n.toFixed(2)}`;
const totalCost = (runs) => runs.some((r) => r.cost == null) ? null : runs.reduce((sum, r) => sum + r.cost, 0);

function report(graded) {
  let last;
  for (const { run, got, status } of [...graded].sort((a, b) => header(a.run).localeCompare(header(b.run)))) {
    if (header(run) !== last) console.log((last = header(run)));
    const cost = run.cost == null ? '-' : money(run.cost);
    console.log(`  ${status.padEnd(4)} ${run.route.padEnd(16)} expect=${run.expect} got=${got} turns=${run.turns ?? '-'} cost=${cost}${run.want ? ` want=${run.want}` : ''}`);
  }
  const scored = graded.filter((g) => g.status !== 'N/A');
  const total = totalCost(graded.map((g) => g.run));
  console.log(`${scored.filter((g) => g.status === 'PASS').length}/${scored.length} pass, ${total == null ? 'cost unknown' : money(total)}`);
  process.exitCode = graded.every((g) => g.status === 'N/A' || g.status === (g.run.want ?? 'PASS')) ? 0 : 1;
}

function savedRuns(dir) {
  if (existsSync(join(dir, 'run.json'))) return [dir];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => savedRuns(join(dir, e.name)));
}

const gradeDir = (outDir) => {
  const run = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'));
  return { run, ...grade({ run, records: readJsonl(join(outDir, 'spawns.jsonl')) }) };
};

async function pool(items, size, work) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]);
    }
  }));
  return results;
}

if (opts['grade-only']) {
  const root = resolve(opts['grade-only']);
  const dirs = existsSync(root) ? savedRuns(root) : [];
  if (!dirs.length) fail(`no run.json under ${root}`);
  report(dirs.map(gradeDir));
} else {
  const flows = selectFlows();
  const rev = orbitRev();
  const outRoot = join(tmpdir(), `orbit-flows-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const leads = createLeads({
    host: opts.host, model: opts.model, provider: opts.provider, keep: opts.keep,
    timeoutMs: 12 * 60 * 1000, maxTurns: 12, graceMs: opts.host === 't3' ? 60_000 : 10_000,
  });
  console.log(`host=${opts.host}${opts.provider ? ` provider=${opts.provider}` : ''} model=${opts.model ?? 'default'} routes=${flows.length} jobs=${jobs} out=${outRoot}`);
  const graded = await pool(flows, jobs, async ({ route, prompt, expect }) => {
    const outDir = join(outRoot, route);
    mkdirSync(outDir, { recursive: true });
    const run = { route, prompt, expect, ...rev, host: opts.host, model: opts.model ?? null };
    writeFileSync(join(outDir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
    await leads.runLead(outDir, { prompt, matcher: '^(Skill|Agent|Task|.*delegate_task)$', hookArgs: ['stop'] });
    writeFileSync(join(outDir, 'run.json'), JSON.stringify({ ...run, ...measured(outDir) }, null, 2) + '\n');
    return gradeDir(outDir);
  });
  report(graded);
  const rows = graded.map(({ run, got, status }) => ({ route: run.route, expect: run.expect, got, status, turns: run.turns, cost: run.cost }));
  writeFileSync(join(outRoot, 'summary.json'), JSON.stringify({ ...rev, host: opts.host, model: opts.model ?? null, rows, cost: totalCost(rows) }, null, 2) + '\n');
}
