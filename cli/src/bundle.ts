import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { orbitPaths, readOptional } from './paths.js';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/;

export interface BundleInspection {
  packagedVersion: string;
  currentLink: string;
  currentTarget: string | null;
  currentRealPath: string | null;
  activeVersion: string | null;
  linked: boolean;
  installed: boolean;
  releases: string[];
  pluginDir: string;
  skillsDir: string;
}

export type ExecRunner = (cmd: string, args: string[]) => string;

const defaultExec: ExecRunner = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function parseSemver(version: string) {
  const match = version.match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** Compare two semantic versions (< 0, 0, or > 0). */
export function semverCompare(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key];
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const limit = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < limit; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
    } else if (x !== y) {
      return x.localeCompare(y);
    }
  }
  return 0;
}

/** Read and validate an Orbit plugin manifest version from pluginDir. */
export function readPluginVersion(pluginDir: string): string {
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
  const raw = readOptional(manifestPath);
  if (raw === undefined) throw new Error(`Missing plugin manifest at ${manifestPath}.`);
  const parsed = JSON.parse(raw) as { name?: string; version?: string };
  if (parsed.name !== 'orbit' || typeof parsed.version !== 'string' || !SEMVER_RE.test(parsed.version)) {
    throw new Error(`Invalid Orbit plugin manifest at ${manifestPath}.`);
  }
  return parsed.version;
}

function writeMarketplaceManifest(releaseRoot: string): void {
  const manifestPath = join(releaseRoot, '.claude-plugin', 'marketplace.json');
  if (existsSync(manifestPath)) return;
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      name: 'orbit',
      owner: { name: 'Aayush', url: 'https://github.com/aayushbtw' },
      description: 'Name the goal. Orbit ships it.',
      plugins: [
        {
          name: 'orbit',
          source: './plugin',
          description: 'Name the goal. Orbit ships it.',
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
}

function isUnderDir(childPath: string, parentDir: string): boolean {
  const rel = relative(parentDir, childPath);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Stage bundleDir into ~/.config/orbit/releases/<version>/plugin atomically. */
export function stageRelease(bundleDir: string, home: string, version: string): string {
  const paths = orbitPaths(home);
  const releaseRoot = paths.releaseDir(version);
  const pluginDest = paths.releasePluginDir(version);
  if (existsSync(join(pluginDest, 'skills', 'start', 'SKILL.md'))) {
    writeMarketplaceManifest(releaseRoot);
    return releaseRoot;
  }

  mkdirSync(paths.releasesDir, { recursive: true });
  const stage = mkdtempSync(join(paths.releasesDir, '.stage-'));
  try {
    cpSync(bundleDir, join(stage, 'plugin'), { recursive: true });
    writeMarketplaceManifest(stage);
    try {
      renameSync(stage, releaseRoot);
    } catch (error) {
      if (!existsSync(join(pluginDest, 'skills', 'start', 'SKILL.md'))) throw error;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return releaseRoot;
}

/** Atomically repoint ~/.config/orbit/current to targetDir. */
export function pointCurrent(targetDir: string, home: string): void {
  const paths = orbitPaths(home);
  mkdirSync(paths.orbitDir, { recursive: true });
  try {
    const stat = lstatSync(paths.currentLink);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-symlink directory at ${paths.currentLink}.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const tempLink = join(paths.orbitDir, `.current-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    symlinkSync(targetDir, tempLink);
    renameSync(tempLink, paths.currentLink);
  } catch (error) {
    rmSync(tempLink, { force: true });
    throw error;
  }
}

/** Stage a release bundle and switch ~/.config/orbit/current to it. */
export function installBundle(bundleDir: string, home: string, version: string): { releaseRoot: string; currentLink: string } {
  const paths = orbitPaths(home);
  const releaseRoot = stageRelease(bundleDir, home, version);
  pointCurrent(releaseRoot, home);
  return { releaseRoot, currentLink: paths.currentLink };
}

/** List valid installed releases under ~/.config/orbit/releases, newest first. */
export function listReleases(home: string): string[] {
  const paths = orbitPaths(home);
  if (!existsSync(paths.releasesDir)) return [];
  const entries = readdirSync(paths.releasesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && SEMVER_RE.test(entry.name))
    .filter((entry) => existsSync(join(paths.releasePluginDir(entry.name), 'skills', 'start', 'SKILL.md')))
    .map((entry) => entry.name)
    .sort((a, b) => semverCompare(b, a));
}

/** Inspect ~/.config/orbit/current and installed releases. */
export function inspectBundle(home: string, packagedVersion: string): BundleInspection {
  const paths = orbitPaths(home);
  const releases = listReleases(home);
  let currentTarget: string | null = null;
  let currentRealPath: string | null = null;
  let isSymlink = false;

  try {
    const stat = lstatSync(paths.currentLink);
    isSymlink = stat.isSymbolicLink();
    currentTarget = isSymlink ? readlinkSync(paths.currentLink) : paths.currentLink;
    currentRealPath = realpathSync(paths.currentLink);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  let canonicalReleases = paths.releasesDir;
  try {
    canonicalReleases = realpathSync(paths.releasesDir);
  } catch {}

  const resolvedTarget = currentRealPath ?? (currentTarget ? resolve(paths.orbitDir, currentTarget) : null);
  const linked = Boolean(
    resolvedTarget && !isUnderDir(resolvedTarget, paths.releasesDir) && !isUnderDir(resolvedTarget, canonicalReleases),
  );

  let activeVersion: string | null = null;
  if (existsSync(join(paths.currentPluginDir, '.claude-plugin', 'plugin.json'))) {
    try {
      activeVersion = readPluginVersion(paths.currentPluginDir);
    } catch {
      activeVersion = null;
    }
  }

  const installed = existsSync(join(paths.currentSkillsDir, 'start', 'SKILL.md'));
  return {
    packagedVersion,
    currentLink: paths.currentLink,
    currentTarget,
    currentRealPath,
    activeVersion,
    linked,
    installed,
    releases,
    pluginDir: paths.currentPluginDir,
    skillsDir: paths.currentSkillsDir,
  };
}

/** Switch ~/.config/orbit/current to a previously staged release version. */
export function useRelease(home: string, version: string): { version: string; currentLink: string } {
  const paths = orbitPaths(home);
  const releaseRoot = paths.releaseDir(version);
  if (!existsSync(join(paths.releasePluginDir(version), 'skills', 'start', 'SKILL.md'))) {
    throw new Error(`Orbit release ${version} is not installed under ${paths.releasesDir}.`);
  }
  pointCurrent(releaseRoot, home);
  return { version, currentLink: paths.currentLink };
}

/** Point ~/.config/orbit/current at a local Orbit repository checkout. */
export function linkCheckout(home: string, repoPath: string): { repoPath: string; version: string; currentLink: string } {
  const resolved = resolve(repoPath);
  const pluginDir = join(resolved, 'plugin');
  const version = readPluginVersion(pluginDir);
  if (!existsSync(join(pluginDir, 'skills', 'start', 'SKILL.md'))) {
    throw new Error(`Directory ${resolved} does not contain plugin/skills/start/SKILL.md.`);
  }
  const paths = orbitPaths(home);
  pointCurrent(resolved, home);
  return { repoPath: resolved, version, currentLink: paths.currentLink };
}

/** Restore ~/.config/orbit/current to an installed release or remove the link. */
export function unlinkCheckout(home: string, packagedVersion: string, fallbackVersion?: string): { unlinked: boolean; activeVersion: string | null } {
  const inspection = inspectBundle(home, packagedVersion);
  if (!inspection.linked) {
    return { unlinked: false, activeVersion: inspection.activeVersion };
  }
  const fallback = fallbackVersion ?? inspection.releases[0];
  if (fallback) {
    useRelease(home, fallback);
    return { unlinked: true, activeVersion: fallback };
  }
  const paths = orbitPaths(home);
  try {
    if (lstatSync(paths.currentLink).isSymbolicLink()) unlinkSync(paths.currentLink);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { unlinked: true, activeVersion: null };
}

/** Remove older staged releases while keeping the newest `keep` versions and the active release. */
export function pruneReleases(home: string, keep = 3): string[] {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be an integer >= 1.');
  const paths = orbitPaths(home);
  const releases = listReleases(home);
  const kept = new Set(releases.slice(0, keep));
  try {
    const activeReal = realpathSync(paths.currentLink);
    for (const version of releases) {
      if (realpathSync(paths.releaseDir(version)) === activeReal) kept.add(version);
    }
  } catch {}

  const removed: string[] = [];
  for (const version of releases) {
    if (kept.has(version)) continue;
    rmSync(paths.releaseDir(version), { recursive: true, force: true });
    removed.push(version);
  }
  return removed;
}

/** Remove Orbit releases and symlink, optionally purging config, catalog, and state. */
export function uninstallBundle(home: string, options: { purge?: boolean } = {}): { removedCurrent: boolean; removedReleases: boolean; purged: boolean } {
  const paths = orbitPaths(home);
  let removedCurrent = false;
  try {
    const stat = lstatSync(paths.currentLink);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to remove non-symlink at ${paths.currentLink}.`);
    }
    unlinkSync(paths.currentLink);
    removedCurrent = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const removedReleases = existsSync(paths.releasesDir);
  if (removedReleases) {
    rmSync(paths.releasesDir, { recursive: true, force: true });
  }

  const purged = Boolean(options.purge);
  if (purged) {
    for (const target of [paths.configPath, paths.capabilitiesPath, paths.legacyModelsPath, paths.stateDir]) {
      rmSync(target, { recursive: true, force: true });
    }
  }
  return { removedCurrent, removedReleases, purged };
}

/** Query npm for the latest published @aayushbtw/orbit version. */
export function checkNpmUpdate(
  currentVersion: string,
  pkgName = '@aayushbtw/orbit',
  exec: ExecRunner = defaultExec,
): { currentVersion: string; latestVersion: string; updateAvailable: boolean } {
  const raw = exec('npm', ['view', pkgName, 'version']);
  const latestVersion = raw.trim().replace(/^v/, '');
  if (!SEMVER_RE.test(latestVersion)) {
    throw new Error(`Unexpected npm version response for ${pkgName}: ${raw}`);
  }
  return {
    currentVersion,
    latestVersion,
    updateAvailable: semverCompare(latestVersion, currentVersion) > 0,
  };
}

/** Install a target npm package version globally. */
export function applyNpmUpdate(
  targetVersion: string,
  pkgName = '@aayushbtw/orbit',
  exec: ExecRunner = defaultExec,
): void {
  const spec = targetVersion === 'latest' ? pkgName : `${pkgName}@${targetVersion}`;
  exec('npm', ['install', '-g', spec]);
}
