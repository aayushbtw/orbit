#!/usr/bin/env node
import { existsSync, globSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ORBIT_REPO = 'aayushbtw/orbit';
const GUARD = /^This (?:agent|session) is isolated in the worktree /;
const EXCLUDE = ['orbit-lane', 'orbit-ship', 'skyforge', 'greet-'];
const HOUR = 3600e3;

export const REFUSAL_KINDS = [
  ['working dir in shared checkout', /working directory resolved/],
  ['cd before git', /changes directory/],
  ['git aimed elsewhere', /redirects git|points git at/],
  ['git in complex form', /names git/],
  ['value computed at runtime', /computed at runtime/],
  ['opaque program', /hands \S+ the text|with the text|through eval|in a plain command|-exec or xargs|program that can execute/],
  ['not provably git-free', /cannot be shown not to be git/],
  ['too complex', /too complex/],
];

export const CORRECTIONS = [
  ['use advisor', /\b(?:use|ask|let)\s+(?:the\s+)?advisor\b/i],
  ["don't ask me", /\bdo\s?n[o']?t\s+ask\s+me\b|\bstop\s+asking\b/i],
  ['why did you', /\bwhy\s+(?:did|do|are|would)\s+(?:you|u)\b/i],
  ['stop / hold', /^\s*(?:stop|hold)\b|\bhold\s+up\b|\bstop\s+and\s+listen\b/im],
  ['without my approval', /\bwithout\s+my\s+approval\b|\bnever\s+agreed\b|\bdid\s?n[o']?t\s+ask\s+(?:you|u)\s+to\b/i],
];
const NOT_A_PROMPT = /^(?:<|Caveat:|\[Request interrupted|Base directory for this skill|Update on pull request|This session is being continued)/;

const textOf = (content) => typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
const clip = (s) => s.length > 8000 ? `${s.slice(0, 4000)}\n...\n${s.slice(-4000)}` : s;
const refusalText = (call) => call.result?.text.replace(/<\/?tool_use_error>/g, '').trimStart() ?? '';
const isGuardRefusal = (call) => GUARD.test(refusalText(call));
const refusalKind = (call) => {
  const clause = refusalText(call).split(', but ').slice(1).join(', but ');
  return REFUSAL_KINDS.find(([, re]) => re.test(clause))?.[0] ?? 'other';
};
const isSpawn = (call) => call.name === 'Agent' || call.name === 'Task';
const isBackground = (call) => call.input.run_in_background === true || /^Async agent launched/.test(call.result?.text ?? '');
const typeOf = (input) => (input.subagent_type ?? 'general-purpose').replace(/^orbit:/, '');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const tally = (keys) => keys.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});
const encode = (path) => path.replace(/[^a-zA-Z0-9]/g, '-');

function readTranscript(file, { sub }) {
  const calls = new Map();
  const prompts = [];
  let start, end, cwd, finalText = '', apiError = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e.timestamp || (e.isSidechain && !sub)) continue;
    const t = Date.parse(e.timestamp);
    start ??= t;
    end = t;
    cwd ??= e.cwd;
    const content = e.message?.content;
    if (e.type === 'assistant' && Array.isArray(content)) {
      const blocks = content.filter((b) => b.type === 'text' || b.type === 'tool_use');
      if (!blocks.length) continue;
      finalText = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      apiError = e.isApiErrorMessage === true;
      for (const b of blocks) {
        if (b.type === 'tool_use' && !calls.has(b.id)) calls.set(b.id, { id: b.id, name: b.name, input: b.input ?? {}, start: t, end: null, result: null });
      }
    } else if (e.type === 'user') {
      const results = Array.isArray(content) ? content.filter((b) => b.type === 'tool_result') : [];
      for (const b of results) {
        const call = calls.get(b.tool_use_id);
        if (call && !call.result) Object.assign(call, { end: t, result: { text: clip(textOf(b.content)), isError: b.is_error === true, agentId: e.toolUseResult?.agentId } });
      }
      if (!sub && !results.length && !e.isMeta && !e.isCompactSummary) prompts.push(textOf(content).trim());
    }
  }
  return { start, end, cwd, calls: [...calls.values()], prompts, finalText, apiError };
}

const tmpRoots = () => [...new Set([tmpdir(), process.env.TMPDIR, (() => { try { return realpathSync(tmpdir()); } catch { return null; } })()]
  .filter(Boolean).map((p) => p.replace(/\/+$/, '')))];

function excludedBy(project, cwd) {
  const name = basename(project);
  const hit = EXCLUDE.find((s) => name.includes(s) || cwd?.includes(s));
  if (hit) return hit;
  return tmpRoots().some((t) => name.startsWith(encode(t)) || cwd?.startsWith(t)) ? '$TMPDIR' : null;
}

function sessionsIn(project, sinceMs) {
  const sessions = new Map();
  const session = (id) => sessions.get(id) ?? sessions.set(id, { id, project, main: null, subs: [] }).get(id);
  for (const rel of readdirSync(project, { recursive: true })) {
    if (!rel.endsWith('.jsonl')) continue;
    const file = join(project, rel);
    const parts = rel.split('/');
    if (parts.length === 1) {
      if (statSync(file).mtimeMs >= sinceMs) session(rel.slice(0, -'.jsonl'.length)).main = file;
    } else if (parts.includes('subagents') && /^agent-.+\.jsonl$/.test(parts.at(-1))) {
      if (statSync(file).mtimeMs >= sinceMs) session(parts[0]).subs.push(file);
    }
  }
  return [...sessions.values()];
}

function loadSession({ id, project, main, subs }) {
  const mainRec = main ? { kind: 'main', type: 'main', session: id, file: main, ...readTranscript(main, { sub: false }) } : null;
  const subRecs = subs.map((file) => {
    const metaFile = file.replace(/\.jsonl$/, '.meta.json');
    let meta = {};
    try { meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {}; } catch { /* unreadable meta falls back to the spawn link */ }
    return { kind: 'sub', session: id, file, aid: basename(file).slice('agent-'.length, -'.jsonl'.length), meta, ...readTranscript(file, { sub: true }) };
  });
  const spawns = [mainRec, ...subRecs].filter(Boolean).flatMap((a) => a.calls.filter(isSpawn));
  const byId = new Map(spawns.map((c) => [c.id, c]));
  const byAgent = new Map(spawns.filter((c) => c.result?.agentId).map((c) => [c.result.agentId, c]));
  for (const sub of subRecs) {
    sub.spawn = byId.get(sub.meta.toolUseId) ?? byAgent.get(sub.aid) ?? null;
    sub.type = sub.spawn ? typeOf(sub.spawn.input) : (sub.meta.agentType ?? '?').replace(/^orbit:/, '');
  }
  const cwd = mainRec?.cwd ?? subRecs.find((s) => s.cwd)?.cwd;
  return { cwd, agents: [mainRec, ...subRecs].filter((a) => a?.start != null) };
}

const perType = (agents, pred) => {
  const of = tally(agents.map((a) => a.type));
  const hit = tally(agents.filter(pred).map((a) => a.type));
  return Object.fromEntries(Object.entries(hit).map(([k, n]) => [k, `${n}/${of[k]}`]));
};
const verdictOf = (text) => text?.match(/\b(PASS\+NOTES|PASS|FAIL)\b/)?.[1];
const SPAWN_API_ERROR = /API Error|terminated early|Prompt is too long|hit your (?:weekly )?limit|rate limit|overloaded/i;
const SPAWN_INTERRUPTED = /interrupted|Request was aborted|session ended before/i;
export const ORBIT_RULES = { 'rules.md': /\/orbit\/(?:.*\/)?rules\.md$/, 'rules-shared.md': /\/orbit\/(?:.*\/)?rules-shared\.md$/ };
const readsOf = (agent, re) => agent.calls.some((c) => c.name === 'Read' && re.test(c.input.file_path ?? ''));
const isOrbitRun = (main) => main.calls.some((c) => c.name === 'Skill' && /^(?:orbit:)?(?:start|playbook)$/.test(c.input.skill ?? ''))
  || main.prompts.some((p) => p.includes('<command-name>/orbit:start'));
const isPlaybookLoad = (c) => c.name === 'Skill' && /^(?:orbit:)?playbook$/.test(c.input.skill ?? '');
const exitKey = (c) => {
  const discard = c.input.discard_changes === true || c.input.discard_changes === 'true';
  const outcome = !c.result ? 'no result' : (c.result.isError || /refus/i.test(c.result.text)) ? 'refused' : 'ok';
  return `${c.input.action ?? '?'}${discard ? '+discard' : ''} ${outcome}`;
};
const WORKTREE_REMOVE = /\bgit\b[^|;&]*\bworktree\s+remove\b/;
const REMOVE_REFUSALS = [
  ['guard', isGuardRefusal],
  ['safety check', (c) => /removal safety check denied/.test(c.result?.text ?? '')],
  ['git refused', (c) => /^fatal: .*(?:contains modified or untracked files|cannot remove a locked working tree|is not a working tree|is a main working tree)/m.test(c.result?.text ?? '')],
];
const removeOutcome = (c) => REMOVE_REFUSALS.find(([, refused]) => refused(c))?.[0] ?? 'ok';
const ORBIT_ISSUE = new RegExp(`\\bgh\\s+issue\\s+create\\b.*(?:--repo|-R)[\\s=]+${ORBIT_REPO.replace('/', '\\/')}\\b`, 's');
const failureOf = (sub) => {
  const spawnText = !sub.spawn || isBackground(sub.spawn) ? '' : (sub.spawn.result?.text ?? '');
  if (sub.apiError || SPAWN_API_ERROR.test(spawnText.slice(0, 500))) return 'api error';
  if (SPAWN_INTERRUPTED.test(spawnText.slice(0, 300))) return 'interrupted';
  return sub.finalText ? null : 'empty';
};
const correctionsIn = (main) => main.prompts
  .filter((p) => p && !NOT_A_PROMPT.test(p))
  .map((p) => CORRECTIONS.filter(([, re]) => re.test(p.slice(0, 600))).map(([kind]) => kind))
  .filter((kinds) => kinds.length);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const METRICS = [
  {
    id: 'main-sessions', label: 'main sessions',
    measure: ({ mains }) => ({ value: mains.length }),
  },
  {
    id: 'subagents', label: 'subagents by type (from the spawning call)',
    measure: ({ subs, mains }) => ({ value: subs.length, per: [mains.length, 'main session'], breakdown: tally(subs.map((a) => a.type)) }),
  },
  {
    id: 'guard-refusals', label: 'worktree-guard refusals by message kind',
    measure: ({ all }) => {
      const hits = all.flatMap((a) => a.calls.filter(isGuardRefusal));
      return { value: hits.length, per: [all.length, 'agent'], breakdown: tally(hits.map(refusalKind)) };
    },
  },
  {
    id: 'guard-refusals-by-type', label: 'worktree-guard refusals by agent type',
    measure: ({ all }) => {
      const hits = all.flatMap((a) => a.calls.filter(isGuardRefusal).map(() => a.type));
      return { value: hits.length, per: [all.length, 'agent'], breakdown: { ...tally(hits), 'agents refused': perType(all, (a) => a.calls.some(isGuardRefusal)) } };
    },
  },
  {
    id: 'exit-worktree', label: 'ExitWorktree by action, discard_changes, outcome',
    measure: ({ all, mains }) => {
      const calls = all.flatMap((a) => a.calls.filter((c) => c.name === 'ExitWorktree'));
      return { value: calls.length, per: [mains.length, 'main session'], breakdown: tally(calls.map(exitKey)) };
    },
  },
  {
    id: 'worktree-remove-refused', label: '`git worktree remove` refused by the guard, the safety check or git',
    measure: ({ all }) => {
      const outcomes = all.flatMap((a) => a.calls.filter((c) => c.name === 'Bash' && WORKTREE_REMOVE.test(c.input.command ?? '')).map(removeOutcome));
      return { value: outcomes.filter((o) => o !== 'ok').length, per: [outcomes.length, 'call'], breakdown: tally(outcomes) };
    },
  },
  ...Object.entries(ORBIT_RULES).map(([name, re]) => ({
    id: `read-${name.replace('.md', '')}`, label: `subagents that Read orbit's ${name}`,
    measure: ({ subs }) => ({ value: subs.filter((a) => readsOf(a, re)).length, per: [subs.length, 'subagent'], breakdown: perType(subs, (a) => readsOf(a, re)) }),
  })),
  {
    id: 'playbook-loads', label: 'orbit:playbook Skill loads per orbit-run main session',
    measure: ({ mains }) => {
      const runs = mains.filter(isOrbitRun);
      const loads = runs.map((m) => m.calls.filter(isPlaybookLoad));
      const args = loads.flat().map((c) => (c.input.args ?? '').trim().split(/\s+/)[0] || '(none)');
      return { value: args.length, per: [runs.length, 'orbit session'], breakdown: { ...tally(args), 'max/session': Math.max(0, ...loads.map((l) => l.length)) } };
    },
  },
  {
    id: 'verifier-verdicts', label: 'verifier verdicts (final report, else spawn result)',
    measure: ({ subs }) => {
      const vs = subs.filter((a) => a.type === 'verifier');
      return { value: vs.length, breakdown: tally(vs.map((a) => verdictOf(a.finalText) ?? verdictOf(a.spawn?.result?.text) ?? 'none')) };
    },
  },
  {
    id: 'subagent-failures', label: 'crashed or empty subagents',
    measure: ({ subs }) => {
      const failed = subs.map((a) => [a, failureOf(a)]).filter(([, f]) => f);
      return { value: failed.length, per: [subs.length, 'subagent'], breakdown: tally(failed.map(([a, f]) => `${a.type}: ${f}`)) };
    },
  },
  {
    id: 'foreground-agent-calls', label: 'Agent calls from main sessions, foreground vs background',
    measure: ({ mains }) => {
      const calls = mains.flatMap((m) => m.calls.filter(isSpawn));
      const fg = calls.filter((c) => !isBackground(c)).length;
      return { value: fg, per: [mains.length, 'main session'], breakdown: { foreground: fg, background: calls.length - fg } };
    },
  },
  {
    id: 'foreground-agent-wait-h', label: 'hours main thread is blocked on foreground Agent calls (each capped 3 h)',
    measure: ({ mains }) => {
      const calls = mains.flatMap((m) => m.calls.filter((c) => isSpawn(c) && !isBackground(c) && c.end != null));
      const hours = (cs) => round(cs.reduce((s, c) => s + Math.min(c.end - c.start, 3 * HOUR), 0) / HOUR, 1);
      const types = [...new Set(calls.map((c) => typeOf(c.input)))];
      return { value: hours(calls), per: [mains.length, 'main session'], breakdown: Object.fromEntries(types.map((t) => [t, hours(calls.filter((c) => typeOf(c.input) === t))])) };
    },
  },
  {
    id: 'user-corrections', label: 'user prompts that correct orbit (phrase list in README)',
    measure: ({ mains }) => {
      const hits = mains.flatMap(correctionsIn);
      return { value: hits.length, per: [mains.length, 'main session'], breakdown: tally(hits.flat()) };
    },
  },
  {
    id: 'orbit-issues', label: `\`gh issue create --repo ${ORBIT_REPO}\``,
    measure: ({ all, mains }) => {
      const calls = all.flatMap((a) => a.calls.filter((c) => c.name === 'Bash' && ORBIT_ISSUE.test(c.input.command ?? '')));
      const ok = (c) => /github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/.test(c.result?.text ?? '');
      return { value: calls.length, per: [mains.length, 'main session'], breakdown: tally(calls.map((c) => ok(c) ? 'filed' : 'failed')) };
    },
  },
];

export function audit({ projects, since, until, skip = [] }) {
  const sinceMs = Date.parse(`${since}T00:00:00Z`);
  const inWindow = (a) => day(a.start) >= since && (!until || day(a.start) <= until);
  const excluded = {};
  const agents = [];
  for (const project of projects) {
    for (const s of sessionsIn(project, sinceMs)) {
      if (skip.includes(s.id)) continue;
      const { cwd, agents: list } = loadSession(s);
      const reason = excludedBy(project, cwd);
      if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
      else agents.push(...list.filter(inWindow));
    }
  }
  const mains = agents.filter((a) => a.kind === 'main');
  const subs = agents.filter((a) => a.kind === 'sub');
  const pop = { all: agents, mains, subs };
  return {
    window: { since, until: until ?? null },
    projects,
    excludedSessions: excluded,
    metrics: METRICS.map(({ id, label, measure }) => ({ id, label, ...measure(pop) })),
  };
}

const formatBreakdown = (b) => Object.entries(b ?? {})
  .toSorted(([, x], [, y]) => (typeof y === 'number' ? y : 0) - (typeof x === 'number' ? x : 0))
  .map(([k, v]) => typeof v === 'object' ? `${k} {${formatBreakdown(v)}}` : `${k} ${v}`).join(', ');

export function table(report) {
  const rows = report.metrics.map((m) => [m.id, String(m.value), m.per ? `${m.per[0] ? round(m.value / m.per[0]) : 0}/${m.per[1]} (of ${m.per[0]})` : '', formatBreakdown(m.breakdown)]);
  const head = ['metric', 'value', 'rate', 'breakdown'];
  const width = (i) => Math.max(head[i].length, ...rows.map((r) => r[i].length));
  const line = (r) => r.map((cell, i) => i === 3 ? cell : cell.padEnd(width(i))).join(' | ');
  const excluded = Object.entries(report.excludedSessions).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  return [`window ${report.window.since}..${report.window.until ?? 'now'}, ${report.projects.length} project dirs, excluded sessions: ${excluded}`, '', line(head), line(head.map((_, i) => '-'.repeat(i === 3 ? 9 : width(i)))), ...rows.map(line)].join('\n');
}

const expand = (arg) => existsSync(arg) || !/[*?[]/.test(arg) ? [arg] : globSync(arg);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { projects: { type: 'string', multiple: true }, since: { type: 'string' }, until: { type: 'string' }, json: { type: 'string' }, skip: { type: 'string', multiple: true } },
  });
  const projects = [...(values.projects ?? []), ...positionals].flatMap(expand).filter((p) => existsSync(p) && statSync(p).isDirectory());
  if (!projects.length || !/^\d{4}-\d{2}-\d{2}$/.test(values.since ?? '')) {
    console.error('usage: node tests/audit/audit.mjs --projects <dir or glob>... --since YYYY-MM-DD [--until YYYY-MM-DD] [--skip <session-id>]... [--json <out>]');
    process.exit(2);
  }
  const report = audit({ projects, since: values.since, until: values.until, skip: (values.skip ?? []).flatMap((s) => s.split(',')) });
  console.log(table(report));
  if (values.json) writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
}
