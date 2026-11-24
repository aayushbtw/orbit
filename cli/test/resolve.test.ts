import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { EffectiveAssignmentRow } from '../src/config.js';
import { rowProviderTargets } from '../src/resolve.js';

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
type Item = Record<string, any>;
let home: string;
let workspace: string;

const sampleCatalog = {
  inheritedProviderInstanceId: 'antigravity',
  inheritedModel: 'gemini-pro-orchestrator-neon',
  runtimeMode: 'full-access',
  providers: [
    {
      providerInstanceId: 'antigravity',
      driverKind: 'antigravity',
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      runtimeModes: ['approval-required', 'auto-accept-edits', 'auto', 'full-access'],
      models: [
        { id: 'gemini-4-neon', options: [{ id: 'thought_level', values: ['low', 'medium', 'high', 'xhigh'] }] },
        { id: 'gemini-pro-orchestrator-neon', options: [{ id: 'thought_level', values: ['low', 'medium', 'high', 'xhigh'] }] },
      ],
    },
    {
      providerInstanceId: 'claudeAgent',
      driverKind: 'claudeAgent',
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      models: [
        { id: 'claude-opus-5-5', options: [{ id: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max', 'ultrathink'] }] },
        { id: 'claude-fable-5-2', options: [{ id: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max', 'ultrathink'] }] },
      ],
    },
    {
      providerInstanceId: 'codex',
      driverKind: 'codex',
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      omittedModels: 2,
      models: [
        { id: 'gpt-6.2-sol', options: [{ id: 'reasoningEffort', values: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }] },
      ],
    },
    {
      providerInstanceId: 'grok',
      driverKind: 'grok',
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      runtimeModes: ['approval-required', 'auto', 'full-access'],
      models: [
        { id: 'grok-4.7', options: [{ id: 'reasoningEffort', values: ['low', 'medium', 'high', 'xhigh'] }] },
      ],
    },
    {
      providerInstanceId: 'cursor',
      driverKind: 'cursor',
      canRunChildTask: false,
      canRunCrossProviderChildTask: false,
      constraints: ['Provider instance is disabled.'],
      models: [],
    },
  ],
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orbit-resolve-test-'));
  workspace = join(home, 'repo');
  mkdirSync(workspace);
  const capPath = join(home, '.config/orbit/capabilities.json');
  mkdirSync(dirname(capPath), { recursive: true });
  writeFileSync(capPath, JSON.stringify(sampleCatalog));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '', T3_ACP_MCP_NODE: '' },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return result;
}

function json(...args: string[]) {
  const result = run(...args, '--json');
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const modelsTable = (rows: string) => `## Workflow\n\n### Models\n\n| Task | Use for | Model | Effort |\n| --- | --- | --- | --- |\n${rows}`;

test('unset tasks resolve to inherit with zero hardcoded provider defaults', () => {
  const res = json('models', 'resolve', 'code');
  expect(res).toMatchObject({
    task: 'code',
    mode: 'inherit',
    target: null,
    fallbackToInherit: true,
  });
});

test('resolves provider-native effort options for Claude, Codex ultra, and Antigravity thought_level', () => {
  json('models', 'set', 'code', 'claudeAgent/claude-opus-5-5', '--effort', 'ultrathink');
  json('models', 'set', 'writing', 'antigravity/gemini-4-neon', '--effort', 'medium');
  json('models', 'set', 'hard', 'codex/gpt-6.2-sol', '--effort', 'ultra');

  expect(json('models', 'resolve', 'code')).toMatchObject({
    mode: 'delegate',
    target: {
      providerInstanceId: 'claudeAgent',
      model: 'claude-opus-5-5',
      options: [{ id: 'effort', value: 'ultrathink' }],
    },
  });

  expect(json('models', 'resolve', 'writing')).toMatchObject({
    mode: 'same-provider',
    target: {
      providerInstanceId: 'antigravity',
      model: 'gemini-4-neon',
      options: [{ id: 'thought_level', value: 'medium' }],
    },
  });

  expect(json('models', 'resolve', 'hard')).toMatchObject({
    mode: 'delegate',
    target: {
      providerInstanceId: 'codex',
      model: 'gpt-6.2-sol',
      options: [{ id: 'reasoningEffort', value: 'ultra' }],
    },
  });
});

test('resolves other-family roster with family checks, disabled skips, cap of 3, and verify policy', () => {
  // CLI rejects duplicate providers on `models set other-family`, so verify family check via AGENTS.md too.
  writeFileSync(
    join(workspace, 'AGENTS.md'),
    `## Workflow\n\n### Models\n\n| Task | Use for | Model | Effort |\n| --- | --- | --- | --- |\n| \`other-family\` | | cursor, antigravity/gemini-4-neon, codex/gemini-custom, codex, grok, claudeAgent | |\n| \`verify\` | | other-family | |\n`,
  );

  const resolved = json('models', 'resolve', 'verify');
  expect(resolved.mode).toBe('delegate');
  expect(resolved.onAllFailed).toBe('ask');
  expect(resolved.target).toMatchObject({ providerInstanceId: 'grok', model: 'grok-4.7' });
  expect(resolved.candidates.map((c: Item) => c.providerInstanceId)).toEqual([
    'grok',
    'claudeAgent',
  ]);
  expect(resolved.unavailable).toEqual([
    { entry: 'cursor', reason: 'Provider instance is disabled.' },
    { entry: 'codex/gemini-custom', reason: "gemini-custom is the session's family" },
    { entry: 'codex', reason: 'provider already a candidate' },
  ]);

  // Setting a valid unique roster overrides AGENTS.md when in .orbit/config.json or when AGENTS.md removed
  writeFileSync(join(workspace, 'AGENTS.md'), '');
  json('models', 'set', 'other-family', 'cursor, antigravity/gemini-4-neon, codex, grok, claudeAgent');
  json('models', 'set', 'verify', 'other-family');
  const cleanRoster = json('models', 'resolve', 'verify');
  expect(cleanRoster.candidates.map((c: Item) => c.providerInstanceId)).toEqual(['codex', 'grok', 'claudeAgent']);

  // Verify holds/asks if every listed provider is disabled
  json('models', 'set', 'other-family', 'cursor');
  const blocked = json('models', 'resolve', 'verify');
  expect(blocked.mode).toBe('ask');
  expect(blocked.target).toBeNull();

  // Verify falls back to inherit only when explicitly configured
  json('models', 'set', 'verify', 'other-family, inherit');
  const fallback = json('models', 'resolve', 'verify');
  expect(fallback.mode).toBe('inherit');
  expect(fallback.fallbackToInherit).toBe(true);
});

test('supports work-type escalation after N failed tries and panel resolution', () => {
  json(
    'models',
    'set',
    'shaders',
    'antigravity/gemini-4-neon',
    '--use',
    'Shader work',
    '--effort',
    'medium',
    '--escalate',
    '2:claudeAgent/claude-opus-5-5',
  );

  const try0 = json('models', 'resolve', 'code', '--work-type', 'shaders', '--tries', '0');
  expect(try0.escalated).toBe(false);
  expect(try0.target).toMatchObject({ providerInstanceId: 'antigravity', model: 'gemini-4-neon' });

  const try2 = json('models', 'resolve', 'code', '--work-type', 'shaders', '--tries', '2');
  expect(try2.escalated).toBe(true);
  expect(try2.target).toMatchObject({ providerInstanceId: 'claudeAgent', model: 'claude-opus-5-5' });

  json('models', 'set', 'other-family', 'codex/gpt-6.2-sol');
  json('models', 'set', 'hard', 'claudeAgent/claude-opus-5-5');
  json('models', 'set', 'interrogate', 'hard, other-family');
  const panel = json('models', 'resolve', 'interrogate');
  expect(panel.mode).toBe('panel');
  expect(panel.seats).toHaveLength(2);
  expect(panel.seats[0].target).toMatchObject({ providerInstanceId: 'claudeAgent', model: 'claude-opus-5-5' });
  expect(panel.seats[1].target).toMatchObject({ providerInstanceId: 'codex', model: 'gpt-6.2-sol' });
});

test('arena accepts comma-separated runner seats and validates --judge', () => {
  const rows = json('models', 'set', 'arena', 'hard, code', '--judge', 'other-family');
  expect(rows.find((r: Item) => r.task === 'arena')).toMatchObject({ entries: ['judgment', 'code'], judge: 'other-family' });
  const defaults = json('models', 'resolve', 'arena');
  expect(defaults.seats.map((s: Item) => s.seat)).toEqual(['runner-1', 'runner-2', 'judge']);
  expect(defaults.seats[0]).toMatchObject({ task: 'judgment', mode: 'inherit' });
  expect(defaults.seats[1]).toMatchObject({ task: 'code', mode: 'inherit' });

  const badJudge = run('models', 'set', 'arena', 'hard, code', '--judge', 'not a target');
  expect(badJudge.status).toBe(1);
  expect(badJudge.stderr).toContain('Invalid arena judge "not a target"');
  const badRunner = run('models', 'set', 'arena', 'hard, bad entry');
  expect(badRunner.status).toBe(1);
  expect(badRunner.stderr).toContain('arena seats');
  const judgeElsewhere = run('models', 'set', 'code', 'claudeAgent/claude-opus-5-5', '--judge', 'judgment');
  expect(judgeElsewhere.status).toBe(1);
  expect(judgeElsewhere.stderr).toContain('--judge applies only to the arena panel');

  json('models', 'set', 'arena', 'claudeAgent/claude-fable-5-2@high, code', '--judge', 'grok/grok-4.7@medium');
  const panel = json('models', 'resolve', 'arena');
  expect(panel.seats[0].target).toMatchObject({
    providerInstanceId: 'claudeAgent',
    model: 'claude-fable-5-2',
    options: [{ id: 'effort', value: 'high' }],
  });
  expect(panel.seats[1].mode).toBe('inherit');
  expect(panel.seats[2].target).toMatchObject({
    providerInstanceId: 'grok',
    model: 'grok-4.7',
    options: [{ id: 'reasoningEffort', value: 'medium' }],
  });
});

test('effort follows the plugin levels unless a target model lists its own', () => {
  expect(run('models', 'set', 'judgment', 'opus', '--effort', 'ultra').status).toBe(1);
  expect(run('models', 'set', 'code', 'claudeAgent/claude-opus-5-5', '--effort', 'ultra').stderr)
    .toContain('Choose effort from low, medium, high, xhigh, max, ultrathink for claude-opus-5-5');
  json('models', 'set', 'code', 'codex/gpt-6.2-sol', '--effort', 'ultra');
  json('models', 'set', 'code', 'codex/gpt-7-preview', '--effort', 'turbo');
  expect(json('models', 'resolve', 'code').target).toMatchObject({ model: 'gpt-7-preview', modelVerified: false });
  json('models', 'set', 'judgment', 'opus', '--effort', 'high');
});

test('doctor checks every entry of comma-separated roster, interrogate and arena rows', () => {
  json('install', '--yes');
  json('models', 'set', 'other-family', 'codex/gpt-6.2-sol, claudeAgent/claude-opus-5-5');
  json('models', 'set', 'interrogate', 'judgment, codex/gpt-6.2-sol@high');
  json('models', 'set', 'arena', 'hard, claudeAgent/claude-fable-5-2', '--judge', 'grok/grok-4.7');
  const healthy = json('doctor');
  expect(healthy.issues).toEqual([]);
  expect(healthy.healthy).toBe(true);

  json('models', 'set', 'arena', 'hard, claudeAgent/claude-fable-5-2', '--judge', 'grok/grok-9');
  json('models', 'set', 'other-family', 'codex/gpt-6.2-sol, cursor/some-model');
  json('models', 'set', 'interrogate', 'judgment, claudeAgent/claude-haiku-9@low');
  const sick = json('doctor');
  expect(sick.healthy).toBe(false);
  expect(sick.issues.sort()).toEqual([
    'model arena (grok/grok-9): model grok-9 not listed on grok',
    'model interrogate (claudeAgent/claude-haiku-9): model claude-haiku-9 not listed on claudeAgent',
    'model other-family (cursor/some-model): provider cursor is disabled',
  ]);
});

test('interrogate and arena read AGENTS.md ### Models overrides below .orbit/config.json', () => {
  json('models', 'set', 'interrogate', 'judgment, other-family');
  writeFileSync(join(workspace, 'AGENTS.md'), modelsTable(
    '| interrogate | | codex/gpt-6.2-sol@high, judgment | |\n'
    + '| arena | | claudeAgent/claude-fable-5-2, code, judge=grok/grok-4.7 | |\n',
  ));

  const interrogate = json('models', 'resolve', 'interrogate');
  expect(interrogate.source).toContain('AGENTS.md');
  expect(interrogate.seats[0].target).toMatchObject({
    providerInstanceId: 'codex',
    model: 'gpt-6.2-sol',
    options: [{ id: 'reasoningEffort', value: 'high' }],
  });
  expect(interrogate.seats[1]).toMatchObject({ task: 'judgment', mode: 'inherit' });

  const arena = json('models', 'resolve', 'arena');
  expect(arena.source).toContain('AGENTS.md');
  expect(arena.seats.map((s: Item) => s.seat)).toEqual(['runner-1', 'runner-2', 'judge']);
  expect(arena.seats[0].target).toMatchObject({ providerInstanceId: 'claudeAgent', model: 'claude-fable-5-2' });
  expect(arena.seats[1].mode).toBe('inherit');
  expect(arena.seats[2].target).toMatchObject({ providerInstanceId: 'grok', model: 'grok-4.7' });
  expect(json('models', 'list').filter((r: Item) => r.task === 'interrogate' || r.task === 'arena').map((r: Item) => r.kind))
    .toEqual(['panel', 'panel']);

  json('models', 'set', 'interrogate', 'code', '--project');
  const project = json('models', 'resolve', 'interrogate');
  expect(project.source).toContain(join('.orbit', 'config.json'));
  expect(project.seats).toHaveLength(1);
});

test('all five roles default to inherit', () => {
  const rows = json('models', 'list');
  for (const role of ['advisor', 'judgment', 'code', 'verifier', 'gitops']) {
    expect(rows.find((r: EffectiveAssignmentRow) => r.task === role)).toMatchObject({ target: 'inherit', targetSource: 'default' });
    expect(json('models', 'resolve', role)).toMatchObject({ mode: 'inherit', target: null });
  }
});

test('--effort on a panel fails and points at per-seat @effort', () => {
  for (const panel of ['interrogate', 'arena']) {
    const res = run('models', 'set', panel, 'judgment, codex/gpt-6.2-sol', '--effort', 'high');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`--effort does not apply to the ${panel} panel`);
    expect(res.stderr).toContain('<provider>/<model>@<effort>');
  }
  json('models', 'set', 'interrogate', 'judgment, codex/gpt-6.2-sol@high');
});

test('AGENTS.md arena accepts spaces around judge = and reports malformed panel entries', () => {
  writeFileSync(join(workspace, 'AGENTS.md'), modelsTable('| arena | | code, judge = grok/grok-4.7 | |\n'));
  const arena = json('models', 'resolve', 'arena');
  expect(arena.seats.map((s: { seat: string }) => s.seat)).toEqual(['runner-1', 'judge']);
  expect(arena.seats[1].target).toMatchObject({ providerInstanceId: 'grok', model: 'grok-4.7' });
  expect(json('status').projectConfigError).toBeUndefined();

  for (const [row, message] of [
    ['| arena | | code, judge = invalid | |\n', 'Invalid arena judge "invalid"'],
    ['| arena | | code, bad seat | |\n', 'Invalid arena seat "bad seat"'],
    ['| interrogate | | judgment, nope | |\n', 'Invalid interrogate seat "nope"'],
  ]) {
    writeFileSync(join(workspace, 'AGENTS.md'), modelsTable(row));
    expect(json('status').projectConfigError).toContain(message);
    const doctor = json('doctor');
    expect(doctor.healthy).toBe(false);
    expect(doctor.issues.some((issue: string) => issue.startsWith('project config:') && issue.includes(message))).toBe(true);
  }
});

test('doctor and resolve agree that @ is part of a single-task model id', () => {
  const row = (task: string, kind: EffectiveAssignmentRow['kind'], target: string, extra: Partial<EffectiveAssignmentRow> = {}) => ({
    task, kind, use: task, target, targetSource: 'test', effort: '', effortSource: 'test', options: {}, fallbacks: [], userTarget: '', userEffort: '', ...extra,
  });
  expect(rowProviderTargets(row('code', 'task', 'claudeAgent/claude-opus-5-5@beta', {
    fallbacks: ['codex/gpt-6.2-sol@2026'],
    escalate: { after: 1, target: 'grok/grok-4.7@fast' },
  }))).toEqual(['claudeAgent/claude-opus-5-5@beta', 'codex/gpt-6.2-sol@2026', 'grok/grok-4.7@fast']);
  expect(rowProviderTargets(row('interrogate', 'panel', 'x', { entries: ['judgment', 'codex/gpt-6.2-sol@high'], judge: undefined })))
    .toEqual(['codex/gpt-6.2-sol']);
  expect(rowProviderTargets(row('arena', 'panel', 'x', { entries: ['code'], judge: 'grok/grok-4.7@medium' }))).toEqual(['grok/grok-4.7']);

  json('install', '--yes');
  json('models', 'set', 'code', 'claudeAgent/claude-opus-5-5@beta');
  expect(json('models', 'resolve', 'code')).toMatchObject({
    mode: 'unavailable',
    unavailable: [{ entry: 'claudeAgent/claude-opus-5-5@beta', reason: 'model claude-opus-5-5@beta not listed on claudeAgent' }],
  });
  expect(json('doctor').issues).toEqual([
    'model code (claudeAgent/claude-opus-5-5@beta): model claude-opus-5-5@beta not listed on claudeAgent',
  ]);
});
