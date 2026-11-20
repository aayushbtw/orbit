export const ABSENT = Symbol('absent');

export const t3 = (tool) => new RegExp(`^(mcp__)?t3-code(-direct)?__${tool}$`);
const some = (name, input, by = 'any', min = 1) => ({ want: 'some', name, input, by, min });
const none = (name, input, by = 'any') => ({ want: 'none', name, input, by });
const atMostOne = (name, input, by, key) => ({ want: 'atMostOne', name, input, by, key });
const otherFamily = /^(?!claude)/i;
const ownFamily = (id) => id === undefined || /^claude/i.test(id);
const agentOrDelegate = /^(Agent|(mcp__)?t3-code(-direct)?__delegate_task)$/;
const native = (role, model = () => true) => (input) => input?.role === role
  && ownFamily(input.target?.providerInstanceId) && model(input.target?.model);
const notOpus = (m) => !/opus/i.test(m ?? '');
const isOpus = (m) => /opus/i.test(m ?? '');

const noChildThread = none(t3('delegate_task'));
const otherSeat = { target: { providerInstanceId: otherFamily } };
const noSeat = none(t3('delegate_task'), otherSeat);
const seatOn = (target) => ({ role: 'review', mode: 'async', runtimeMode: ABSENT, target });
const seat = seatOn({ providerInstanceId: otherFamily });
const verifiedOutside = (m) => typeof m === 'string' && !['auto', 'default'].includes(m)
  && !m.toLowerCase().split(/[-/.:]/).some((token) => ['claude', 'anthropic'].includes(token));
const listedSeat = (providerInstanceId) => seatOn({ providerInstanceId, model: verifiedOutside });
const unlistedSeat = { target: { providerInstanceId: (id) => !['codex', 'grok'].includes(id) && !/^claude/i.test(id ?? '') } };
const reviewSeat = { role: 'review', ...otherSeat };
const seatProvider = (input) => input?.target?.providerInstanceId;
const capsRead = some(t3('orchestrator_capabilities'), undefined, 'lead');
const verifierSeat = { isolation: 'worktree', ...otherSeat };
const codeAdversary = { subagent_type: 'general-purpose', model: (m) => m !== 'opus' };
const judgmentAdversary = { subagent_type: 'general-purpose', model: 'opus' };
const isCodeAdversary = (input) => input?.subagent_type === 'general-purpose' && input.model !== 'opus';
const noNativeCodeAdversary = none(agentOrDelegate, (input) => isCodeAdversary(input) || native('review', notOpus)(input), 'lead');
const countsCommits = /rev-list|\bgit\b[^|]*\blog\b[^|]*\|\s*wc\s+-l/;
const onceRead = /\/watch-pr\s[^|;&]*--once\b/;
const prefix = /^(\w+=\S*|env|exec|nohup|time|command)$/;
const watcherArgs = (segment) => {
  const words = segment.trim().split(/\s+/).map((word) => word.replace(/^["'(]+|["')]+$/g, ''));
  let at = 0;
  while (prefix.test(words[at] ?? '')) at += 1;
  if (/^(ba|z)?sh$/.test(words[at]) && /^-\w*c$/.test(words[at + 1] ?? '')) at += 2;
  return /(^|\/)watch-pr$/.test(words[at] ?? '') ? words.slice(at + 1) : null;
};
const sleepingWatcher = (command) => typeof command === 'string' && command.split(/&&|\|\||[;|&\n]/).some((segment) => {
  const args = watcherArgs(segment);
  return args !== null && !args.some((arg) => /^(--once|--status-only|--help|-h)$/.test(arg));
});
const shortInterval = { schedule: { type: 'interval', everyMs: (ms) => !(ms >= 60_000) } };
const ownCheckout = { isolation: 'worktree', mode: 'async', clientRequestId: /./ };
const ownCheckoutChildren = some(t3('delegate_task'), ownCheckout, 'lead', 2);
const noWorktreeAgent = none('Agent', { isolation: 'worktree' });
const noShellWorktree = none('Bash', { command: /\bgit\b.*\bworktree\s+add\b/ });
const boundToThread = some(t3('schedule_task'), { bindToCurrentThread: true }, 'lead');
const leadWatches = some(t3('watch_pull_request'), { url: /\/pull\/\d+$/ }, 'lead');
const noChildWatches = none(t3('watch_pull_request'), undefined, 'child');
const workflow = `## Workflow

- Check: \`node --test\`.
- Land: \`main\`.
`;
const interrogateMedian = '/orbit:interrogate Scope: the commit that adds median.mjs, against its parent. Intent: median(values) returns the median of an array of numbers. Make no edits.';
const verifierMedian = '/orbit:ship the commit that adds median.mjs, verifier step only. Do not land.';

const seatsProject = (name, otherFamilyCell) => ({
  name,
  commits: [
    {
      message: 'chore: add the workflow block',
      files: {
        'AGENTS.md': `## Workflow

- Check: \`node --test\`.
- Land: \`main\`.
${otherFamilyCell === null ? '' : `
### Models

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| other-family | panel seat on another family | ${otherFamilyCell} | |
| verifier | runs the change before it lands | other-family | |
`}`,
      },
    },
    {
      message: 'feat: add median',
      files: {
        'median.mjs': `export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
`,
        'median.test.mjs': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median } from './median.mjs';

test('median of odd and even lengths', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
`,
      },
    },
  ],
});

const seatProject = seatsProject('seats', 'codex, claudeAgent');

const unitsProject = {
  name: 'units',
  commits: [
    { message: 'chore: add the workflow block', files: { 'AGENTS.md': workflow } },
    {
      message: 'feat: add sum',
      files: {
        'sum.mjs': `export function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}
`,
        'sum.test.mjs': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sum } from './sum.mjs';

test('sum adds every value', () => {
  assert.equal(sum([1, 2, 3]), 6);
  assert.equal(sum([]), 0);
});
`,
      },
    },
  ],
};

const pinsBase = /\bgit\s+(-C\s+\S+\s+)?(reset\s+--hard|checkout|switch|merge\s+--ff-only)\b[^\n]*?\b[0-9a-f]{7,40}\b/;
const unpinnedChild = { isolation: 'worktree', task: (task) => !pinsBase.test(task ?? '') || !/--show-toplevel\b/.test(task ?? '') };
const pickConflict = { command: /(^|;|&&|\n)\s*(\w+=\S*\s+)*git(\s+-[cC]\s+\S+)*\s+cherry-pick\b[^\n;&|]*--(abort|continue|skip|quit)\b/ };
const short = (sha) => sha?.slice(0, 7) ?? 'none';
const childrenOnPrerequisite = (path) => ({
  state: ({ branches }) => {
    if (!Array.isArray(branches)) return { ok: false, why: 'no branches recorded, so the lane did not watch git' };
    const children = branches.filter((b) => b.child);
    const leadAdds = new Set(branches.filter((b) => !b.child && b.adds).map((b) => b.adds));
    const seen = children.map((b) => `${b.ref} born ${short(b.born)} tip ${short(b.tip)} ${b.adds ? `first adds ${path} in ${short(b.adds)}` : `has no ${path}`}`).join('; ');
    if (!leadAdds.size) return { ok: false, why: `no lead branch adds ${path}${seen ? `; children: ${seen}` : ''}` };
    const leads = `lead adds ${path} in ${[...leadAdds].map(short).join(', ')}`;
    if (children.length < 2) return { ok: false, why: `${children.length} of 2 needed child branches recorded; ${leads}${seen ? `; ${seen}` : ''}` };
    return { ok: children.every((b) => leadAdds.has(b.adds)), why: `${leads}; ${seen}` };
  },
});

const roundPath = 'lib/round.mjs';

const docsQueueProject = {
  name: 'docs-queue',
  commits: [
    {
      message: 'chore: add the workflow block and docs',
      files: {
        'AGENTS.md': workflow,
        'README.md': '# Docs queue\n\nRead teh notes before you start.\n',
        'NOTES.md': '# Notes\n\nEach item should recieve one commit.\n',
      },
    },
  ],
};

export const SCENARIOS = {
  probe: {
    prompt: 'Probe. Make no edits and load no skills. Run pwd, then list every skill whose name starts with orbit: with its description quoted verbatim.',
    checks: {
      'ran-pwd': some('Bash', { command: /\bpwd\b/ }),
      'loaded-no-skill': none('Skill'),
    },
  },
  'gitops-native': {
    prompt: "/orbit:start investigate: which pull requests are linked to this T3 thread? Have orbit's gitops agent check it with T3's list_thread_pull_requests tool, then answer. Make no edits.",
    checks: {
      'gitops-native-child': some('Agent', { subagent_type: 'orbit:gitops' }, 'lead'),
      'no-child-thread': noChildThread,
    },
  },
  foreground: {
    prompt: "/orbit:start just testing: create the file scratch/lane-fg.txt containing the single line 'lane fg'. Run the Delegate gate for the edit. No commit, no PR.",
    checks: {
      'delegate-ran': some('Agent', { subagent_type: 'orbit:poteto-agent' }, 'lead'),
      'every-agent-foreground': none('Agent', { run_in_background: (v) => v !== false }, 'lead'),
    },
  },
  'verifier-seat': {
    prompt: verifierMedian,
    project: seatProject,
    checks: {
      'verifier-ran': { anyOf: [some(t3('delegate_task'), verifierSeat, 'lead'), some('Agent', { subagent_type: 'orbit:verifier' }, 'lead')] },
      'seat-other-family': some(t3('delegate_task'), verifierSeat, 'lead'),
    },
  },
  'review-seat': {
    prompt: interrogateMedian,
    project: seatProject,
    checks: {
      'seat-other-family': some(t3('delegate_task'), seat, 'lead'),
      'request-id': some(t3('delegate_task'), { ...seat, clientRequestId: /./ }, 'lead'),
    },
  },
  'seat-listed': {
    prompt: interrogateMedian,
    project: seatsProject('seats-listed', 'codex, grok'),
    checks: {
      'seat-on-first-listed': some(t3('delegate_task'), listedSeat('codex'), 'lead'),
      'only-listed-seats': none(t3('delegate_task'), unlistedSeat, 'lead'),
      'one-seat': atMostOne(t3('delegate_task'), reviewSeat, 'lead', seatProvider),
      'no-native-code-adversary': noNativeCodeAdversary,
    },
  },
  'seat-empty': {
    prompt: interrogateMedian,
    project: seatsProject('seats-empty', null),
    checks: {
      'no-seat': noSeat,
      'session-family-seat': { anyOf: [some('Agent', codeAdversary, 'lead'), some(t3('delegate_task'), native('review', notOpus), 'lead')] },
    },
  },
  'seat-all-fail': {
    prompt: interrogateMedian,
    project: seatsProject('seats-all-fail', 'cursor, muse'),
    checks: {
      'caps-read': capsRead,
      'no-seat': noSeat,
      'no-native-replacement': noNativeCodeAdversary,
      'judgment-adversary-ran': { anyOf: [some('Agent', judgmentAdversary, 'lead'), some(t3('delegate_task'), native('review', isOpus), 'lead')] },
    },
  },
  'verifier-all-fail': {
    prompt: verifierMedian,
    project: seatsProject('seats-verifier-all-fail', 'cursor, muse, inherit'),
    mayAsk: true,
    checks: {
      'caps-read': capsRead,
      'no-seat': noSeat,
      'no-native-verifier': none(agentOrDelegate, (input) => input?.subagent_type === 'orbit:verifier' || native('test')(input), 'lead'),
    },
  },
  'watch-pr-wait': {
    prompt: 'Hillclimb wake step test. Load the orbit hillclimb flow with /orbit:playbook hillclimb only to read it, and do not start a hillclimb. Assume an unattended hillclimb run whose next iteration waits on CI for the newest open PR in aayushbtw/orbit-t3-lane-ci. Apply only the step 5 wake mechanism to that PR event: arm the wake, say which tools you used, then end your turn. Make no file changes and push nothing.',
    checks: {
      'lead-watches': leadWatches,
      'no-child-watches': noChildWatches,
    },
  },
  'babysit-wait': {
    prompt: '/orbit:start babysit <PR URL> in drive mode. Make no file changes and push nothing.',
    checks: {
      'once-read': some('Bash', { command: onceRead }, 'lead'),
      'no-sleeping-watcher': none('Bash', { command: sleepingWatcher }),
      'lead-watches': leadWatches,
      'unwatch-at-ready': some(t3('unwatch_pull_request'), undefined, 'lead'),
      'no-child-watches': noChildWatches,
    },
  },
  'schedule-loop': {
    prompt: '/orbit:start every 2 minutes, report `git status --short` in this thread, and stop after the first report. Make no file changes and push nothing.',
    checks: {
      'bound-to-thread': boundToThread,
      'interval-min-60s': none(t3('schedule_task'), shortInterval),
    },
  },
  'schedule-only': {
    prompt: '/orbit:start schedule a one-time report of `git rev-list --count HEAD` in this thread for tomorrow at 09:00. Make no file changes and push nothing.',
    checks: {
      scheduled: boundToThread,
      'prompt-not-run': none('Bash', { command: countsCommits }, 'lead'),
      'no-run-now': none(t3('run_scheduled_task_now'), undefined, 'lead'),
    },
  },
  'parallel-units': {
    prompt: "/orbit:start feature, just testing, don't ship: add two independent modules to this repo, each in its own file with a node:test test: `min.mjs` exporting min(values) and `max.mjs` exporting max(values). They share no file, so run them as two parallel delegates per the Delegate gate. Commit each unit on the task branch. No PR.",
    project: unitsProject,
    checks: {
      'own-checkout-children': ownCheckoutChildren,
      'no-worktree-agent': noWorktreeAgent,
      'no-shell-worktree': noShellWorktree,
      'cherry-picked': some('Bash', { command: /\bgit\b.*\bcherry-pick\b/ }, 'any', 2),
      'children-settled': some(t3('t3_thread_organize'), { action: 'settle' }, 'lead', 2),
    },
  },
  'child-base': {
    prompt: "/orbit:start feature, just testing, don't ship: first add `lib/round.mjs` exporting round2(x), which rounds x to 2 decimals, with a node:test test, and commit it on the task branch. Then, as two parallel units per the Delegate gate, add `mean.mjs` exporting mean(values) and `median.mjs` exporting median(values), each returning round2 of its result and each with a node:test test. They share no file. Commit each unit on the task branch. No PR.",
    project: { name: 'child-base', commits: unitsProject.commits },
    prerequisite: roundPath,
    checks: {
      'own-checkout-children': ownCheckoutChildren,
      'brief-pins-base': none(t3('delegate_task'), unpinnedChild, 'lead'),
      'no-pick-conflict': none('Bash', pickConflict),
      'children-on-prerequisite': childrenOnPrerequisite(roundPath),
    },
  },
  'autopilot-owners': {
    prompt: "/orbit:start autopilot-stack, Land main, two queue items, each a one-line doc fix: (1) in README.md change 'teh' to 'the'; (2) in NOTES.md change 'recieve' to 'receive'. Arm the audit tick every 1 minute bound to this thread. Stop each item at code-ready and skip the step 4 swarm; this is a lane test.",
    project: docsQueueProject,
    checks: {
      'owners-are-children': ownCheckoutChildren,
      'no-worktree-agent': noWorktreeAgent,
      'no-shell-worktree': noShellWorktree,
      'tick-bound': boundToThread,
    },
  },
};
