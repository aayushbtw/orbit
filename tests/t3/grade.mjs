import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ABSENT, SCENARIOS } from './scenarios.mjs';
import { kindOf } from './sessions.mjs';

export class LaneError extends Error {}

export function parseLane(text, file) {
  const bad = (reason) => new LaneError(`${file}: ${reason}`);
  let lane;
  try { lane = JSON.parse(text); } catch (e) { throw bad(`not valid JSON (${e.message})`); }
  if (!lane || typeof lane !== 'object') throw bad('not a lane object');
  if (!Object.hasOwn(SCENARIOS, lane.scenario)) throw bad(`unknown scenario ${JSON.stringify(lane.scenario)} (known: ${Object.keys(SCENARIOS).join(', ')})`);
  const provider = kindOf(lane.thread?.providerInstanceId);
  if (!provider) throw bad(`unknown provider ${JSON.stringify(lane.thread?.providerInstanceId)} in thread.providerInstanceId`);
  if (!Object.hasOwn(lane, 'toolCalls')) throw bad('no toolCalls key');
  const { toolCalls } = lane;
  if (toolCalls !== null && !(Array.isArray(toolCalls) && toolCalls.every((c) => typeof c?.name === 'string'))) {
    throw bad('toolCalls is neither null nor a list of calls with a name');
  }
  return { scenario: lane.scenario, provider, status: lane.status, toolCalls };
}

function matches(shape, value) {
  if (shape === ABSENT) return value === undefined;
  if (shape instanceof RegExp) return [value].flat().some((v) => typeof v === 'string' && shape.test(v));
  if (typeof shape === 'function') return shape(value) === true;
  if (shape && typeof shape === 'object') {
    return value !== null && typeof value === 'object' && Object.entries(shape).every(([key, s]) => matches(s, value[key]));
  }
  return shape === value;
}

const show = (shape) => JSON.stringify(shape, (_, v) => v === ABSENT ? '<absent>' : v instanceof RegExp || typeof v === 'function' ? String(v) : v);
const project = (value, shape) => shape && typeof shape === 'object' && !(shape instanceof RegExp) && value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(shape).map((key) => [key, value[key] === undefined ? ABSENT : project(value[key], shape[key])]))
  : value;
const BY = { lead: (call) => !call.sidechain, child: (call) => call.sidechain === true, any: () => true };

function describe({ call, i }, input) {
  const who = call.sidechain ? 'child' : 'lead';
  if (call.input?.join === 'missing') return `call ${i + 1} ${call.name} by ${who}, whose call args were not found in the session (join: missing)`;
  return `call ${i + 1} ${call.name} by ${who}${input === undefined ? '' : ` ${show(project(call.input, input))}`}`;
}

function evaluate(expect, toolCalls) {
  if (expect.anyOf) {
    const results = expect.anyOf.map((e) => evaluate(e, toolCalls));
    return results.find((r) => r.ok) ?? { ok: false, why: results.map((r) => r.why).join('; or ') };
  }
  const { want, name, input, by } = expect;
  const calls = toolCalls.map((call, i) => ({ call, i })).filter(({ call }) => matches(name, call.name));
  const hit = calls.find(({ call }) => BY[by](call) && (input === undefined || matches(input, call.input)));
  const wanted = `${by === 'any' ? '' : `${by} `}call ${String(name)}${input === undefined ? '' : ` with ${show(input)}`}`;
  if (want === 'none') return hit ? { ok: false, why: describe(hit, input) } : { ok: true, why: `no ${wanted}` };
  if (hit) return { ok: true, why: describe(hit, input) };
  const near = calls.find(({ call }) => BY[by](call)) ?? calls[0];
  return { ok: false, why: `no ${wanted}${near ? `; saw ${describe(near, input)}` : ''}` };
}

export function gradeLane({ scenario, provider, status, toolCalls }) {
  return Object.entries(SCENARIOS[scenario].checks).map(([check, cell]) => {
    if (status !== 'completed') return { check, verdict: 'FAIL', why: `lane status is ${status}, not completed` };
    const expect = cell[provider];
    if (!expect) return { check, verdict: 'N/A', why: cell.na[provider] };
    if (!toolCalls) return { check, verdict: 'FAIL', why: 'no toolCalls, so the lead session was not read' };
    const { ok, why } = evaluate(expect, toolCalls);
    return { check, verdict: ok ? 'PASS' : 'FAIL', why };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node tests/t3/grade.mjs <lane.json>...');
    process.exit(2);
  }
  let exit = 0;
  for (const file of files) {
    let lane;
    try {
      lane = parseLane(readFileSync(file, 'utf8'), file);
    } catch (e) {
      console.error(e instanceof LaneError ? e.message : `${file}: cannot read (${e.code ?? e.message})`);
      exit = 2;
      continue;
    }
    console.log(`${file}  ${lane.scenario}  ${lane.provider}`);
    for (const { check, verdict, why } of gradeLane(lane)) {
      console.log(`  ${verdict.padEnd(4)}  ${check}  ${why}`);
      if (verdict === 'FAIL' && exit === 0) exit = 1;
    }
  }
  process.exit(exit);
}
