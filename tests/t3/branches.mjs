import { execFileSync } from 'node:child_process';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (dir, args) => { try { return git(dir, args); } catch { return null; } };

export const listBranches = (dir) => new Map(git(dir, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'])
  .split('\n').filter(Boolean).map((line) => line.split(' ')));

// Git on a case-insensitive disk resolves refs/heads/Main to the file of refs/heads/main.
export const clash = (branches, ref) => [...branches.keys()].find((r) => r.toLowerCase() === ref.toLowerCase());

export function deleteLaneBranches(dir, { before, createdAt, refs }) {
  const now = listBranches(dir);
  for (const ref of new Set(refs)) {
    const sha = ref?.startsWith('refs/heads/') && now.get(ref);
    if (!sha || clash(before, ref)) continue;
    const born = (tryGit(dir, ['reflog', 'show', '--format=%H', ref, '--']) || sha).split('\n').at(-1);
    if (born !== createdAt) continue;
    tryGit(dir, ['update-ref', '--no-deref', '-d', ref, sha]);
  }
}
