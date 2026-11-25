import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

const ORBIT_CACHE_SKILLS_RE = /(?:^|\/)\.claude\/plugins\/(?:cache|marketplaces)\/orbit(?:\/.*)?\/skills\/?$/;

export type SkillsConfigStatus =
  | { status: 'missing-file'; configPath: string; skillsDir: string }
  | { status: 'unregistered'; configPath: string; skillsDir: string }
  | { status: 'registered'; configPath: string; skillsDir: string; matchedPath: string; filtered: boolean }
  | { status: 'stale'; configPath: string; skillsDir: string; stalePaths: string[] }
  | { status: 'invalid'; configPath: string; skillsDir: string; reason: string };

export interface ApplyResult {
  action: 'unchanged' | 'registered' | 'updated';
  configPath: string;
  skillsDir: string;
  filtered?: boolean;
  stalePaths?: string[];
}

export interface RemoveResult {
  action: 'unchanged' | 'removed';
  configPath: string;
  removedPaths: string[];
}

interface SkillsEntry {
  path?: unknown;
  include_only?: unknown;
  exclude?: unknown;
  [key: string]: unknown;
}

interface SkillsConfig {
  entries?: unknown;
  [key: string]: unknown;
}

interface Classified {
  status: SkillsConfigStatus;
  config: SkillsConfig | null;
  staleIndices: number[];
  hasExactMatch: boolean;
}

function resolveHome(home?: string): string {
  return home ?? process.env.HOME ?? homedir();
}

function expandHome(inputPath: string, home: string): string {
  if (inputPath === '~') return home;
  if (inputPath.startsWith('~/')) return join(home, inputPath.slice(2));
  return inputPath;
}

function normalizePath(inputPath: string, home: string): string {
  return resolve(expandHome(inputPath, home));
}

function canonicalizePath(inputPath: string, home: string): string {
  const resolved = normalizePath(inputPath, home);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isFilteredEntry(entry: SkillsEntry): boolean {
  const hasInclude = Array.isArray(entry.include_only) && entry.include_only.length > 0;
  const hasExclude = Array.isArray(entry.exclude) && entry.exclude.length > 0;
  return hasInclude || hasExclude;
}

function isOrbitSkillsPath(entryPath: string, home: string): boolean {
  const resolved = normalizePath(entryPath, home);
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    const posixPath = resolved.split(sep).join('/');
    const managedReleases = join(home, '.config', 'orbit', 'releases').split(sep).join('/');
    const managedCurrent = join(home, '.config', 'orbit', 'current', 'plugin', 'skills').split(sep).join('/');
    const realManagedCurrent = join(canonicalizePath(home, home), '.config', 'orbit', 'current', 'plugin', 'skills')
      .split(sep)
      .join('/');
    const releasePath = posixPath.slice(managedReleases.length);
    return ORBIT_CACHE_SKILLS_RE.test(posixPath)
      || posixPath === managedCurrent
      || posixPath === realManagedCurrent
      || (posixPath.startsWith(`${managedReleases}/`) && /^\/[^/]+\/plugin\/skills$/.test(releasePath));
  }

  return isOrbitManifest(join(real, '..', 'manifest.json')) || isOrbitManifest(join(real, '..', '.claude-plugin', 'plugin.json'));
}

function isOrbitManifest(path: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isPlainObject(parsed) && parsed.name === 'orbit';
  } catch {
    return false;
  }
}

function entryPath(entry: unknown): string | undefined {
  return isPlainObject(entry) && typeof entry.path === 'string' && entry.path.trim() !== '' ? entry.path : undefined;
}

function readAndClassifyConfig(opts: { configPath?: string; skillsDir: string; home?: string }): Classified {
  const home = resolveHome(opts.home);
  const configPath = normalizePath(opts.configPath ?? defaultConfigPath(home), home);
  const skillsDir = normalizePath(opts.skillsDir, home);
  const invalid = (reason: string): Classified => ({
    status: { status: 'invalid', configPath, skillsDir, reason },
    config: null,
    staleIndices: [],
    hasExactMatch: false,
  });

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: { status: 'missing-file', configPath, skillsDir }, config: null, staleIndices: [], hasExactMatch: false };
    }
    return invalid(errorMessage(error, 'could not read file'));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return invalid(`malformed JSON (${errorMessage(error, 'parse error')})`);
  }
  if (!isPlainObject(parsed)) return invalid('root must be a JSON object');
  const config = parsed as SkillsConfig;
  if (config.entries === undefined) {
    return { status: { status: 'unregistered', configPath, skillsDir }, config, staleIndices: [], hasExactMatch: false };
  }
  if (!Array.isArray(config.entries)) return invalid('"entries" must be an array');

  const targetCanonical = canonicalizePath(skillsDir, home);
  let matchedEntry: SkillsEntry | null = null;
  const stalePaths: string[] = [];
  const staleIndices: number[] = [];
  config.entries.forEach((entry: unknown, i: number) => {
    const path = entryPath(entry);
    if (path === undefined) return;
    if (canonicalizePath(path, home) === targetCanonical) {
      matchedEntry ??= entry as SkillsEntry;
      return;
    }
    if (isOrbitSkillsPath(path, home)) {
      stalePaths.push(path);
      staleIndices.push(i);
    }
  });

  const matched = matchedEntry as SkillsEntry | null;
  if (matched && stalePaths.length === 0) {
    return {
      status: { status: 'registered', configPath, skillsDir, matchedPath: matched.path as string, filtered: isFilteredEntry(matched) },
      config,
      staleIndices,
      hasExactMatch: true,
    };
  }
  if (stalePaths.length > 0) {
    return { status: { status: 'stale', configPath, skillsDir, stalePaths }, config, staleIndices, hasExactMatch: matched !== null };
  }
  return { status: { status: 'unregistered', configPath, skillsDir }, config, staleIndices, hasExactMatch: false };
}

function resolveWriteTarget(configPath: string): string {
  try {
    if (!lstatSync(configPath).isSymbolicLink()) return configPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return configPath;
    throw error;
  }
  try {
    return realpathSync(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(dirname(configPath), readlinkSync(configPath));
    throw error;
  }
}

function writeConfigAtomically(configPath: string, config: SkillsConfig): void {
  const writeTarget = resolveWriteTarget(configPath);
  const dir = dirname(writeTarget);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.skills.json.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, writeTarget);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    throw error;
  }
}

/** Antigravity's user skills registry path. */
export function defaultConfigPath(home?: string): string {
  return join(resolveHome(home), '.gemini', 'config', 'skills.json');
}

/** Classify the Antigravity skills registry against skillsDir without writing. */
export function inspectSkillsConfig(opts: { configPath?: string; skillsDir: string; home?: string }): SkillsConfigStatus {
  return readAndClassifyConfig(opts).status;
}

/** Register skillsDir, replacing stale orbit entries in place and keeping their filters. */
export function applySkillsRegistration(opts: { configPath?: string; skillsDir: string; home?: string }): ApplyResult {
  const home = resolveHome(opts.home);
  const skillsDir = normalizePath(opts.skillsDir, home);
  let isDir: boolean;
  try {
    isDir = statSync(skillsDir).isDirectory();
  } catch {
    throw new Error(`skills directory does not exist: ${skillsDir}`);
  }
  if (!isDir) throw new Error(`skills path is not a directory: ${skillsDir}`);

  const { status, config, staleIndices, hasExactMatch } = readAndClassifyConfig({ configPath: opts.configPath, skillsDir, home });
  switch (status.status) {
    case 'invalid':
      throw new Error(`invalid Antigravity skills config at ${status.configPath}: ${status.reason}`);
    case 'registered':
      return { action: 'unchanged', configPath: status.configPath, skillsDir: status.skillsDir, filtered: status.filtered };
    case 'missing-file':
      writeConfigAtomically(status.configPath, { entries: [{ path: status.skillsDir }] });
      return { action: 'registered', configPath: status.configPath, skillsDir: status.skillsDir };
    case 'unregistered': {
      const existing = Array.isArray(config!.entries) ? config!.entries : [];
      writeConfigAtomically(status.configPath, { ...config, entries: [...existing, { path: status.skillsDir }] });
      return { action: 'registered', configPath: status.configPath, skillsDir: status.skillsDir };
    }
    case 'stale': {
      const entries = config!.entries as unknown[];
      const staleSet = new Set(staleIndices);
      const nextEntries: unknown[] = [];
      entries.forEach((entry, i) => {
        if (!staleSet.has(i)) nextEntries.push(entry);
        else if (!hasExactMatch && i === staleIndices[0]) nextEntries.push({ ...(entry as SkillsEntry), path: status.skillsDir });
      });
      writeConfigAtomically(status.configPath, { ...config, entries: nextEntries });
      return { action: 'updated', configPath: status.configPath, skillsDir: status.skillsDir, stalePaths: status.stalePaths };
    }
  }
}

/** Drop every orbit skills entry from the registry, keeping all other entries and keys. */
export function removeSkillsRegistration(opts: { configPath?: string; home?: string } = {}): RemoveResult {
  const home = resolveHome(opts.home);
  const configPath = normalizePath(opts.configPath ?? defaultConfigPath(home), home);
  const unchanged: RemoveResult = { action: 'unchanged', configPath, removedPaths: [] };

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return unchanged;
    throw new Error(`could not read Antigravity skills config at ${configPath}: ${errorMessage(error, 'read error')}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid Antigravity skills config at ${configPath}: malformed JSON (${errorMessage(error, 'parse error')})`);
  }
  if (!isPlainObject(parsed)) throw new Error(`invalid Antigravity skills config at ${configPath}: root must be a JSON object`);
  if (parsed.entries === undefined) return unchanged;
  if (!Array.isArray(parsed.entries)) throw new Error(`invalid Antigravity skills config at ${configPath}: "entries" must be an array`);

  const removedPaths: string[] = [];
  const nextEntries = parsed.entries.filter((entry: unknown) => {
    const path = entryPath(entry);
    if (path !== undefined && isOrbitSkillsPath(path, home)) {
      removedPaths.push(path);
      return false;
    }
    return true;
  });
  if (removedPaths.length === 0) return unchanged;
  writeConfigAtomically(configPath, { ...parsed, entries: nextEntries });
  return { action: 'removed', configPath, removedPaths };
}

/** One-line human summary of an inspection result. */
export function formatCheckStatus(result: SkillsConfigStatus): string {
  switch (result.status) {
    case 'missing-file':
      return `not registered (${result.skillsDir} not in ${result.configPath}, file missing)`;
    case 'unregistered':
      return `not registered (${result.skillsDir} not in ${result.configPath})`;
    case 'registered':
      return result.filtered
        ? `registered (${result.matchedPath} in ${result.configPath}, filtered)`
        : `registered (${result.matchedPath} in ${result.configPath})`;
    case 'stale':
      return `stale (${result.stalePaths.join(', ')} -> ${result.skillsDir} in ${result.configPath})`;
    case 'invalid':
      return `invalid (${result.configPath}: ${result.reason})`;
  }
}
