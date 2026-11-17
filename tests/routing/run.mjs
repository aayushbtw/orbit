import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PLUGIN_DIR, createLeads, orbitRev, readJsonl } from './lead.mjs';

const TIMEOUT_MS = 25 * 60 * 1000;
const DELEGATE = /(^|__)delegate_task$/;
const PROMPT = "/orbit:start the camera jitters when you zoom in past 4x, and goblins die way too fast, bump their HP to 40. I'll land it.";
const ROLES = new Set(['orbit:gitops', 'orbit:verifier', 'orbit:advisor', 'orbit:comment-sicko']);
const FRONTMATTER = Object.fromEntries(readdirSync(join(PLUGIN_DIR, 'agents')).filter((f) => f.endsWith('.md')).map((f) => {
  const frontmatter = readFileSync(join(PLUGIN_DIR, 'agents', f), 'utf8').split('---')[1] ?? '';
  return [`orbit:${f.slice(0, -3)}`, { model: frontmatter.match(/^model:\s*(\S+)/m)?.[1], effort: frontmatter.match(/^effort:\s*(\S+)/m)?.[1] }];
}));

const { values: opts } = parseArgs({
  options: {
    host: { type: 'string', default: 'claude' },
    model: { type: 'string' },
    provider: { type: 'string' },
    runs: { type: 'string', default: '1' },
    keep: { type: 'boolean', default: false },
    grade: { type: 'string' },
  },
});
if (!['claude', 't3'].includes(opts.host)) throw new Error(`--host must be claude or t3, got ${opts.host}`);
if (opts.host === 'claude') {
  opts.model ??= 'opus';
  if (!['opus', 'sonnet', 'fable'].includes(opts.model)) throw new Error(`--model must be opus, sonnet or fable, got ${opts.model}`);
  if (opts.provider) throw new Error('--provider needs --host t3');
}
const runs = Number(opts.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, got ${opts.runs}`);

const leads = opts.grade ? null : createLeads({
  host: opts.host, model: opts.model, provider: opts.provider, keep: opts.keep,
  timeoutMs: TIMEOUT_MS, maxTurns: 80, graceMs: opts.host === 't3' ? 60_000 : 10_000,
});

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

const isAgent = (r) => r.tool_name === 'Agent' || r.tool_name === 'Task';
const isDelegate = (r) => DELEGATE.test(r.tool_name ?? '');

function grade(records) {
  const leadSession = records[0]?.session_id;
  const isLead = (r) => !r.agent_id && (!r.session_id || !leadSession || r.session_id === leadSession);
  const spawns = records.filter((r) => r.event === 'PreToolUse' && (isAgent(r) || isDelegate(r)));
  const delegates = spawns.filter((r) => isLead(r) && isDelegate(r));
  const calls = spawns
    .filter((r) => isLead(r) && isAgent(r))
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
  const childModels = records.filter((r) => r.event === 'PostToolUse' && isLead(r) && isAgent(r)).map((r) => r.resolved_model ?? '?');
  const info = [
    `spawns: ${calls.length + delegates.length} (Agent ${calls.length}, delegate_task ${delegates.length})`,
    `lead spawns: ${calls.map(describe).join(' | ') || 'none'}`,
    `delegate_task spawns: ${delegates.map((r, i) => `#${i + 1} target=${r.tool_input?.target ? JSON.stringify(r.tool_input.target) : 'inherit'}`).join(' | ') || 'none'}`,
    `spawns that omitted effort: ${calls.filter((c) => !('effort' in c)).map(describe).join(', ') || 'none'}`,
    `poteto-agent calls naming neither file: ${unmatched.map(describe).join(', ') || 'none'}`,
    `other non-role spawns: ${others.map(describe).join(', ') || 'none'}`,
    `reached gitops: ${gitops.length}, verifier: ${calls.filter((c) => c.subagent_type === 'orbit:verifier').length}, advisor: ${calls.filter((c) => c.subagent_type === 'orbit:advisor').length}`,
    `nested spawns from children: ${spawns.filter((r) => !isLead(r)).length}`,
    `children ran on: ${childModels.join(', ') || 'none returned'}`,
  ];
  return { checks, info };
}

function leadSummary(outDir) {
  if (existsSync(join(outDir, 'lane.json'))) {
    const lane = JSON.parse(readFileSync(join(outDir, 'lane.json'), 'utf8'));
    return `lead result: lane ${lane.status}, exit ${lane.exit}, ${lane.thread?.link ?? 'no thread'}${lane.error ? `, error: ${lane.error}` : ''}`;
  }
  if (existsSync(join(outDir, 'stdout.log'))) return 'lead result: lane.mjs wrote no lane.json, see stderr.log';
  const results = readJsonl(join(outDir, 'stream.jsonl')).filter((e) => e.type === 'result');
  const last = results.at(-1);
  if (!last) return 'lead result: no result event in stream';
  const turns = results.reduce((sum, r) => sum + (r.num_turns ?? 0), 0);
  return `lead result: ${last.subtype}, ${turns} turns over ${results.length} wake-ups, $${last.total_cost_usd?.toFixed(2) ?? '?'}`;
}

const revLabel = (rev) => rev?.sha ? `orbit ${rev.sha}${rev.dirty ? ' (dirty)' : ''}` : 'orbit unrecorded';

const outRoot = opts.grade ? resolve(opts.grade) : join(tmpdir(), `orbit-routing-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const rev = opts.grade ? null : orbitRev();
const savedRuns = () => existsSync(join(outRoot, 'spawns.jsonl'))
  ? [outRoot]
  : (existsSync(outRoot) ? readdirSync(outRoot) : []).filter((d) => d.startsWith('run-')).sort().map((d) => join(outRoot, d));
const startRun = (outDir) => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(rev) + '\n');
  return leads.runLead(outDir, { prompt: PROMPT, matcher: '^(Agent|Task|.*delegate_task)$' });
};
const finished = opts.grade
  ? savedRuns().map((outDir) => ({ outDir, exit: 'saved' }))
  : (console.log(opts.host === 'claude'
      ? `model=${opts.model} runs=${runs} out=${outRoot}`
      : `host=t3 provider=${opts.provider ?? 'default'} model=${opts.model ?? 'default'} runs=${runs} out=${outRoot}`),
    await Promise.all(Array.from({ length: runs }, (_, i) => startRun(join(outRoot, `run-${i + 1}`)))));
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

const revs = opts.grade
  ? [...new Set(finished.map(({ outDir }) => revLabel(existsSync(join(outDir, 'meta.json')) ? JSON.parse(readFileSync(join(outDir, 'meta.json'), 'utf8')) : null)))]
  : [revLabel(rev)];
console.log(`\n${revs.join('\n')}`);
console.log(`across ${graded.length} run(s):`);
const totals = {};
for (const { id } of graded[0]) {
  const statuses = graded.map((checks) => checks.find((c) => c.id === id).status);
  const scored = statuses.filter((s) => s !== 'N/A');
  const na = statuses.length - scored.length;
  const pass = scored.filter((s) => s === 'PASS').length;
  totals[id] = { pass, scored: scored.length, na };
  console.log(`  ${id.padEnd(16)} ${pass}/${scored.length}${na ? ` (n/a ${na})` : ''}`);
}
if (!opts.grade) writeFileSync(join(outRoot, 'summary.json'), JSON.stringify({ ...rev, host: opts.host, model: opts.model ?? null, runs, checks: totals }, null, 2) + '\n');

process.exitCode = graded.flat().some((c) => c.status === 'FAIL') ? 1 : 0;
