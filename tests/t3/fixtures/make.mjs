import { readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { gradeLane } from '../grade.mjs';
import { SCENARIOS } from '../scenarios.mjs';
import { kindOf, readJsonl, readLead } from '../sessions.mjs';

const { values: opts } = parseArgs({
  options: {
    provider: { type: 'string' },
    session: { type: 'string' },
    scenario: { type: 'string' },
    out: { type: 'string' },
    source: { type: 'string' },
    note: { type: 'string' },
  },
});
const kind = kindOf(opts.provider);
if (!kind || !opts.session || !Object.hasOwn(SCENARIOS, opts.scenario ?? '') || !opts.out) {
  console.error(`usage: node tests/t3/fixtures/make.mjs --provider <providerInstanceId> --session <file> --scenario <${Object.keys(SCENARIOS).join('|')}> --out <file> [--source <name>] [--note <text>]`);
  process.exit(1);
}

const entries = readJsonl(opts.session);
const SESSION_INFO = {
  claude: () => {
    const first = entries.find((e) => e.type === 'user')?.message?.content;
    const [, command, args] = first.match(/^<command-message>[^<]*<\/command-message>\n<command-name>(\/\S+)<\/command-name>\n<command-args>([\s\S]*)<\/command-args>$/) ?? [];
    return {
      message: command ? [command, args].filter(Boolean).join(' ') : first,
      model: entries.find((e) => e.type === 'assistant' && e.message?.model)?.message.model,
    };
  },
  codex: () => ({
    message: entries.find((e) => e.type === 'response_item' && e.payload?.role === 'user'
      && e.payload.internal_chat_message_metadata_passthrough?.content_item_metadata?.[0]?.provenance?.type === 'user')?.payload.content[0].text,
    model: entries.find((e) => e.type === 'turn_context')?.payload?.model,
  }),
  grok: () => {
    const content = entries.find((e) => e.type === 'user' && 'prompt_index' in e)?.content;
    const text = Array.isArray(content) ? content.find((c) => c.type === 'text')?.text : content;
    return {
      message: text?.match(/^<user_query>\n([\s\S]*?)\n<\/user_query>/)?.[1],
      model: JSON.parse(readFileSync(join(dirname(opts.session), 'summary.json'), 'utf8')).current_model_id,
    };
  },
};

const KEEP = new Set(['subagent_type', 'tool_name', 'command', 'join']);
const collectKeys = (shape) => {
  if (!shape || typeof shape !== 'object' || shape instanceof RegExp) return;
  for (const [key, value] of Object.entries(shape)) {
    KEEP.add(key);
    collectKeys(value);
  }
};
const collectExpect = (expect) => expect.anyOf ? expect.anyOf.forEach(collectExpect) : collectKeys(expect.input);
for (const { checks } of Object.values(SCENARIOS)) {
  for (const { na: _, ...cells } of Object.values(checks)) Object.values(cells).forEach(collectExpect);
}

const unhome = (text) => text.split(tmpdir()).join('$TMPDIR').replace(/\/private\/tmp\/[^/\s]+\/[^/\s]+/g, '$TMPDIR')
  .split(homedir()).join('~').split(homedir().replace(/[^a-zA-Z0-9]/g, '-')).join('~');
const cut = (text) => {
  const s = unhome(text);
  return s.length > 200 ? `${s.slice(0, 60)}…[${s.length} chars]` : s;
};
const slim = (value) => typeof value === 'string' ? cut(value)
  : Array.isArray(value) ? value.map(slim)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => KEEP.has(key)).map(([key, v]) => [key, slim(v)]))
  : value;

const { message, model } = SESSION_INFO[kind]();
const { toolCalls } = readLead(kind, opts.session);
const lane = { scenario: opts.scenario, provider: kind, status: 'completed' };
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
  status: 'completed',
  thread: { providerInstanceId: opts.provider, model: model ?? null },
  fixture: {
    origin: 'real',
    source: opts.source ?? basename(opts.session),
    relabeled: unhome(message) !== SCENARIOS[opts.scenario].prompt,
    note: opts.note ?? '',
    expect: Object.fromEntries(graded.map((r) => [r.check, r.verdict])),
  },
  toolCalls: slimCalls,
};
writeFileSync(opts.out, JSON.stringify(fixture, null, 2) + '\n');
for (const { check, verdict, why } of graded) console.log(`  ${verdict.padEnd(4)}  ${check}  ${why}`);
console.log(opts.out);
