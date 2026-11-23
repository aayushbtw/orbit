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
import { fileURLToPath } from 'node:url';

const ORBIT_CACHE_SKILLS_RE = /(?:^|\/)\.claude\/plugins\/(?:cache|marketplaces)\/orbit(?:\/.*)?\/skills\/?$/;

function resolveHome(home) {
  return home ?? process.env.HOME ?? homedir();
}

function expandHome(inputPath, home) {
  if (inputPath === '~') return home;
  if (inputPath.startsWith('~/')) return join(home, inputPath.slice(2));
  return inputPath;
}

function normalizePath(inputPath, home) {
  return resolve(expandHome(inputPath, home));
}

function canonicalizePath(inputPath, home) {
  const resolved = normalizePath(inputPath, home);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFilteredEntry(entry) {
  const hasInclude = Array.isArray(entry.include_only) && entry.include_only.length > 0;
  const hasExclude = Array.isArray(entry.exclude) && entry.exclude.length > 0;
  return hasInclude || hasExclude;
}

function isOrbitSkillsPath(entryPath, home) {
  const resolved = normalizePath(entryPath, home);
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    const posixPath = resolved.split(sep).join('/');
    return ORBIT_CACHE_SKILLS_RE.test(posixPath);
  }

  const pluginJsonPath = join(real, '..', '.claude-plugin', 'plugin.json');
  try {
    const parsed = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
    return isPlainObject(parsed) && parsed.name === 'orbit';
  } catch {
    return false;
  }
}

function readAndClassifyConfig({ configPath, skillsDir, home }) {
  const effectiveHome = resolveHome(home);
  const resolvedConfigPath = normalizePath(configPath ?? defaultConfigPath(effectiveHome), effectiveHome);
  const resolvedSkillsDir = normalizePath(skillsDir, effectiveHome);

  let raw;
  try {
    raw = readFileSync(resolvedConfigPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return {
        status: { status: 'missing-file', configPath: resolvedConfigPath, skillsDir: resolvedSkillsDir },
        config: null,
        staleIndices: [],
        hasExactMatch: false,
      };
    }
    return {
      status: {
        status: 'invalid',
        configPath: resolvedConfigPath,
        skillsDir: resolvedSkillsDir,
        reason: err?.message ?? 'could not read file',
      },
      config: null,
      staleIndices: [],
      hasExactMatch: false,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      status: {
        status: 'invalid',
        configPath: resolvedConfigPath,
        skillsDir: resolvedSkillsDir,
        reason: `malformed JSON (${err?.message ?? 'parse error'})`,
      },
      config: null,
      staleIndices: [],
      hasExactMatch: false,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      status: {
        status: 'invalid',
        configPath: resolvedConfigPath,
        skillsDir: resolvedSkillsDir,
        reason: 'root must be a JSON object',
      },
      config: null,
      staleIndices: [],
      hasExactMatch: false,
    };
  }

  if (parsed.entries === undefined) {
    return {
      status: { status: 'unregistered', configPath: resolvedConfigPath, skillsDir: resolvedSkillsDir },
      config: parsed,
      staleIndices: [],
      hasExactMatch: false,
    };
  }

  if (!Array.isArray(parsed.entries)) {
    return {
      status: {
        status: 'invalid',
        configPath: resolvedConfigPath,
        skillsDir: resolvedSkillsDir,
        reason: '"entries" must be an array',
      },
      config: null,
      staleIndices: [],
      hasExactMatch: false,
    };
  }

  const targetCanonical = canonicalizePath(resolvedSkillsDir, effectiveHome);
  let matchedEntry = null;
  const stalePaths = [];
  const staleIndices = [];

  for (let i = 0; i < parsed.entries.length; i++) {
    const entry = parsed.entries[i];
    if (!isPlainObject(entry) || typeof entry.path !== 'string' || entry.path.trim() === '') {
      continue;
    }

    if (canonicalizePath(entry.path, effectiveHome) === targetCanonical) {
      if (!matchedEntry) matchedEntry = entry;
      continue;
    }

    if (isOrbitSkillsPath(entry.path, effectiveHome)) {
      stalePaths.push(entry.path);
      staleIndices.push(i);
    }
  }

  if (matchedEntry && stalePaths.length === 0) {
    return {
      status: {
        status: 'registered',
        configPath: resolvedConfigPath,
        skillsDir: resolvedSkillsDir,
        matchedPath: matchedEntry.path,
        filtered: isFilteredEntry(matchedEntry),
      },
      config: parsed,
      staleIndices,
      hasExactMatch: true,
    };
  }

  if (stalePaths.length > 0) {
    return {
      status: {
        status: 'stale',
        configPath: resolvedConfigPath,
        skillsDir: resolvedSkillsDir,
        stalePaths,
      },
      config: parsed,
      staleIndices,
      hasExactMatch: matchedEntry !== null,
    };
  }

  return {
    status: { status: 'unregistered', configPath: resolvedConfigPath, skillsDir: resolvedSkillsDir },
    config: parsed,
    staleIndices,
    hasExactMatch: false,
  };
}

function resolveWriteTarget(configPath) {
  try {
    if (!lstatSync(configPath).isSymbolicLink()) return configPath;
  } catch (err) {
    if (err?.code === 'ENOENT') return configPath;
    throw err;
  }

  try {
    return realpathSync(configPath);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return resolve(dirname(configPath), readlinkSync(configPath));
    }
    throw err;
  }
}

function writeConfigAtomically(configPath, config) {
  const writeTarget = resolveWriteTarget(configPath);
  const dir = dirname(writeTarget);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.skills.json.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  const content = `${JSON.stringify(config, null, 2)}\n`;

  try {
    writeFileSync(tmpPath, content, 'utf8');
    renameSync(tmpPath, writeTarget);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

export function defaultConfigPath(home) {
  return join(resolveHome(home), '.gemini', 'config', 'skills.json');
}

export function inspectSkillsConfig({ configPath, skillsDir, home }) {
  return readAndClassifyConfig({ configPath, skillsDir, home }).status;
}

export function applySkillsRegistration({ configPath, skillsDir, home }) {
  const effectiveHome = resolveHome(home);
  const resolvedSkillsDir = normalizePath(skillsDir, effectiveHome);

  let dirStat;
  try {
    dirStat = statSync(resolvedSkillsDir);
  } catch {
    throw new Error(`skills directory does not exist: ${resolvedSkillsDir}`);
  }
  if (!dirStat.isDirectory()) {
    throw new Error(`skills path is not a directory: ${resolvedSkillsDir}`);
  }

  const { status, config, staleIndices, hasExactMatch } = readAndClassifyConfig({
    configPath,
    skillsDir: resolvedSkillsDir,
    home: effectiveHome,
  });

  if (status.status === 'invalid') {
    throw new Error(`invalid Antigravity skills config at ${status.configPath}: ${status.reason}`);
  }

  if (status.status === 'registered') {
    return {
      action: 'unchanged',
      configPath: status.configPath,
      skillsDir: status.skillsDir,
      filtered: status.filtered,
    };
  }

  if (status.status === 'missing-file') {
    const next = { entries: [{ path: status.skillsDir }] };
    writeConfigAtomically(status.configPath, next);
    return {
      action: 'registered',
      configPath: status.configPath,
      skillsDir: status.skillsDir,
    };
  }

  if (status.status === 'unregistered') {
    const existingEntries = Array.isArray(config.entries) ? config.entries : [];
    const next = { ...config, entries: [...existingEntries, { path: status.skillsDir }] };
    writeConfigAtomically(status.configPath, next);
    return {
      action: 'registered',
      configPath: status.configPath,
      skillsDir: status.skillsDir,
    };
  }

  const staleSet = new Set(staleIndices);
  const firstStale = staleIndices[0];
  const nextEntries = [];

  for (let i = 0; i < config.entries.length; i++) {
    if (!staleSet.has(i)) {
      nextEntries.push(config.entries[i]);
      continue;
    }
    if (!hasExactMatch && i === firstStale) {
      nextEntries.push({ ...config.entries[i], path: status.skillsDir });
    }
  }

  const next = { ...config, entries: nextEntries };
  writeConfigAtomically(status.configPath, next);
  return {
    action: 'updated',
    configPath: status.configPath,
    skillsDir: status.skillsDir,
    stalePaths: status.stalePaths,
  };
}

export function formatCheckStatus(result) {
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
    default:
      throw new Error(`unknown status: ${result.status}`);
  }
}

function formatApplyResult(result) {
  switch (result.action) {
    case 'unchanged':
      return result.filtered
        ? `unchanged (${result.skillsDir} in ${result.configPath}, filtered)`
        : `unchanged (${result.skillsDir} in ${result.configPath})`;
    case 'updated':
      return `updated (${result.stalePaths.join(', ')} -> ${result.skillsDir} in ${result.configPath})`;
    case 'registered':
      return `registered (${result.skillsDir} in ${result.configPath})`;
    default:
      throw new Error(`unknown action: ${result.action}`);
  }
}

function parseArgs(argv) {
  let mode = null;
  let skillsDir = null;
  let configPath = undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check' || arg === '--apply') {
      if (mode) throw new Error('specify only one of --check or --apply');
      mode = arg.slice(2);
    } else if (arg === '--skills-dir') {
      skillsDir = argv[++i];
      if (!skillsDir) throw new Error('--skills-dir requires a value');
    } else if (arg === '--config') {
      configPath = argv[++i];
      if (!configPath) throw new Error('--config requires a value');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!mode) throw new Error('missing required flag: --check or --apply');
  if (!skillsDir) throw new Error('missing required flag: --skills-dir <dir>');
  return { mode, skillsDir, configPath };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isMainModule()) {
  try {
    const { mode, skillsDir, configPath } = parseArgs(process.argv.slice(2));
    if (mode === 'check') {
      const result = inspectSkillsConfig({ configPath, skillsDir });
      console.log(formatCheckStatus(result));
    } else {
      const result = applySkillsRegistration({ configPath, skillsDir });
      console.log(formatApplyResult(result));
    }
  } catch (err) {
    console.error(err?.message ?? String(err));
    process.exit(1);
  }
}
