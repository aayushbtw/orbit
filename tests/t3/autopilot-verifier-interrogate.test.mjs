import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { gradeLane } from './grade.mjs';
import { familyOf } from './scenarios.mjs';

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin');
const read = (path) => readFileSync(join(plugin, path), 'utf8');
const docs = {
  full: read('skills/playbook/playbooks/autopilot-full.md'),
  stack: read('skills/playbook/playbooks/autopilot-stack.md'),
  shipping: read('skills/playbook/playbooks/shipping.md'),
  t3: read('docs/harness/t3-code.md'),
  seats: read('docs/harness/t3-seats.md'),
  verifier: read('agents/verifier.md'),
  interrogate: read('skills/interrogate/SKILL.md'),
};
const has = (doc, ...fragments) => {
  for (const f of fragments) assert.ok(docs[doc].includes(f), `${doc} says ${JSON.stringify(f)}`);
};

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'orbit', GIT_AUTHOR_EMAIL: 'orbit@example.invalid', GIT_COMMITTER_NAME: 'orbit', GIT_COMMITTER_EMAIL: 'orbit@example.invalid' };
const git = (cwd, ...args) => spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv, encoding: 'utf8' });
const ok = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const scratch = (prefix) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const commitFiles = (cwd, files, message) => {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(cwd, path), text);
  ok(cwd, 'add', '-A');
  ok(cwd, 'commit', '-m', message);
  return ok(cwd, 'rev-parse', 'HEAD');
};
const readTree = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true })
  .filter((p) => statSync(join(dir, p)).isFile())
  .map((p) => [relative(dir, join(dir, p)), readFileSync(join(dir, p), 'utf8')])
  .sort(([a], [b]) => a.localeCompare(b)));

test('#131 autopilot-full, autopilot-stack and t3-code bind every owner round to the no-ship build contract', () => {
  has('full', 'the one branch the owner may write', '"Run `/orbit:start <item>, don\'t ship` with the Skill tool. Write only branch `<branch>`. Never merge a PR, never push `<trunk>`."', 'The contract holds for every continuation and every later round, because only the main thread lands.', "Every fix or rebase round's brief carries step 2's build contract verbatim.", 'stops at the committed local branch, pushes nothing');
  has('stack', 'Every owner brief, continuation and later round keeps the build contract of step 2 of `playbooks/autopilot-full.md`, so no owner merges a PR or pushes `<trunk>`.');
  has('t3', "It carries that step's build contract verbatim, which runs `/orbit:start <item>, don't ship`, names the one branch the owner may write, and says \"Never merge a PR, never push `<trunk>`.\", because only the lead lands.", 'Under Land `main`, the owner stops at the committed local branch and pushes nothing.', "carries step 5's build contract verbatim");
});

const ownerBrief = "Run `/orbit:start README teh fix, don't ship` with the Skill tool. Write only branch `fix/readme-teh`. Never merge a PR, never push `<trunk>`.";
const leadCall = (name, input) => ({ name, input, sidechain: false });
const childCall = (name, input) => ({ name, input, sidechain: true });
const delegate = (task) => leadCall('mcp__t3-code__delegate_task', { role: 'implementation', isolation: 'worktree', mode: 'async', clientRequestId: 'owner-1', task });
const ownerOnBranch = [childCall('Bash', { command: 'git commit -m "docs: fix teh"' }), childCall('Bash', { command: 'git rev-parse HEAD' })];
const rootLands = leadCall('Bash', { command: 'git push origin HEAD:main' });

for (const scenario of ['autopilot-full-owner-authority', 'autopilot-stack-owner-authority']) {
  test(`#131 ${scenario} passes an owner that stays on its branch and fails one that lands`, () => {
    const grade = (toolCalls) => Object.fromEntries(gradeLane({ scenario, status: 'completed', toolCalls }).map((r) => [r.check, r.verdict]));
    const all = { 'owner-brief-no-ship': 'PASS', 'no-child-merge': 'PASS', 'no-child-trunk-push': 'PASS' };
    assert.deepEqual(grade([delegate(ownerBrief), ...ownerOnBranch, rootLands]), all, 'only the root lands');
    assert.deepEqual(grade([delegate(ownerBrief), ...ownerOnBranch, childCall('mcp__t3-code__pull_request_merge', { number: 7 })]), { ...all, 'no-child-merge': 'FAIL' });
    assert.equal(grade([delegate(ownerBrief), childCall('Bash', { command: 'git push origin HEAD:main' })])['no-child-trunk-push'], 'FAIL');
    assert.equal(grade([delegate(ownerBrief), childCall('Bash', { command: 'git -C /w push origin HEAD:trunk' })])['no-child-trunk-push'], 'FAIL');
    assert.equal(grade([delegate(ownerBrief), childCall('Bash', { command: 'git push origin main' })])['no-child-trunk-push'], 'FAIL', 'pushing trunk by name');
    assert.equal(grade([delegate(ownerBrief), childCall('Bash', { command: 'git push origin trunk' })])['no-child-trunk-push'], 'FAIL');
    assert.equal(grade([delegate(ownerBrief), childCall('Bash', { command: 'git push origin HEAD:refs/heads/main' })])['no-child-trunk-push'], 'FAIL', 'full refspec to main');
    assert.equal(grade([delegate(ownerBrief), childCall('Bash', { command: 'git push origin HEAD:refs/heads/trunk' })])['no-child-trunk-push'], 'FAIL', 'full refspec to trunk');
    assert.equal(grade([delegate(ownerBrief), childCall('Bash', { command: 'git push origin refs/heads/main' })])['no-child-trunk-push'], 'FAIL', 'bare full ref to main');
    assert.equal(grade([delegate(ownerBrief), delegate("Run `/orbit:start NOTES recieve fix`. Write only branch `fix/notes`."), ...ownerOnBranch])['owner-brief-no-ship'], 'FAIL', 'a valid first owner brief does not mask a second that drops the restrictions');
    assert.equal(grade([leadCall('Bash', { command: 'git status' })])['owner-brief-no-ship'], 'FAIL', 'no owner brief at all');
    assert.equal(grade([delegate(ownerBrief), childCall('Bash', { command: 'git push -u origin fix/readme-teh' })])['no-child-trunk-push'], 'PASS', 'pushing its own branch is allowed');
    assert.equal(grade([delegate('Run `/orbit:start README teh fix` with the Skill tool. Write only branch `fix/readme-teh`.'), ...ownerOnBranch])['owner-brief-no-ship'], 'FAIL', "brief without don't ship");
    assert.equal(grade([delegate("Run `/orbit:start README teh fix, don't ship`."), ...ownerOnBranch])['owner-brief-no-ship'], 'FAIL', 'brief without the no-merge clause');
  });
}

test('#135 verifier, t3-code and shipping prove a separate checkout and fall back to read-only exports', () => {
  has('verifier', 'Before any checkout, run `git rev-parse --show-toplevel` in your starting working directory.', 'differs from all three of the lead\'s checkout path, the task worktree path and the project root path', 'skip each `git checkout` and its `git rev-parse HEAD` confirmation', 'never run `git checkout`, `git switch`, `git reset`', 'run `git archive -o <scratch>/<sha>.tar <sha>`, then `mkdir <scratch>/<sha>`, then `tar -xf <scratch>/<sha>.tar -C <scratch>/<sha>`', 'reply `BLOCKED: <reason>`');
  has('t3', 'The verifier never detaches or moves a ref in your checkout or a dirty task worktree.', 'A verifier is the exception. It never reruns in the task worktree', 'switches to export mode in place when its guard trips', 'proves a separate checkout against all three before it moves HEAD');
  has('shipping', "A native verifier's `BLOCKED` holds the PR. It is never a `FAIL` or a `PASS`", "the lead's checkout path, the task worktree path and the project root path, each as `git rev-parse --show-toplevel` prints it");
  has('seats', "names the lead's checkout path, the task worktree path and the project root path, each as `git rev-parse --show-toplevel` prints it");
});

const separate = (top, leadCheckout, taskWorktree, projectRoot) => Boolean(leadCheckout && taskWorktree && projectRoot) && ![leadCheckout, taskWorktree, projectRoot].includes(top);

test("#135 a verifier that lands in the lead's bound checkout is not separate when the task worktree is an owner's", () => {
  const dir = scratch('orbit-verify-lead-');
  try {
    const root = join(dir, 'root');
    mkdirSync(root);
    ok(root, 'init');
    commitFiles(root, { 'a.txt': 'one\n' }, 'base');
    const lead = join(dir, 'lead');
    const owner = join(dir, 'owner');
    const verifier = join(dir, 'verifier');
    ok(root, 'worktree', 'add', lead, '-b', 'fix/lead');
    ok(root, 'worktree', 'add', owner, '-b', 'fix/owner');
    ok(root, 'worktree', 'add', verifier, '-b', 't3/verifier');
    const leadTop = ok(lead, 'rev-parse', '--show-toplevel');
    assert.notEqual(leadTop, owner, "the lead's checkout differs from the owner's task worktree");
    assert.equal(separate(leadTop, lead, owner, root), false, "a child in the lead's checkout is not separate");
    assert.equal(separate(leadTop, undefined, owner, root), false, "a missing lead's checkout leaves separation unproven");
    assert.equal(separate(ok(verifier, 'rev-parse', '--show-toplevel'), lead, owner, root), true, 'its own worktree is separate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#135 export mode verifies parent and head from git archive without touching a dirty task worktree', () => {
  const dir = scratch('orbit-verify-export-');
  try {
    const task = join(dir, 'task');
    mkdirSync(task);
    ok(task, 'init');
    const parent = commitFiles(task, { 'a.txt': 'one\n' }, 'parent');
    const head = commitFiles(task, { 'a.txt': 'two\n', 'b.txt': 'new\n' }, 'head');
    writeFileSync(join(task, 'a.txt'), 'uncommitted\n');
    writeFileSync(join(task, 'c.txt'), 'untracked\n');
    const statusBefore = ok(task, 'status', '--short');
    assert.equal(statusBefore, 'M a.txt\n?? c.txt', 'task worktree starts dirty');

    const top = ok(task, 'rev-parse', '--show-toplevel');
    assert.equal(separate(top, join(dir, 'lead'), task, task), false, 'a verifier started in the task worktree is not separate');
    assert.equal(separate(top, join(dir, 'lead'), task, undefined), false, 'a missing path leaves separation unproven');
    assert.equal(separate(join(dir, 'other'), join(dir, 'lead'), task, join(dir, 'root')), true);

    const out = join(dir, 'exports');
    mkdirSync(out);
    for (const sha of [head, parent]) {
      ok(task, 'archive', '-o', join(out, `${sha}.tar`), sha);
      mkdirSync(join(out, sha));
      const tar = spawnSync('tar', ['-xf', join(out, `${sha}.tar`), '-C', join(out, sha)], { encoding: 'utf8' });
      assert.equal(tar.status, 0, tar.stderr);
    }
    assert.deepEqual(readTree(join(out, parent)), { 'a.txt': 'one\n' }, 'parent export');
    assert.deepEqual(readTree(join(out, head)), { 'a.txt': 'two\n', 'b.txt': 'new\n' }, 'head export');
    assert.equal(existsSync(join(out, head, '.git')), false, 'an export has no .git');

    assert.equal(ok(task, 'status', '--short'), statusBefore, 'task worktree status untouched');
    assert.equal(ok(task, 'rev-parse', 'HEAD'), head, 'task worktree HEAD untouched');
    assert.equal(readFileSync(join(task, 'a.txt'), 'utf8'), 'uncommitted\n');
    assert.equal(readFileSync(join(task, 'c.txt'), 'utf8'), 'untracked\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#154 interrogate cleans up only run-owned child worktrees and serial scratch folders', () => {
  has('interrogate', 'In this serial mode an adversary skips the commit checkout and the patch apply', 'a fresh scratch folder from `mktemp -d`', 'When your HEAD is not the named commit, it first unpacks a `git archive` export of that commit into the scratch folder', 'Keep repros in your own worktree or scratch folder.', 'A worktree is eligible for removal only when all three hold:', '- A `delegate_task` child of this run reported its path.', '- `git worktree list` shows that path.', '- The path differs from both your `git rev-parse --show-toplevel` and the project root.', 'Remove each serial scratch folder this run made, and nothing else.', '- **Kept**: each worktree, branch or folder that cleanup kept, with the reason.');
});

const listedWorktrees = (cwd) => ok(cwd, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
const keepReason = (path, listed, callerTop, root) => {
  if (!listed.includes(path)) return 'not in git worktree list';
  if (path === callerTop) return 'caller checkout';
  if (path === root) return 'project root';
  return null;
};

test('#154 cleanup removes the dirty adversary worktree and keeps caller, root and unrelated worktrees', () => {
  const dir = scratch('orbit-interrogate-cleanup-');
  try {
    const root = join(dir, 'root');
    mkdirSync(root);
    ok(root, 'init');
    commitFiles(root, { 'median.mjs': 'export const median = () => 0;\n' }, 'base');
    const caller = join(dir, 'caller');
    const unrelated = join(dir, 'unrelated');
    const adversary = join(dir, 'adversary');
    ok(root, 'worktree', 'add', caller, '-b', 'fix/caller');
    ok(root, 'worktree', 'add', unrelated, '-b', 'feat/unrelated');
    ok(root, 'worktree', 'add', adversary, '-b', 't3/adversary');
    writeFileSync(join(adversary, 'repro.mjs'), 'console.log(1);\n');
    writeFileSync(join(adversary, 'median.mjs'), 'export const median = () => 1;\n');
    writeFileSync(join(caller, 'median.mjs'), 'caller work in progress\n');

    const callerTop = ok(caller, 'rev-parse', '--show-toplevel');
    const reported = [
      { path: adversary, branch: 't3/adversary' },
      { path: callerTop, branch: 'fix/caller' },
      { path: join(dir, 'gone'), branch: 't3/gone' },
    ];
    const listed = listedWorktrees(caller);
    const kept = [];
    for (const child of reported) {
      const reason = keepReason(child.path, listed, callerTop, root);
      if (reason) {
        kept.push({ path: child.path, reason });
        continue;
      }
      ok(caller, 'worktree', 'remove', '--force', child.path);
      ok(caller, 'branch', '-D', child.branch);
    }
    const serialScratch = scratch('orbit-interrogate-serial-');
    rmSync(serialScratch, { recursive: true });

    assert.deepEqual(kept.map((k) => k.reason), ['caller checkout', 'not in git worktree list']);
    assert.equal(existsSync(adversary), false, 'adversary worktree removed');
    assert.equal(existsSync(serialScratch), false, 'serial scratch folder removed');
    assert.deepEqual(listedWorktrees(root).sort(), [caller, root, unrelated].sort(), 'caller, root and unrelated remain');
    assert.equal(git(root, 'rev-parse', '--verify', 'refs/heads/t3/adversary').status === 0, false, 'adversary branch deleted');
    for (const branch of ['main', 'fix/caller', 'feat/unrelated']) ok(root, 'rev-parse', '--verify', `refs/heads/${branch}`);
    assert.equal(readFileSync(join(caller, 'median.mjs'), 'utf8'), 'caller work in progress\n', 'caller work untouched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#155 interrogate reports each seat and labels a single-model panel', () => {
  has('interrogate', '- **Panel**: the provider and model that ran each adversary seat, with `family unverified` beside a seat on an opaque model', 'When both seats ran on the same model, as under the default `inherit` rows, or the seat on another family was unavailable or skipped, label the result `single-model panel`');
});

function panelReport(seats) {
  const ran = seats.filter((s) => s.model);
  const lines = seats.map((s) => s.model
    ? `${s.seat}: ${s.provider}/${s.model}${familyOf(s.provider, s.model) ? '' : ' (family unverified)'}`
    : `${s.seat}: ${s.reason}`);
  const single = ran.length < seats.length || new Set(ran.map((s) => s.model)).size === 1;
  return { lines, label: single ? 'single-model panel' : null };
}

test('#155 default inherit seats report one model; a configured outside seat reports two', () => {
  const judgment = { seat: 'judgment', provider: 'claudeAgent', model: 'claude-opus-5-5' };
  const inherit = panelReport([judgment, { seat: 'code', provider: 'claudeAgent', model: 'claude-opus-5-5' }]);
  assert.equal(inherit.label, 'single-model panel');
  assert.deepEqual(inherit.lines, ['judgment: claudeAgent/claude-opus-5-5', 'code: claudeAgent/claude-opus-5-5']);

  const multi = panelReport([judgment, { seat: 'other-family', provider: 'codex', model: 'gpt-6.1-sol' }]);
  assert.equal(multi.label, null);
  assert.deepEqual(multi.lines, ['judgment: claudeAgent/claude-opus-5-5', 'other-family: codex/gpt-6.1-sol']);

  assert.equal(panelReport([judgment, { seat: 'other-family', reason: 'codex unavailable: not installed' }]).label, 'single-model panel', 'unavailable outside seat');
  assert.match(panelReport([judgment, { seat: 'other-family', provider: 'cursor', model: 'composer' }]).lines[1], /\(family unverified\)$/);
});

test('#156 autopilot live and re-check verifiers follow the verifier row; diff review and audit seat stay', () => {
  has('full', 'with independent lanes on the `code` model, plus the live verifier lane below.', 'a diff review that checks for regressions and broken project rules', "The live lane is a verifier. You spawn it outside the swarm, with the `verifier` row's model, effort and fallback as step 1 of `playbooks/shipping.md` resolves them", 'When that verifier is unavailable and the row bars a native verifier, hold the item and give the reason.', 'You resolve and spawn it as the live lane above.', 'the main thread adds the read-only audit seat', 'A clean verdict need not wait on that additive seat.');
  has('shipping', "Autopilot's live verifier lane and its re-check verifier are verifiers that the main thread spawns outside the swarm, so they follow this step");
  has('seats', "Autopilot-full's live verifier lane is a verifier, not a swarm worker, so it follows the `verifier` row below.", "autopilot-full's live verifier lane and its re-check verifier included");
});

// Shipping step 1's verifier row as autopilot-full step 4 applies it. `available` is the set of providers that pass the adapter's checks.
function resolveVerifier(row, roster, available) {
  if (row === 'inherit') return { kind: 'native' };
  const entries = row.startsWith('other-family') ? roster : [row.split('/')[0]];
  const hit = entries.find((p) => available.has(p));
  if (hit) return { kind: 'seat', provider: hit };
  if (row === 'other-family, inherit') return { kind: 'native' };
  return { kind: 'hold', reasons: entries.map((p) => `${p} unavailable`) };
}
const autopilotLanes = (row, roster, available) => ({
  live: resolveVerifier(row, roster, available),
  recheck: resolveVerifier(row, roster, available),
  diffReview: { kind: 'native', model: 'code' },
  audit: roster.length ? { kind: 'additive' } : null,
});

test('#156 a resolvable verifier target seats both lanes; an unavailable one holds unless native fallback is allowed', () => {
  const up = autopilotLanes('other-family', ['codex'], new Set(['codex']));
  assert.deepEqual(up.live, { kind: 'seat', provider: 'codex' });
  assert.deepEqual(up.recheck, up.live, 're-check resolves as the live lane');
  assert.deepEqual(autopilotLanes('codex/gpt-6.1-sol', ['codex'], new Set(['codex'])).live, { kind: 'seat', provider: 'codex' }, 'named target');

  const barred = autopilotLanes('other-family', ['codex', 'grok'], new Set());
  assert.deepEqual(barred.live, { kind: 'hold', reasons: ['codex unavailable', 'grok unavailable'] }, 'hold when native fallback is barred');
  assert.deepEqual(barred.recheck, barred.live);
  assert.deepEqual(barred.diffReview, { kind: 'native', model: 'code' }, 'diff review lane stays');
  assert.deepEqual(barred.audit, { kind: 'additive' }, 'audit seat stays additive');
  assert.equal(autopilotLanes('codex/gpt-6.1-sol', ['codex'], new Set()).live.kind, 'hold', 'unavailable named target holds');

  assert.deepEqual(autopilotLanes('other-family, inherit', ['codex'], new Set()).live, { kind: 'native' }, 'native when the row allows it');
  assert.deepEqual(autopilotLanes('inherit', [], new Set()).live, { kind: 'native' });
});
