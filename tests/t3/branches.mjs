import { execFileSync } from 'node:child_process';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (dir, args) => { try { return git(dir, args); } catch { return null; } };

export const listBranches = (dir) => new Map(git(dir, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'])
  .split('\n').filter(Boolean).map((line) => line.split(' ')));

// Git on a case-insensitive disk resolves refs/heads/Main to the file of refs/heads/main.
export const clash = (branches, ref) => [...branches.keys()].find((r) => r.toLowerCase() === ref.toLowerCase());

export const isAncestor = (dir, older, newer) => tryGit(dir, ['merge-base', '--is-ancestor', older, newer]) !== null;

export function laneBranches(dir, { before, createdAt }) {
  return [...listBranches(dir)].flatMap(([ref, tip]) => {
    if (clash(before, ref)) return [];
    const log = (tryGit(dir, ['reflog', 'show', '--format=%H %gs', ref, '--']) || tip).split('\n');
    const born = log.at(-1).split(' ')[0];
    const renamedFrom = log.flatMap((entry) => entry.match(/renamed (refs\/heads\/\S+) to /)?.[1] ?? []);
    return isAncestor(dir, createdAt, born) ? [{ ref, tip, born, renamedFrom }] : [];
  });
}

export function deleteLaneBranches(dir, lane) {
  for (const { ref, tip } of laneBranches(dir, lane)) tryGit(dir, ['update-ref', '--no-deref', '-d', ref, tip]);
}

export const listWorktrees = (dir) => (tryGit(dir, ['worktree', 'list', '--porcelain']) ?? '').split('\n\n').filter(Boolean).map((block) => {
  const lines = block.split('\n');
  const field = (key) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1) ?? null;
  return { path: field('worktree'), head: field('HEAD'), branch: field('branch') };
});
