export const ABSENT = Symbol('absent');

export const t3 = (tool) => new RegExp(`^(mcp__)?t3-code(-direct)?__${tool}$`);
const some = (name, input, by = 'any') => ({ want: 'some', name, input, by });
const none = (name, input, by = 'any') => ({ want: 'none', name, input, by });
const viaUseTool = (tool, input) => ({ tool_name: t3(tool), ...(input && { tool_input: input }) });
const otherFamily = (kind) => new RegExp(`^(?!${kind})`, 'i');

const noChildThread = {
  claude: none(t3('delegate_task')),
  codex: none(t3('delegate_task')),
  grok: none('use_tool', viaUseTool('delegate_task')),
};
const seat = (kind) => ({ role: 'review', mode: 'async', runtimeMode: ABSENT, target: { providerInstanceId: otherFamily(kind) } });
const verifierSeat = (kind) => ({ isolation: 'worktree', target: { providerInstanceId: otherFamily(kind) } });
const countsCommits = /rev-list|\bgit\b[^|]*\blog\b[^|]*\|\s*wc\s+-l/;
const onceRead = /\/watch-pr\s[^|;&]*--once\b/;
const sleepingWatcher = /\/watch-pr\s(?![^|;&]*--(once|status-only)\b)/;
const shortInterval = { schedule: { type: 'interval', everyMs: (ms) => !(ms >= 60_000) } };

// orbit's own AGENTS.md sets other-family to inherit, so a lead there rightly keeps every seat native.
const seatProject = {
  name: 'seats',
  commits: [
    {
      message: 'chore: add the workflow block',
      files: {
        'AGENTS.md': `## Workflow

- Check: \`node --test\`.
- Land: \`main\`.

### Models

| Task | Use for | Model | Effort |
| --- | --- | --- | --- |
| other-family | panel seat on another family | codex, claudeAgent | |
| verifier | runs the change before it lands | other-family | |
`,
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
};

export const SCENARIOS = {
  probe: {
    prompt: 'Probe. Make no edits and load no skills. Run pwd, then list every skill whose name starts with orbit: with its description quoted verbatim.',
    checks: {
      'ran-pwd': {
        claude: some('Bash', { command: /\bpwd\b/ }),
        codex: some('exec_command', { command: /\bpwd\b/ }),
        grok: some('run_terminal_command', { command: /\bpwd\b/ }),
      },
      'loaded-no-skill': {
        claude: none('Skill'),
        codex: none('exec_command', { command: /SKILL\.md/ }),
        grok: none('read_file', { target_file: /SKILL\.md$/ }),
      },
    },
  },
  'rules-load': {
    prompt: '/orbit:start in two sentences, which orbit agent commits and which writes code? Make no edits.',
    checks: {
      'rules-read': {
        codex: some('exec_command', { command: /rules\.md/ }, 'lead'),
        grok: some('read_file', { target_file: /(skills\/rules\/SKILL|(^|\/)rules)\.md$/ }, 'lead'),
        na: { claude: 'a Claude lead gets rules.md from the SessionStart hook, so no tool call shows it' },
      },
    },
  },
  'gitops-native': {
    prompt: "/orbit:start investigate: which pull requests are linked to this T3 thread? Have orbit's gitops agent check it with T3's list_thread_pull_requests tool, then answer. Make no edits.",
    checks: {
      'gitops-native-child': {
        claude: some('Agent', { subagent_type: 'orbit:gitops' }, 'lead'),
        codex: some('spawn_agent', { fork_turns: 'none' }, 'lead'),
        grok: some('spawn_subagent', { subagent_type: 'orbit:gitops' }, 'lead'),
      },
      'no-child-thread': noChildThread,
    },
  },
  'code-child': {
    prompt: "/orbit:start just testing: create the file scratch/lane-l3.txt containing the single line 'lane l3'. Run the Delegate gate for the edit as orbit's adapter says for a lead on another provider. No commit, no PR.",
    checks: {
      'code-native-child': {
        claude: some('Agent', { subagent_type: 'orbit:poteto-agent' }, 'lead'),
        codex: some('spawn_agent', { fork_turns: 'none', model: 'gpt-6.1-sol' }, 'lead'),
        grok: some('spawn_subagent', { subagent_type: 'orbit:poteto-agent' }, 'lead'),
      },
      'no-child-thread': noChildThread,
    },
  },
  foreground: {
    prompt: "/orbit:start just testing: create the file scratch/lane-fg.txt containing the single line 'lane fg'. Run the Delegate gate for the edit. No commit, no PR.",
    checks: {
      'delegate-ran': {
        claude: some('Agent', { subagent_type: 'orbit:poteto-agent' }, 'lead'),
        codex: some('spawn_agent', { fork_turns: 'none' }, 'lead'),
        grok: some('spawn_subagent', { subagent_type: 'orbit:poteto-agent' }, 'lead'),
      },
      'every-agent-foreground': {
        claude: none('Agent', { run_in_background: (v) => v !== false }, 'lead'),
        grok: none('spawn_subagent', { background: true }, 'lead'),
        na: { codex: 'spawn_agent has no background field' },
      },
    },
  },
  'verifier-seat': {
    prompt: '/orbit:ship the commit that adds median.mjs, verifier step only. Do not land.',
    project: seatProject,
    checks: {
      'verifier-ran': {
        claude: { anyOf: [some(t3('delegate_task'), verifierSeat('claude'), 'lead'), some('Agent', { subagent_type: 'orbit:verifier' }, 'lead')] },
        codex: { anyOf: [some(t3('delegate_task'), verifierSeat('codex'), 'lead'), some('spawn_agent', { fork_turns: 'none' }, 'lead')] },
        grok: { anyOf: [some('use_tool', viaUseTool('delegate_task', verifierSeat('grok')), 'lead'), some('spawn_subagent', { subagent_type: 'orbit:verifier' }, 'lead')] },
      },
      'seat-other-family': {
        claude: some(t3('delegate_task'), verifierSeat('claude'), 'lead'),
        codex: some(t3('delegate_task'), verifierSeat('codex'), 'lead'),
        grok: some('use_tool', viaUseTool('delegate_task', verifierSeat('grok')), 'lead'),
      },
    },
  },
  'review-seat': {
    prompt: '/orbit:interrogate Scope: the commit that adds median.mjs, against its parent. Intent: median(values) returns the median of an array of numbers. Make no edits.',
    project: seatProject,
    checks: {
      'seat-other-family': {
        claude: some(t3('delegate_task'), seat('claude'), 'lead'),
        codex: some(t3('delegate_task'), seat('codex'), 'lead'),
        grok: some('use_tool', viaUseTool('delegate_task', seat('grok')), 'lead'),
      },
      'request-id': {
        claude: some(t3('delegate_task'), { ...seat('claude'), clientRequestId: /./ }, 'lead'),
        codex: some(t3('delegate_task'), { ...seat('codex'), clientRequestId: /./ }, 'lead'),
        grok: some('use_tool', viaUseTool('delegate_task', { ...seat('grok'), clientRequestId: /./ }), 'lead'),
      },
    },
  },
  'watch-pr-wait': {
    prompt: 'Hillclimb wake step test. Load the orbit hillclimb flow with /orbit:playbook hillclimb only to read it, and do not start a hillclimb. Assume an unattended hillclimb run whose next iteration waits on CI for the newest open PR in aayushbtw/orbit-t3-lane-ci. Apply only the step 5 wake mechanism to that PR event: arm the wake, say which tools you used, then end your turn. Make no file changes and push nothing.',
    checks: {
      'lead-watches': {
        claude: some(t3('watch_pull_request'), { url: /\/pull\/\d+$/ }, 'lead'),
        codex: some(t3('watch_pull_request'), { url: /\/pull\/\d+$/ }, 'lead'),
        grok: some('use_tool', viaUseTool('watch_pull_request', { url: /\/pull\/\d+$/ }), 'lead'),
      },
      'no-child-watches': {
        claude: none(t3('watch_pull_request'), undefined, 'child'),
        codex: none(t3('watch_pull_request'), undefined, 'child'),
        grok: none('use_tool', viaUseTool('watch_pull_request'), 'child'),
      },
    },
  },
  'babysit-wait': {
    prompt: '/orbit:start babysit <PR URL> in drive mode. Make no file changes and push nothing.',
    checks: {
      'once-read': {
        claude: some('Bash', { command: onceRead }, 'lead'),
        codex: some('exec_command', { command: onceRead }, 'lead'),
        grok: some('run_terminal_command', { command: onceRead }, 'lead'),
      },
      'no-sleeping-watcher': {
        claude: none('Bash', { command: sleepingWatcher }),
        codex: none('exec_command', { command: sleepingWatcher }),
        grok: none('run_terminal_command', { command: sleepingWatcher }),
      },
      'lead-watches': {
        claude: some(t3('watch_pull_request'), { url: /\/pull\/\d+$/ }, 'lead'),
        codex: some(t3('watch_pull_request'), { url: /\/pull\/\d+$/ }, 'lead'),
        grok: some('use_tool', viaUseTool('watch_pull_request', { url: /\/pull\/\d+$/ }), 'lead'),
      },
      'unwatch-at-ready': {
        claude: some(t3('unwatch_pull_request'), undefined, 'lead'),
        codex: some(t3('unwatch_pull_request'), undefined, 'lead'),
        grok: some('use_tool', viaUseTool('unwatch_pull_request'), 'lead'),
      },
      'no-child-watches': {
        claude: none(t3('watch_pull_request'), undefined, 'child'),
        codex: none(t3('watch_pull_request'), undefined, 'child'),
        grok: none('use_tool', viaUseTool('watch_pull_request'), 'child'),
      },
    },
  },
  'schedule-loop': {
    prompt: '/orbit:start every 2 minutes, report `git status --short` in this thread, and stop after the first report. Make no file changes and push nothing.',
    checks: {
      'bound-to-thread': {
        claude: some(t3('schedule_task'), { bindToCurrentThread: true }, 'lead'),
        codex: some(t3('schedule_task'), { bindToCurrentThread: true }, 'lead'),
        grok: some('use_tool', viaUseTool('schedule_task', { bindToCurrentThread: true }), 'lead'),
      },
      'interval-min-60s': {
        claude: none(t3('schedule_task'), shortInterval),
        codex: none(t3('schedule_task'), shortInterval),
        grok: none('use_tool', viaUseTool('schedule_task', shortInterval)),
      },
    },
  },
  'schedule-only': {
    prompt: '/orbit:start schedule a one-time report of `git rev-list --count HEAD` in this thread for tomorrow at 09:00. Make no file changes and push nothing.',
    checks: {
      scheduled: {
        claude: some(t3('schedule_task'), { bindToCurrentThread: true }, 'lead'),
        codex: some(t3('schedule_task'), { bindToCurrentThread: true }, 'lead'),
        grok: some('use_tool', viaUseTool('schedule_task', { bindToCurrentThread: true }), 'lead'),
      },
      'prompt-not-run': {
        claude: none('Bash', { command: countsCommits }, 'lead'),
        codex: none('exec_command', { command: countsCommits }, 'lead'),
        grok: none('run_terminal_command', { command: countsCommits }, 'lead'),
      },
      'no-run-now': {
        claude: none(t3('run_scheduled_task_now'), undefined, 'lead'),
        codex: none(t3('run_scheduled_task_now'), undefined, 'lead'),
        grok: none('use_tool', viaUseTool('run_scheduled_task_now'), 'lead'),
      },
    },
  },
};
