import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const check = (tree) => spawnSync(process.execPath, [join(here, 'refs.mjs'), join(here, 'fixtures', 'refs', tree)], { encoding: 'utf8' });

test('a tree whose references all resolve passes, counting only orbit references', () => {
  const { status, stdout, stderr } = check('clean');
  assert.equal(status, 0, stderr);
  assert.equal(stdout, '10 references checked, 0 broken\n');
});

test('each broken reference kind fails with its file and line', () => {
  const { status, stdout, stderr } = check('broken');
  assert.equal(status, 1, stderr);
  assert.equal(stdout, [
    'FAIL: plugin/skills/alpha/SKILL.md:4 -> /orbit:helper (command)',
    'FAIL: plugin/skills/alpha/SKILL.md:5 -> orbit:missing (name)',
    'FAIL: plugin/skills/alpha/SKILL.md:6 -> ../missing/SKILL.md (path)',
    '3 references checked, 3 broken',
    '',
  ].join('\n'));
});
