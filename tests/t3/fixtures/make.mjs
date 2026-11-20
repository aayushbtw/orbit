import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { gradeLane } from '../grade.mjs';
import { SCENARIOS } from '../scenarios.mjs';
import { claude, isClaude, readJsonl } from '../sessions.mjs';

const { values: opts } = parseArgs({
  options: {
    provider: { type: 'string' },
    session: { type: 'string' },
    scenario: { type: 'string' },
    out: { type: 'string' },
    source: { type: 'string' },
    note: { type: 'string' },
    lane: { type: 'string' },
  },
});
if (!isClaude(opts.provider) || !opts.session || !Object.hasOwn(SCENARIOS, opts.scenario ?? '') || !opts.out) {
  console.error(`usage: node tests/t3/fixtures/make.mjs --provider <Claude providerInstanceId> --session <file> --scenario <${Object.keys(SCENARIOS).join('|')}> --out <file> [--source <name>] [--note <text>] [--lane <lane.json>]`);
  process.exit(1);
}

const entries = readJsonl(opts.session);
const first = entries.find((e) => e.type === 'user')?.message?.content;
const [, command, args] = first.match(/^<command-message>[^<]*<\/command-message>\n<command-name>(\/\S+)<\/command-name>\n<command-args>([\s\S]*)<\/command-args>$/) ?? [];
const message = command ? [command, args].filter(Boolean).join(' ') : first;
const model = entries.find((e) => e.type === 'assistant' && e.message?.model)?.message.model;

const KEEP = new Set(['subagent_type', 'command']);
const collectKeys = (shape) => {
  if (!shape || typeof shape !== 'object' || shape instanceof RegExp) return;
  for (const [key, value] of Object.entries(shape)) {
    KEEP.add(key);
    collectKeys(value);
  }
};
const collectExpect = (expect) => expect.anyOf ? expect.anyOf.forEach(collectExpect) : collectKeys(expect.input);
for (const { checks } of Object.values(SCENARIOS)) Object.values(checks).forEach(collectExpect);

// Claude session folders spell a path with dashes; a one-segment path like /tmp would match too much that way.
const spellings = (path) => path.split('/').length > 2 ? [path, path.replace(/[^a-zA-Z0-9]/g, '-')] : [path];
const SCRUB = [
  ...[realpathSync(tmpdir()), tmpdir()].flatMap(spellings).map((from) => [from, '$TMPDIR']),
  ...spellings(homedir()).map((from) => [from, '~']),
];
const unhome = (text) => SCRUB.reduce((s, [from, to]) => s.split(from).join(to), text.replace(/\/private\/tmp\/[^/\s]+\/[^/\s]+/g, '$TMPDIR'));
const cut = (text) => {
  const s = unhome(text);
  return s.length > 200 ? `${s.slice(0, 60)}…[${s.length} chars]` : s;
};
const slim = (value) => typeof value === 'string' ? cut(value)
  : Array.isArray(value) ? value.map(slim)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => KEEP.has(key)).map(([key, v]) => [key, slim(v)]))
  : value;

const { toolCalls } = claude.read(opts.session);
const laneJson = opts.lane ? JSON.parse(readFileSync(opts.lane, 'utf8')) : {};
const pendingQuestion = laneJson.pendingQuestion?.map(({ name }) => ({ name })) ?? null;
const branches = laneJson.branches?.map((b) => ({ ...b, worktree: b.worktree && unhome(b.worktree) })) ?? null;
const lane = { scenario: opts.scenario, status: laneJson.status ?? 'completed', pendingQuestion, branches };
const raw = gradeLane({ ...lane, toolCalls });
const slimCalls = toolCalls.map(({ name, input, sidechain }) => ({ name, input: slim(input), sidechain }));
const graded = gradeLane({ ...lane, toolCalls: slimCalls });
const differ = graded.filter((r, i) => r.verdict !== raw[i].verdict);
if (differ.length) {
  console.error(`slimming changed the verdict of ${differ.map((r) => r.check).join(', ')}, so no fixture was written`);
  process.exit(1);
}

const fixture = {
  scenario: opts.scenario,
  message: unhome(message),
  status: lane.status,
  ...(pendingQuestion && { pendingQuestion }),
  thread: { providerInstanceId: opts.provider, model: model ?? null },
  fixture: {
    origin: 'real',
    source: opts.source ?? basename(opts.session),
    relabeled: unhome(message) !== SCENARIOS[opts.scenario].prompt,
    note: opts.note ?? '',
    expect: Object.fromEntries(graded.map((r) => [r.check, r.verdict])),
  },
  toolCalls: slimCalls,
  ...(branches && { branches }),
};
writeFileSync(opts.out, JSON.stringify(fixture, null, 2) + '\n');
for (const { check, verdict, why } of graded) console.log(`  ${verdict.padEnd(4)}  ${check}  ${why}`);
console.log(opts.out);
