import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin');
const read = (path) => readFileSync(join(plugin, path), 'utf8');
const docs = {
  shipping: read('skills/playbook/playbooks/shipping.md'),
  babysit: read('skills/playbook/playbooks/babysit.md'),
  autopilot: read('skills/playbook/playbooks/autopilot-full.md'),
  t3: read('docs/harness/t3-code.md'),
  gitops: read('agents/gitops.md'),
};
const has = (doc, ...fragments) => {
  for (const f of fragments) assert.ok(docs[doc].includes(f), `${doc} says ${JSON.stringify(f)}`);
};

// Shipping step 4. `accepted` is step 3's (PR, base, head). `pr` is gitops' fresh pull_request_read.
function preMergeGate(accepted, pr) {
  const drift = [];
  if (pr.headSha !== accepted.head) drift.push('head');
  if (pr.baseBranch !== accepted.base) drift.push('base');
  if (drift.length) return { action: 'reverify', drift };
  if (pr.checks.pending > 0) return { action: 'wait' };
  return { action: 'merge', args: { number: accepted.pr, expectedHeadSha: accepted.head, method: 'squash' } };
}

const landed = (pr, trunk) => pr.state === 'merged' && pr.baseBranch === trunk;

// Shipping steps 4, 5 and 7 over a bottom-up stack. A merge of an open PR reads back merged.
function landStack(stack, trunk) {
  const prs = stack.map((pr) => ({ ...pr }));
  const log = [];
  for (const [i, pr] of prs.entries()) {
    if (pr.state === 'closed') break;
    if (pr.state === 'open') {
      log.push(['merge', pr.number]);
      pr.state = 'merged';
    }
    if (!landed(pr, trunk)) break;
    const child = prs[i + 1];
    if (child?.state === 'open' && child.baseBranch === pr.branch) {
      log.push(['retarget', child.number]);
      child.baseBranch = trunk;
    }
  }
  return { log, complete: landed(prs.at(-1), trunk), cleanup: prs.filter((pr) => landed(pr, trunk)).map((pr) => pr.branch) };
}

function checkState(pr) {
  if (!pr.checks) return 'unavailable';
  const { passed, pending, failed } = pr.checks;
  if (passed + pending + failed > 0) return 'reported';
  return pr.ciConfig || pr.justPushed ? 'unregistered' : 'no-ci';
}

const reviewSignal = new Map([['APPROVED', 'ok'], [null, 'ok'], ['REVIEW_REQUIRED', 'wait'], ['CHANGES_REQUESTED', 'blocker']]);

// Babysit's Read bullet. `reviewDecision` is undefined when pull_request_list is absent or omits it.
function babysitVerdict(pr, { reviewDecision, zeroCheckReads = 0 } = {}) {
  if (pr.state === 'merged') return 'COMPLETE';
  if (pr.state === 'closed') return 'CLOSED';
  const checks = checkState(pr);
  const review = reviewSignal.get(reviewDecision) ?? 'unknown';
  if (pr.mergeability === 'conflicting' || pr.checks?.failed > 0 || pr.unresolvedThreads > 0 || review === 'blocker') return 'BLOCKER';
  if (checks === 'unavailable') return 'HANDBACK';
  if (checks === 'unregistered') return zeroCheckReads > 0 ? 'HANDBACK' : 'WAIT';
  if (pr.checks.pending > 0 || review === 'wait') return 'WAIT';
  if (review === 'unknown') return 'UNKNOWN';
  return pr.mergeability === 'mergeable' ? 'READY' : 'HANDBACK';
}

const green = { passed: 3, pending: 0, failed: 0 };
const openPr = (extra = {}) => ({ number: 7, state: 'open', baseBranch: 'main', headSha: 'aaa', checks: green, unresolvedThreads: 0, mergeability: 'mergeable', ...extra });

test('#124 shipping, t3-code, gitops and autopilot-full pin merges to the accepted (PR, base, head) without auto-merge', () => {
  has('shipping', 'accepted merge target `(PR, base, head)`', 'confirms that `headSha` equals the accepted head and `baseBranch` equals the accepted base', '`expectedHeadSha` set to the accepted head', 'It never passes `auto: true`');
  has('gitops', 'Merge only against the accepted `(PR, base, head)`', 'If either differs, stop without merging', '`expectedHeadSha` set to that exact accepted head', 'Never pass `auto: true`');
  has('t3', '`expectedHeadSha` set to the accepted `headSha` the verdict covers', 'Never pass `auto: true`');
  has('autopilot', 'Merge only against the accepted `(PR, base, head)`', 'as Shipping step 4 says');
  for (const doc of Object.keys(docs)) assert.doesNotMatch(docs[doc], /Pass `auto: true` only/, `${doc} no longer allows auto: true`);
});

test('#124 pre-merge gate merges only the accepted head and re-verifies any drift', () => {
  const accepted = { pr: 7, base: 'main', head: 'aaa' };
  const merge = preMergeGate(accepted, openPr());
  assert.equal(merge.action, 'merge');
  assert.equal(merge.args.expectedHeadSha, 'aaa');
  assert.ok(!('auto' in merge.args), 'merge passes no auto flag');

  assert.deepEqual(preMergeGate(accepted, openPr({ headSha: 'bbb' })), { action: 'reverify', drift: ['head'] }, 'head pushed between verdict and merge');

  assert.deepEqual(preMergeGate(accepted, openPr({ checks: { passed: 1, pending: 2, failed: 0 } })), { action: 'wait' }, 'pending checks return without merging');
  assert.deepEqual(preMergeGate(accepted, openPr({ headSha: 'ccc' })), { action: 'reverify', drift: ['head'] }, 'head pushed while waiting on checks');

  assert.deepEqual(preMergeGate(accepted, openPr({ baseBranch: 'feat/other' })), { action: 'reverify', drift: ['base'] }, 'base retargeted');
});

test('#125 babysit and shipping split CLOSED from COMPLETE and land only merged PRs on trunk', () => {
  has('babysit', '`COMPLETE`. The PR merged (`state` is `merged`).', '`CLOSED`. The PR closed without merging (`state` is `closed`).', 'a `CLOSED` PR stays the frontier and stops the stack');
  has('shipping', 'A PR has landed only when `state` reads `merged` and `baseBranch` reads the intended trunk.', 'never retarget, rebase or merge a layer above it', '`CLOSED` never counts as `COMPLETE` at the ceiling.', 'its branch and worktrees stay');
  assert.equal(babysitVerdict(openPr({ state: 'closed' })), 'CLOSED');
  assert.equal(babysitVerdict(openPr({ state: 'merged' })), 'COMPLETE');
});

test('#125 a closed root PR stops a 2-PR stack before the child merges or retargets', () => {
  const run = landStack([
    { number: 1, branch: 'feat/root', state: 'closed', baseBranch: 'main' },
    { number: 2, branch: 'feat/child', state: 'open', baseBranch: 'feat/root' },
  ], 'main');
  assert.deepEqual(run.log, []);
  assert.equal(run.complete, false);
  assert.deepEqual(run.cleanup, []);
});

test('#125 a closed ceiling never completes the stack and keeps its branch', () => {
  const run = landStack([
    { number: 1, branch: 'feat/root', state: 'open', baseBranch: 'main' },
    { number: 2, branch: 'feat/ceiling', state: 'closed', baseBranch: 'feat/root' },
  ], 'main');
  assert.deepEqual(run.log, [['merge', 1]]);
  assert.equal(run.complete, false);
  assert.deepEqual(run.cleanup, ['feat/root']);
});

test('#126 babysit names unavailable, no-ci and unregistered zero-check states', () => {
  has('babysit', '`unavailable`. `pull_request_read` omits `checks`', 'so the PR is never `READY`', '`no-ci`. `checks` counts 0 passed, 0 pending and 0 failed', '`unregistered`. `checks` counts zero, but the repo holds CI config or a push just happened.', 'a second read still shows zero checks, unwatch the PR and hand back');
});

test('#126 zero-check states resolve to READY, bounded WAIT or handback', () => {
  const none = { passed: 0, pending: 0, failed: 0 };
  assert.equal(babysitVerdict(openPr({ checks: none, ciConfig: false }), { reviewDecision: null }), 'READY', 'known no-CI with clean mergeability');

  const unregistered = openPr({ checks: none, ciConfig: true });
  assert.equal(babysitVerdict(unregistered, { reviewDecision: null }), 'WAIT', 'first read waits');
  assert.equal(babysitVerdict(unregistered, { reviewDecision: null, zeroCheckReads: 1 }), 'HANDBACK', 'repeat read hands back');

  assert.equal(babysitVerdict(openPr({ checks: undefined }), { reviewDecision: 'APPROVED' }), 'HANDBACK', 'unavailable check data is never READY');
});

test('#127 babysit, t3-code and gitops page comments and read reviewDecision from pull_request_list', () => {
  has('babysit', 'include: ["checks", "threads", "comments"]', 'read again with `cursor` set to `nextCursor`', "Take each PR's `reviewDecision` from `pull_request_list`", '`CHANGES_REQUESTED` blocks even when `unresolvedThreads` is 0', 'An unknown review state is never `READY`');
  has('t3', "Babysit's status read names `checks`, `threads` and `comments`", "`pull_request_list` gives each PR's `reviewDecision`", 'the review state is unknown, never approved');
  has('gitops', 'include: ["checks", "threads", "comments"]', 'paging with `cursor`', 'Take its `reviewDecision` from `pull_request_list`');
});

test('#127 reviewDecision drives WAIT, BLOCKER, READY and unknown', () => {
  assert.equal(babysitVerdict(openPr(), { reviewDecision: 'REVIEW_REQUIRED' }), 'WAIT');
  assert.equal(babysitVerdict(openPr({ unresolvedThreads: 0 }), { reviewDecision: 'CHANGES_REQUESTED' }), 'BLOCKER');
  assert.equal(babysitVerdict(openPr(), { reviewDecision: null }), 'READY');
  assert.equal(babysitVerdict(openPr()), 'UNKNOWN', 'missing reviewDecision');
  assert.equal(babysitVerdict(openPr(), { reviewDecision: 'DISMISSED_SOMEHOW' }), 'UNKNOWN', 'unrecognized reviewDecision');
});

test('#128 shipping and gitops guard parent branch deletion and read back the child base', () => {
  for (const doc of ['shipping', 'gitops']) {
    has(doc, 'git ls-remote origin refs/heads/', 'git push --force-with-lease=refs/heads/');
    const unguarded = docs[doc].replaceAll('never an unguarded `git push origin --delete`', '');
    assert.doesNotMatch(unguarded, /git push origin --delete/, `${doc} never deletes a branch unguarded`);
  }
  has('shipping', 'Its `baseBranch` must equal the intended trunk before any rebase or merge.');
  has('gitops', 'read the child PR with `pull_request_read` and report its `baseBranch`');
});

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'orbit', GIT_AUTHOR_EMAIL: 'orbit@example.invalid', GIT_COMMITTER_NAME: 'orbit', GIT_COMMITTER_EMAIL: 'orbit@example.invalid' };
const git = (cwd, ...args) => spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv, encoding: 'utf8' });
const ok = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

function remoteWithParent() {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-ship-lease-'));
  ok(dir, 'init', '--bare', 'remote.git');
  ok(dir, 'clone', 'remote.git', 'local');
  const local = join(dir, 'local');
  ok(local, 'commit', '--allow-empty', '-m', 'base');
  ok(local, 'push', 'origin', 'HEAD:main');
  ok(local, 'checkout', '-b', 'parent-branch');
  ok(local, 'commit', '--allow-empty', '-m', 'parent');
  ok(local, 'push', 'origin', 'parent-branch');
  return { dir, local, tip: ok(local, 'rev-parse', 'HEAD') };
}
const lsRemote = (cwd) => ok(cwd, 'ls-remote', 'origin', 'refs/heads/parent-branch');
const guardedDelete = (cwd, tip) => git(cwd, 'push', `--force-with-lease=refs/heads/parent-branch:${tip}`, 'origin', ':refs/heads/parent-branch');

test('#128 guarded delete removes a merged parent branch still at its tip', () => {
  const { dir, local, tip } = remoteWithParent();
  try {
    assert.equal(lsRemote(local), `${tip}\trefs/heads/parent-branch`);
    assert.equal(guardedDelete(local, tip).status, 0, 'delete at the expected tip succeeds');
    assert.equal(lsRemote(local), '', 'remote branch is gone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#128 guarded delete keeps a parent branch that moved after the merge', () => {
  const { dir, local, tip } = remoteWithParent();
  try {
    ok(dir, 'clone', '--branch', 'parent-branch', 'remote.git', 'other');
    const other = join(dir, 'other');
    ok(other, 'commit', '--allow-empty', '-m', 'late push');
    ok(other, 'push', 'origin', 'parent-branch');
    const newTip = ok(other, 'rev-parse', 'HEAD');
    assert.notEqual(newTip, tip);

    assert.notEqual(guardedDelete(local, tip).status, 0, 'lease on the old tip rejects the delete');
    assert.equal(lsRemote(local), `${newTip}\trefs/heads/parent-branch`, 'moved branch survives');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
