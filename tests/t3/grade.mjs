import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ABSENT, SCENARIOS } from './scenarios.mjs';
import { isClaude } from './sessions.mjs';

export class LaneError extends Error {}

export function parseLane(text, file) {
  const bad = (reason) => new LaneError(`${file}: ${reason}`);
  let lane;
  try { lane = JSON.parse(text); } catch (e) { throw bad(`not valid JSON (${e.message})`); }
  if (!lane || typeof lane !== 'object') throw bad('not a lane object');
  if (!Object.hasOwn(SCENARIOS, lane.scenario)) throw bad(`unknown scenario ${JSON.stringify(lane.scenario)} (known: ${Object.keys(SCENARIOS).join(', ')})`);
  if (!isClaude(lane.thread?.providerInstanceId)) throw bad(`thread.providerInstanceId ${JSON.stringify(lane.thread?.providerInstanceId)} is not a Claude lead, and only Claude leads are graded`);
  if (!Object.hasOwn(lane, 'toolCalls')) throw bad('no toolCalls key');
  const { toolCalls } = lane;
  if (toolCalls !== null && !(Array.isArray(toolCalls) && toolCalls.every((c) => typeof c?.name === 'string'))) {
    throw bad('toolCalls is neither null nor a list of calls with a name');
  }
  return { scenario: lane.scenario, status: lane.status, pendingQuestion: lane.pendingQuestion ?? null, toolCalls, branches: lane.branches ?? null };
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
  return `call ${i + 1} ${call.name} by ${who}${input === undefined ? '' : ` ${show(project(call.input, input))}`}`;
}

function evaluate(expect, toolCalls) {
  if (expect.anyOf) {
    const results = expect.anyOf.map((e) => evaluate(e, toolCalls));
    return results.find((r) => r.ok) ?? { ok: false, why: results.map((r) => r.why).join('; or ') };
  }
  const { want, name, input, by, key, min = 1 } = expect;
  const calls = toolCalls.map((call, i) => ({ call, i })).filter(({ call }) => matches(name, call.name));
  const hits = calls.filter(({ call }) => BY[by](call) && (input === undefined || matches(input, call.input)));
  const wanted = `${by === 'any' ? '' : `${by} `}call ${String(name)}${input === undefined ? '' : ` with ${show(input)}`}`;
  if (want === 'atMostOne') {
    const first = new Map();
    for (const h of hits) if (!first.has(key(h.call.input))) first.set(key(h.call.input), h);
    const seen = [...first].map(([k, h]) => `${describe(h)} on ${JSON.stringify(k)}`);
    return { ok: seen.length <= 1, why: seen.length ? seen.join(' and ') : `no ${wanted}` };
  }
  if (want === 'none') return hits.length ? { ok: false, why: describe(hits[0], input) } : { ok: true, why: `no ${wanted}` };
  if (hits.length >= min) return { ok: true, why: (min > 1 ? hits : hits.slice(0, 1)).map((h) => describe(h, input)).join('; ') };
  if (hits.length) return { ok: false, why: `${hits.length} of ${min} needed ${wanted}; matched ${hits.map((h) => describe(h, input)).join('; ')}` };
  const near = calls.find(({ call }) => BY[by](call)) ?? calls[0];
  return { ok: false, why: `${min > 1 ? `0 of ${min} needed` : 'no'} ${wanted}${near ? `; saw ${describe(near, input)}` : ''}` };
}

const askedUser = (pending) => Array.isArray(pending) && pending.length > 0 && pending.every((q) => q?.name === 'AskUserQuestion');

export function gradeLane(lane) {
  const { scenario, status, pendingQuestion, toolCalls } = lane;
  const { checks, mayAsk } = SCENARIOS[scenario];
  const graded = status === 'completed' || (mayAsk && status === 'waiting' && askedUser(pendingQuestion));
  const notGraded = `lane status is ${status}, not completed${mayAsk ? " or waiting only on the lead's own question" : ''}`;
  return Object.entries(checks).map(([check, expect]) => {
    if (!graded) return { check, verdict: 'FAIL', why: notGraded };
    if (!expect.state && !toolCalls) return { check, verdict: 'FAIL', why: 'no toolCalls, so the lead session was not read' };
    const { ok, why } = expect.state ? expect.state(lane) : evaluate(expect, toolCalls);
    return { check, verdict: ok ? 'PASS' : 'FAIL', why };
  });
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
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
    console.log(`${file}  ${lane.scenario}`);
    for (const { check, verdict, why } of gradeLane(lane)) {
      console.log(`  ${verdict.padEnd(4)}  ${check}  ${why}`);
      if (verdict === 'FAIL' && exit === 0) exit = 1;
    }
  }
  process.exit(exit);
}
