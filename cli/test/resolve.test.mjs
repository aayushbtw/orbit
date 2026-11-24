import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
let home;
let workspace;

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

function json(...args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    cwd: workspace,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: '' },
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

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
  expect(resolved.candidates.map((c) => c.providerInstanceId)).toEqual([
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
  expect(cleanRoster.candidates.map((c) => c.providerInstanceId)).toEqual(['codex', 'grok', 'claudeAgent']);

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
