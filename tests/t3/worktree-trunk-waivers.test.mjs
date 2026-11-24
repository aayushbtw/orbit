import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(repo, path), 'utf8');
const docs = {
  playbook: read('plugin/skills/playbook/SKILL.md'),
  start: read('plugin/skills/start/SKILL.md'),
  openingPr: read('plugin/skills/playbook/playbooks/opening-a-pr.md'),
  t3: read('plugin/docs/harness/t3-code.md'),
  shipping: read('plugin/skills/playbook/playbooks/shipping.md'),
  gitops: read('plugin/agents/gitops.md'),
  autopilotFull: read('plugin/skills/playbook/playbooks/autopilot-full.md'),
  autopilotStack: read('plugin/skills/playbook/playbooks/autopilot-stack.md'),
  rules: read('plugin/rules.md'),
  workflowBlock: read('plugin/skills/setup/workflow-block.md'),
  updateSkills: read('.claude/commands/update-skills.md'),
};
const has = (doc, ...fragments) => {
  for (const f of fragments) assert.ok(docs[doc].includes(f), `${doc} says ${JSON.stringify(f)}`);
};

// The playbook's Waivers. Each waiver skips only its own actions, and a lift permits one action back.
const waives = new Map([
  ['no commit', ['commit', 'pr', 'ship']],
  ['just testing', ['commit', 'pr', 'ship']],
  ['quick check', ['commit', 'pr', 'ship']],
  ['no subagents', ['spawn', 'ship']],
  ['skip e2e', ['e2e']],
  ['no pr', ['pr', 'ship']],
]);
const lifts = new Map([['commit each unit', 'commit']]);

function waiverPlan(message) {
  const skipped = new Set();
  const permitted = new Set();
  for (const clause of message.toLowerCase().split(',').map((c) => c.trim())) {
    for (const action of waives.get(clause) ?? []) skipped.add(action);
    if (lifts.has(clause)) permitted.add(lifts.get(clause));
  }
  const allowed = (action) => permitted.has(action) || !skipped.has(action);
  return {
    delegateGate: allowed('spawn'),
    spawn: allowed('spawn'),
    commit: allowed('commit'),
    pr: allowed('pr'),
    ship: allowed('ship'),
    selfVerify: false,
  };
}

test('#129 playbook, start, opening-a-pr and t3-code define Waivers and carry them into handoffs and briefs', () => {
  has('playbook', '**Waivers.**', 'stays active until the user lifts it', '**Ship by default** in Opening a PR included', 'Each waiver skips only its own actions');
  has('playbook', 'Carry every active waiver verbatim in the `t3_worktree_handoff` `continuationPrompt` and in every subagent or `delegate_task` brief.');
  has('start', 'Each waiver maps to its own action as **Waivers** in the playbook skill says.', 'Carry active waivers verbatim in the `t3_worktree_handoff` `continuationPrompt` and in every subagent or `delegate_task` brief.');
  has('openingPr', 'An active waiver (`SKILL.md` **Waivers**) outranks this default and every step below.');
  has('t3', 'every active waiver verbatim (the playbook\'s **Waivers**)');
});

test('#129 no subagents never lets the lead verify its own change', () => {
  has('playbook', 'It never lets you verify your own change.', 'Heads-up says no verifier ran');
  has('openingPr', '`no subagents` stops it at the PR or branch, because no verifier runs.');
});

test('#129 a more specific instruction lifts only the part it names', () => {
  has('playbook', 'permits the action it names and lifts only that part of the waiver', '"just testing, commit each unit, no PR" commits each unit, and still opens no PR and ships nothing.');
  has('start', 'a more specific instruction lifts only the part of it that instruction names');
});

test('#129 waiver decisions', () => {
  assert.deepEqual(waiverPlan('just testing'), { delegateGate: true, spawn: true, commit: false, pr: false, ship: false, selfVerify: false }, 'just testing keeps the Delegate gate and waives commit, PR and shipping');
  assert.deepEqual(waiverPlan('no subagents'), { delegateGate: false, spawn: false, commit: true, pr: true, ship: false, selfVerify: false }, 'no subagents spawns nothing and never self-verifies');
  assert.deepEqual(waiverPlan('just testing, commit each unit, no PR'), { delegateGate: true, spawn: true, commit: true, pr: false, ship: false, selfVerify: false }, 'commit each unit lifts only the commit');
});

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'orbit', GIT_AUTHOR_EMAIL: 'orbit@example.invalid', GIT_COMMITTER_NAME: 'orbit', GIT_COMMITTER_EMAIL: 'orbit@example.invalid' };
const git = (cwd, ...args) => spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv, encoding: 'utf8' });
const ok = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// The playbook's Trunk order after the Workflow block line.
function resolveTrunk(cwd) {
  const head = git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (head.status === 0) return head.stdout.trim().replace(/^origin\//, '');
  const symref = git(cwd, 'ls-remote', '--symref', 'origin', 'HEAD').stdout.match(/^ref: refs\/heads\/(\S+)\tHEAD$/m);
  return symref ? symref[1] : 'main';
}

function trunkRemote() {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-trunk-'));
  ok(dir, 'init', '--bare', '--initial-branch=trunk', 'remote.git');
  ok(dir, 'init', 'seed');
  const seed = join(dir, 'seed');
  ok(seed, 'commit', '--allow-empty', '-m', 'base');
  ok(seed, 'push', join(dir, 'remote.git'), 'HEAD:trunk');
  return dir;
}

function fetchedClone(dir, name) {
  ok(dir, 'init', name);
  const clone = join(dir, name);
  ok(clone, 'remote', 'add', 'origin', join(dir, 'remote.git'));
  ok(clone, 'fetch', 'origin');
  return clone;
}

// Git 2.48+ sets origin/HEAD on fetch, so the unset case removes it.
function headlessClone(dir, name) {
  const clone = fetchedClone(dir, name);
  git(clone, 'remote', 'set-head', 'origin', '--delete');
  return clone;
}

const doctor = (cwd) => spawnSync('bash', [join(repo, 'plugin/skills/setup/scripts/doctor.sh')], { cwd, env: gitEnv, encoding: 'utf8' });

test('#130 origin/HEAD resolves a trunk-default remote to trunk', () => {
  const dir = trunkRemote();
  try {
    const clone = fetchedClone(dir, 'set-head');
    ok(clone, 'remote', 'set-head', 'origin', '--auto');
    assert.equal(ok(clone, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'), 'origin/trunk');
    assert.equal(resolveTrunk(clone), 'trunk');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#130 ls-remote --symref resolves trunk when origin/HEAD is unset', () => {
  const dir = trunkRemote();
  try {
    const clone = headlessClone(dir, 'no-head');
    assert.notEqual(git(clone, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').status, 0, 'origin/HEAD is unset');
    assert.match(ok(clone, 'ls-remote', '--symref', 'origin', 'HEAD'), /^ref: refs\/heads\/trunk\tHEAD$/m);
    assert.equal(resolveTrunk(clone), 'trunk');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#130 doctor passes a trunk-default repo without reporting origin/main missing', () => {
  const dir = trunkRemote();
  try {
    const setHead = fetchedClone(dir, 'set-head');
    ok(setHead, 'remote', 'set-head', 'origin', '--auto');
    const withHead = doctor(setHead);
    assert.equal(withHead.status, 0, withHead.stderr);
    assert.match(withHead.stdout, /^ok trunk origin\/trunk$/m);
    assert.doesNotMatch(withHead.stdout, /origin\/main missing/);

    const pinned = headlessClone(dir, 'pinned');
    writeFileSync(join(pinned, 'AGENTS.md'), '## Workflow\n\n- Trunk: `trunk`.\n');
    const withLine = doctor(pinned);
    assert.match(withLine.stdout, /^ok trunk origin\/trunk$/m, 'Trunk line pins the branch');
    assert.doesNotMatch(withLine.stdout, /origin\/main missing/);

    const unset = doctor(headlessClone(dir, 'no-head'));
    assert.doesNotMatch(unset.stdout, /origin\/main missing/, 'unset origin/HEAD never claims origin/main is missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#130 trunk docs use the resolved <trunk> and pass baseRef to t3_worktree_handoff', () => {
  has('playbook', '**Trunk** is the project\'s default branch', '`git symbolic-ref --short refs/remotes/origin/HEAD`', '`git ls-remote --symref origin HEAD`', '`baseRef` set to `<trunk>`');
  has('t3', '`baseRef` set to `<trunk>`', 'origin/<trunk>');
  for (const doc of ['playbook', 't3', 'shipping', 'gitops', 'autopilotFull', 'autopilotStack', 'rules']) {
    has(doc, '<trunk>');
    assert.doesNotMatch(docs[doc], /origin\/main/, `${doc} names no hardcoded origin/main`);
  }
  has('workflowBlock', '- Trunk:', '`origin/HEAD`', '`git ls-remote --symref origin HEAD`');
});

test('#137 /update-skills resolves its checkout, bumps every version file and reports unreplayable edits', () => {
  assert.doesNotMatch(docs.updateSkills, /~\/Projects\/orbit/, 'no hardcoded checkout path');
  has('updateSkills', '`git rev-parse --show-toplevel`', '`plugin/.claude-plugin/plugin.json`', '`cli/package.json`', '`cli/package-lock.json`', '`CHANGELOG.md`', 'tests/version-bump.sh', 'could not be replayed');
});

// The Open a PR row. `status` is the lead's t3_worktree_status read, `intended` the task branch.
function openPrStep(status, intended) {
  if (!status?.branch || !intended) return { tool: null, ask: 'bound and intended branch' };
  if (status.branch === intended) return { tool: 'pull_request_create' };
  return {
    tool: null,
    push: `git -C ${status.worktreePath} push -u origin ${intended}`,
    report: `binding mismatch: bound ${status.branch}, intended ${intended}`,
  };
}

const boundStatus = { worktreePath: '/tmp/wt/fix-login', branch: 'fix/login' };
const staleStatus = { worktreePath: '/tmp/wt/fix-login-2', branch: 'fix/login' };

test('#138 pull_request_create runs only when the bound branch is the intended branch', () => {
  assert.deepEqual(openPrStep(boundStatus, 'fix/login'), { tool: 'pull_request_create' });
  assert.deepEqual(openPrStep(staleStatus, 'fix/login-2'), {
    tool: null,
    push: 'git -C /tmp/wt/fix-login-2 push -u origin fix/login-2',
    report: 'binding mismatch: bound fix/login, intended fix/login-2',
  }, 'stale binding pushes the intended branch and reports the mismatch');
  assert.equal(openPrStep(undefined, 'fix/login').tool, null, 'missing status never opens a PR');
});

test('#138 the lead reads t3_worktree_status and gitops guards pull_request_create', () => {
  has('t3', 'the lead reads `t3_worktree_status`', 'only when the bound branch equals the intended task branch', '`git -C <worktree> push -u origin <intended-branch>`');
  has('openingPr', 'read `t3_worktree_status` and give gitops the thread\'s bound branch', 'gitops opens the PR only when the bound branch is the task branch');
  has('gitops', 'Call `pull_request_create` only when the thread\'s bound branch in your brief equals the intended task branch.', '`git -C <worktree> push -u origin <intended-branch>`', 'binding mismatch: bound <bound-branch>, intended <intended-branch>');
  const tools = docs.gitops.match(/^tools: (.*)$/m)[1];
  assert.doesNotMatch(tools, /t3_worktree_status/, 'gitops gets no t3_worktree_status tool');
});
