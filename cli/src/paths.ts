import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface OrbitPaths {
  orbitDir: string;
  releasesDir: string;
  releaseDir: (version: string) => string;
  releasePluginDir: (version: string) => string;
  currentLink: string;
  currentPluginDir: string;
  currentSkillsDir: string;
  configPath: string;
  capabilitiesPath: string;
  stateDir: string;
  legacyModelsPath: string;
  legacyClaudeModelsPath: string;
}

/** Return canonical on-disk paths under the user's home directory. */
export function orbitPaths(home: string): OrbitPaths {
  const orbitDir = join(home, '.config', 'orbit');
  const releasesDir = join(orbitDir, 'releases');
  const currentLink = join(orbitDir, 'current');
  const currentPluginDir = join(currentLink, 'plugin');
  return {
    orbitDir,
    releasesDir,
    releaseDir: (version: string) => join(releasesDir, version),
    releasePluginDir: (version: string) => join(releasesDir, version, 'plugin'),
    currentLink,
    currentPluginDir,
    currentSkillsDir: join(currentPluginDir, 'skills'),
    configPath: join(orbitDir, 'config.json'),
    capabilitiesPath: join(orbitDir, 'capabilities.json'),
    stateDir: join(orbitDir, 'state'),
    legacyModelsPath: join(orbitDir, 'models.md'),
    legacyClaudeModelsPath: join(home, '.claude', 'rules', 'orbit-models.md'),
  };
}

/** Read a UTF-8 file when it exists, returning undefined on ENOENT. */
export function readOptional(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Write a file atomically via a same-directory temp file and rename. */
export function writeFileAtomic(filePath: string, content: string, mode = 0o600): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    writeFileSync(temp, content, { encoding: 'utf8', mode });
    renameSync(temp, filePath);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Run fn while holding an exclusive directory lock at lockPath. */
export function withLock<T>(lockPath: string, label: string, fn: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Another ${label} update is in progress at ${lockPath}.`);
    }
    throw error;
  }
  try {
    return fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

/** Return the git repository root for cwd, or resolved cwd when outside git. */
export function projectRoot(cwd = process.cwd()): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return resolve(cwd);
  }
}
