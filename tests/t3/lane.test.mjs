import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clash } from './branches.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { encoding: 'utf8' }).trim();
const branches = (dir) => git(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads');

const STUB = `#!/usr/bin/env node
const { execFileSync, execSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const args = process.argv.slice(2);
const state = process.env.STUB_STATE;
const flag = (name) => args[args.indexOf(name) + 1];
if (args[0] === '--version') { console.log('stub'); process.exit(0); }
if (args[0] === 'thread' && args[1] === 'start') {
  readFileSync(0);
  const project = args[2];
  const worktreePath = join(process.env.STUB_WORKTREES, basename(project), 'wt');
  mkdirSync(join(worktreePath, '..'), { recursive: true });
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', flag('--branch'), worktreePath, flag('--worktree')]);
  execSync(process.env.STUB_AGENT, { cwd: worktreePath, stdio: 'ignore' });
  writeFileSync(state, JSON.stringify({ threadId: 'stub-thread', title: flag('--title'), worktreePath }));
  console.log(JSON.stringify({ threadId: 'stub-thread', reply: 'done' }));
  process.exit(0);
}
const s = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : null;
if (args[0] === 'thread' && args[1] === 'list') { console.log(JSON.stringify(s ? [s] : [])); process.exit(0); }
if (args[0] === 'thread' && args[1] === 'show') {
  console.log(JSON.stringify({ thread: { threadId: s.threadId, link: 't3://stub', providerInstanceId: 'stub', model: 'stub', runtimeMode: 'full-access', worktreePath: s.worktreePath, pendingRequestCount: 0 }, messages: [] }));
  process.exit(0);
}
process.exit(1);
`;

function withProject(setup, agent) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-lane-test-')));
  try {
    const project = join(root, 'project');
    git(root, 'init', '-q', '-b', 'main', project);
    git(project, 'commit', '-q', '--allow-empty', '-m', 'base');
    for (const args of setup) git(project, ...args);
    const stub = join(root, 't3');
    writeFileSync(stub, STUB);
    chmodSync(stub, 0o755);
    const before = branches(project);
    const env = {
      ...process.env,
      T3CODE_CLI_PATH: stub, STUB_STATE: join(root, 'state.json'), STUB_WORKTREES: join(root, 'worktrees'), STUB_AGENT: agent,
      CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex'), GROK_HOME: join(root, 'grok'),
    };
    const lane = spawnSync(process.execPath, [join(here, 'lane.mjs'), '--head', 'HEAD', '--scenario', 'probe', '--project', project, '--installed', '--out', join(root, 'out.json')], { encoding: 'utf8', env });
    assert.equal(lane.status, 0, lane.stderr);
    return { before, after: branches(project), worktrees: git(project, 'worktree', 'list', '--porcelain') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const ref of ['refs/heads/feature/keep', 'refs/heads/Main']) {
  test(`cleanup keeps every earlier branch when the thread checks out ${ref}, a case variant of one`, () => {
    const { before, after } = withProject([['branch', 'Feature/Keep']], `git symbolic-ref HEAD ${ref}`);
    assert.equal(after, before);
  });
}

test('cleanup keeps every earlier branch when the thread points HEAD outside refs/heads', () => {
  const { before, after } = withProject([['branch', '1'], ['update-ref', 'refs/tags/v1', 'HEAD']], 'git symbolic-ref HEAD refs/tags/v1');
  assert.equal(after, before);
});

test('cleanup deletes the lane branch after the thread renames it and commits on it', () => {
  const { before, after, worktrees } = withProject([['branch', 'Feature/Keep']], 'git branch -m feat/renamed && git -c user.name=t -c user.email=t@t.invalid commit -q --allow-empty -m work');
  assert.equal(after, before);
  assert.equal(worktrees.split('\n\n').length, 1, worktrees);
});

test('cleanup deletes the lane branch when the thread leaves it checked out', () => {
  const { before, after } = withProject([], 'true');
  assert.equal(after, before);
});

test('a lane branch name that differs from an existing branch only in case clashes', () => {
  const existing = new Map([['refs/heads/Orbit-Lane/probe-1a2b', 'x'], ['refs/heads/main', 'y']]);
  assert.equal(clash(existing, 'refs/heads/orbit-lane/probe-1a2b'), 'refs/heads/Orbit-Lane/probe-1a2b');
  assert.equal(clash(existing, 'refs/heads/orbit-lane/probe-9f9f'), undefined);
});
