import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function check(files) {
  const root = mkdtempSync(join(tmpdir(), 'provider-names-'));
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    return spawnSync(process.execPath, [join(here, 'provider-names.mjs'), root], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true });
  }
}

test('a tree with provider names only in allowlisted files, node_modules or binaries passes', () => {
  const { status, stdout, stderr } = check({
    'plugin/skills/rules/SKILL.md': 'Use the lead tool list.\n',
    'plugin/skills/setup/SKILL.md': 'Rank codex, then grok.\n',
    'plugin/node_modules/x/README.md': 'gemini\n',
    'plugin/icon.bin': Buffer.from([0, 110, 101, 111, 110]),
  });
  assert.equal(status, 0, stderr);
  assert.equal(stdout, '1 files checked, no provider names outside the allowlist\n');
});

test('each provider name outside the allowlist fails with its file, line and word', () => {
  const { status, stdout, stderr } = check({
    'plugin/skills/rules/SKILL.md': 'Fine line.\nOn Codex, call spawn_agent.\n',
    'plugin/docs/a.md': 'neonatal and grokking do not count\nAntigravity runs Neon.\n',
  });
  assert.equal(status, 1, stderr);
  assert.deepEqual(stdout.trim().split('\n').sort(), [
    '4 provider names outside the allowlist',
    'plugin/docs/a.md:2: Antigravity',
    'plugin/docs/a.md:2: Neon',
    'plugin/skills/rules/SKILL.md:2: Codex',
    'plugin/skills/rules/SKILL.md:2: spawn_agent',
  ].sort());
});
