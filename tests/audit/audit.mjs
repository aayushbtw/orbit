#!/usr/bin/env node
import { existsSync, globSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ORBIT_REPO = 'aayushbtw/orbit';
const GUARD = /^This (?:agent|session) is isolated in the worktree /;
const EXCLUDE = [['orbit-lane', /orbit-lane/], ['orbit-ship', /orbit-ship/], ['skyforge', /skyforge/], ['greet-', /[/-](?:T|tmp)[/-]greet-/]];
// T3's delegate_task prepends this to a child thread's first prompt, for every role but `general`.
const T3_CHILD = /^Act as the ([\w-]+) sub-agent for this task\./;
const ORBIT_AGENT_FILE = /\/orbit\/(?:\S*\/)?agents\/([\w-]+)\.md\b/;
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
const resultText = (call) => call.result?.text.replace(/<\/?tool_use_error>/g, '').trimStart() ?? '';
const isGuardRefusal = (call) => GUARD.test(resultText(call));
const refusalKind = (call) => {
  const clause = resultText(call).split(', but ').slice(1).join(', but ');
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
  const hit = EXCLUDE.find(([, re]) => re.test(name) || re.test(cwd ?? ''));
  if (hit) return hit[0];
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

const t3ChildOf = (prompt) => {
  const role = prompt?.match(T3_CHILD)?.[1];
  return role && { kind: 'child', type: prompt.match(ORBIT_AGENT_FILE)?.[1] ?? `t3:${role}` };
};

function loadSession({ id, main, subs }) {
  const mainRec = main ? { session: id, file: main, ...readTranscript(main, { sub: false }) } : null;
  if (mainRec) Object.assign(mainRec, t3ChildOf(mainRec.prompts[0]) || { kind: 'main', type: 'main' });
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
const SPAWN_API_ERROR = /^(?:Agent terminated early due to an API error|API Error:|Prompt is too long)/;
const SPAWN_INTERRUPTED = /^(?:\[Tool call interrupted|\[Request interrupted|Request was aborted)/;
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
const WORKTREE_REMOVE = /(?:^|[;&|(\n]|\$\()\s*(?:\w+=\S*\s+)*git\s+(?:-[Cc]\s+\S+\s+)*worktree\s+remove\b/;
const runsWorktreeRemove = (command = '') => WORKTREE_REMOVE.test(command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''"));
const REMOVE_REFUSALS = [
  ['guard', isGuardRefusal],
  ['safety check', (c) => /removal safety check denied/.test(c.result?.text ?? '')],
  ['git refused', (c) => /^fatal: .*(?:contains modified or untracked files|cannot remove a locked working tree|is not a working tree|is a main working tree)/m.test(c.result?.text ?? '')],
];
const removeOutcome = (c) => REMOVE_REFUSALS.find(([, refused]) => refused(c))?.[0] ?? 'ok';
const ORBIT_ISSUE = new RegExp(`\\bgh\\s+issue\\s+create\\b.*(?:--repo|-R)[\\s=]+${ORBIT_REPO.replace('/', '\\/')}\\b`, 's');
const failureOf = (sub) => {
  const spawnText = !sub.spawn || isBackground(sub.spawn) ? '' : resultText(sub.spawn);
  if (sub.apiError || SPAWN_API_ERROR.test(spawnText)) return 'api error';
  if (SPAWN_INTERRUPTED.test(spawnText)) return 'interrupted';
  return sub.finalText ? null : 'empty';
};
const correctionsIn = (main) => main.prompts
  .filter((p) => p && !NOT_A_PROMPT.test(p))
  .map((p) => CORRECTIONS.filter(([, re]) => re.test(p.slice(0, 600))).map(([kind]) => kind))
  .filter((kinds) => kinds.length);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const waitSpan = (c) => [c.start, c.start + Math.min(c.end - c.start, 3 * HOUR)];
const unionMs = (calls) => {
  let total = 0, reach = -Infinity;
  for (const [from, to] of calls.map(waitSpan).toSorted(([x], [y]) => x - y)) {
    total += Math.max(0, to - Math.max(from, reach));
    reach = Math.max(reach, to);
  }
  return total;
};
const T3 = 'mcp__t3-code__';
const T3_WASTE_TOOLS = ['link_pull_request', 'link_pull_requests', 'watch_pull_request', 'unwatch_pull_request', 't3_background_wait'];
const T3_FAILED = /invalid|Missing key|Failure/;
const prKey = (pr) => pr.url ?? `${pr.repository}#${pr.number}`;
const jsonResult = (call) => {
  try { return JSON.parse(resultText(call)) ?? {}; } catch { return {}; }
};
const alreadyLinkedPerT3 = (r) => typeof r.alreadyLinked === 'boolean' ? Number(r.alreadyLinked)
  : Array.isArray(r.alreadyLinked) ? r.alreadyLinked.flatMap((g) => g.numbers ?? []).length : null;
const wasWatchingPerT3 = (r) => typeof r.wasWatching === 'boolean' ? r.wasWatching : null;
const t3WasteOf = (calls) => {
  const linked = new Set();
  const watched = new Map();
  return calls.flatMap((c) => {
    const tool = c.name.slice(T3.length);
    const r = jsonResult(c);
    if (tool === 'link_pull_request' || tool === 'link_pull_requests') {
      const keys = tool === 'link_pull_request' ? [prKey(c.input)] : (c.input.urls ?? []);
      const hits = alreadyLinkedPerT3(r) ?? keys.filter((k) => linked.has(k)).length;
      keys.forEach((k) => linked.add(k));
      return Array(hits).fill('relink');
    }
    const key = prKey(c.input);
    if (tool === 'watch_pull_request') {
      watched.set(key, true);
      return [];
    }
    if (tool === 'unwatch_pull_request') {
      const wasWatching = wasWatchingPerT3(r) ?? watched.get(key) === true;
      const kind = wasWatching ? null : watched.has(key) ? 'unwatch already unwatched' : 'unwatch never watched';
      watched.set(key, false);
      return kind ? [kind] : [];
    }
    if (c.input.waiting === false) return [];
    if (c.result?.isError || T3_FAILED.test(resultText(c))) return ['background-wait error'];
    return resultText(c).includes('"matched":[]') ? ['background-wait no match'] : [];
  });
};

export const METRICS = [
  {
    id: 'main-sessions', label: 'main sessions',
    measure: ({ mains }) => ({ value: mains.length }),
  },
  {
    id: 't3-children', label: 'T3 delegate_task child threads, by agent file or role',
    measure: ({ children, mains }) => ({ value: children.length, per: [mains.length, 'main session'], breakdown: tally(children.map((a) => a.type)) }),
  },
  {
    id: 'subagents', label: 'subagents (by the spawning call) and T3 child threads, by type',
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
      const outcomes = all.flatMap((a) => a.calls.filter((c) => c.name === 'Bash' && runsWorktreeRemove(c.input.command)).map(removeOutcome));
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
    id: 'foreground-agent-wait-h', label: 'hours a main thread waits on at least one foreground Agent call (each call capped 3 h)',
    measure: ({ mains }) => {
      const perMain = mains.map((m) => m.calls.filter((c) => isSpawn(c) && !isBackground(c) && c.end != null));
      const hours = (pred) => round(perMain.reduce((s, cs) => s + unionMs(cs.filter(pred)), 0) / HOUR, 1);
      const types = [...new Set(perMain.flat().map((c) => typeOf(c.input)))];
      const summed = round(perMain.flat().map(waitSpan).reduce((s, [from, to]) => s + to - from, 0) / HOUR, 1);
      return {
        value: hours(() => true),
        per: [mains.length, 'main session'],
        breakdown: { ...Object.fromEntries(types.map((t) => [t, hours((c) => typeOf(c.input) === t)])), 'summed over calls': summed },
      };
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
  {
    id: 't3-wasted-calls', label: 'T3 calls that did nothing: re-links, unwatch of an unwatched PR, background waits that match no task',
    measure: ({ all }) => {
      const isT3Waste = (c) => c.name.startsWith(T3) && T3_WASTE_TOOLS.includes(c.name.slice(T3.length));
      const bySession = Map.groupBy(all.flatMap((a) => a.calls.filter(isT3Waste).map((c) => [a.session, c])), ([s]) => s);
      const sessions = [...bySession.values()].map((pairs) => pairs.map(([, c]) => c).toSorted((x, y) => x.start - y.start));
      const waste = sessions.flatMap(t3WasteOf);
      const calls = sessions.flat();
      return { value: waste.length, per: [calls.length, 'call'], breakdown: { ...tally(waste), 'calls by tool': tally(calls.map((c) => c.name.slice(T3.length))) } };
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
  const children = agents.filter((a) => a.kind === 'child');
  const subs = agents.filter((a) => a.kind !== 'main');
  const pop = { all: agents, mains, children, subs };
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
