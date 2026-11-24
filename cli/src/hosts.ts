import { execFileSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import * as antigravity from './antigravity.js';
import { orbitPaths, readOptional } from './paths.js';

export const HOST_IDS = ['antigravity', 'codex', 'agents', 'claude', 'grok'] as const;
export type HostId = (typeof HOST_IDS)[number];

/** `external` marks an orbit install the user manages outside ~/.config/orbit, which the CLI never touches. */
export type HostStatus = 'registered' | 'unregistered' | 'missing-file' | 'stale' | 'invalid' | 'external';

export interface HostInspection {
  host: HostId;
  displayName: string;
  detected: boolean;
  status: HostStatus;
  path: string;
  detail: string;
  filtered?: boolean;
  stalePaths?: string[];
}

export interface HostApplyResult {
  host: HostId;
  action: 'registered' | 'updated' | 'unchanged' | 'manual' | 'skipped';
  path: string;
  detail: string;
  command?: string;
}

export interface HostRemoveResult {
  host: HostId;
  action: 'removed' | 'unchanged' | 'skipped' | 'manual';
  path: string;
  detail: string;
  command?: string;
}

export type HostExecRunner = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => string;

export interface HostContext {
  home: string;
  env?: NodeJS.ProcessEnv;
  pluginDir: string;
  skillsDir: string;
  currentLink: string;
  version: string;
  exec?: HostExecRunner;
}

const DISPLAY_NAMES: Record<HostId, string> = {
  antigravity: 'Antigravity',
  codex: 'Codex',
  agents: 'Agent Skills (~/.agents)',
  claude: 'Claude Code',
  grok: 'Grok',
};

const defaultExec: HostExecRunner = (cmd, args, env) =>
  execFileSync(cmd, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Check whether a binary exists and is executable on PATH without spawning a shell. */
export function isExecutableOnPath(binary: string, envPath?: string): boolean {
  if (!envPath) return false;
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

/** Validate and normalize a list of host IDs. */
export function parseHostId(raw: string): HostId {
  const value = raw.trim().toLowerCase() as HostId;
  if (!HOST_IDS.includes(value)) {
    throw new Error(`Unknown host "${raw}". Choose from: ${HOST_IDS.join(', ')}.`);
  }
  return value;
}

function safeRealpath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return resolve(target);
  }
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isOrbitManaged(location: string, home: string): boolean {
  const { orbitDir } = orbitPaths(home);
  return isWithin(resolve(location), orbitDir) || isWithin(safeRealpath(location), safeRealpath(orbitDir));
}

function externalInspection(host: 'claude' | 'grok', detected: boolean, location: string): HostInspection {
  return {
    host,
    displayName: DISPLAY_NAMES[host],
    detected,
    status: 'external',
    path: location,
    detail: `externally managed at ${location} (Orbit CLI leaves it alone)`,
  };
}

function externalError(inspection: HostInspection): Error {
  return new Error(
    `${inspection.displayName} loads orbit from ${inspection.path}, which Orbit CLI does not manage. `
    + `Orbit CLI leaves it alone. Remove that install with ${inspection.host}'s own plugin command to let Orbit CLI register ${inspection.host}.`,
  );
}

function looksLikeOrbitSkills(targetPath: string): boolean {
  const posix = targetPath.replace(/\\/g, '/');
  if (/(?:^|\/)\.config\/orbit\/(?:current|releases\/[^/]+)\/plugin\/skills\/?$/.test(posix)) return true;
  if (/(?:^|\/)\.claude\/plugins\/(?:cache|marketplaces)\/orbit(?:\/.*)?\/skills\/?$/.test(posix)) return true;
  const manifestPath = join(safeRealpath(targetPath), '..', '.claude-plugin', 'plugin.json');
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
    return parsed.name === 'orbit';
  } catch {
    return false;
  }
}

function inspectSymlinkHost(host: 'codex' | 'agents', linkPath: string, detected: boolean, ctx: HostContext): HostInspection {
  const displayName = DISPLAY_NAMES[host];
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) {
      return {
        host,
        displayName,
        detected,
        status: 'invalid',
        path: linkPath,
        detail: `non-symlink entry exists at ${linkPath}`,
      };
    }
    const rawTarget = readlinkSync(linkPath);
    const resolvedTarget = isAbsolute(rawTarget) ? rawTarget : resolve(dirname(linkPath), rawTarget);
    if (resolvedTarget === ctx.skillsDir || safeRealpath(linkPath) === safeRealpath(ctx.skillsDir)) {
      return {
        host,
        displayName,
        detected,
        status: 'registered',
        path: linkPath,
        detail: `registered (${linkPath} -> ${rawTarget})`,
      };
    }
    if (looksLikeOrbitSkills(resolvedTarget)) {
      return {
        host,
        displayName,
        detected,
        status: 'stale',
        path: linkPath,
        stalePaths: [rawTarget],
        detail: `stale (${rawTarget} -> ${ctx.skillsDir})`,
      };
    }
    return {
      host,
      displayName,
      detected,
      status: 'invalid',
      path: linkPath,
      detail: `symlink points to non-orbit directory (${rawTarget})`,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        host,
        displayName,
        detected,
        status: 'unregistered',
        path: linkPath,
        detail: `not registered (${linkPath} missing)`,
      };
    }
    throw error;
  }
}

function applySymlinkHost(host: 'codex' | 'agents', linkPath: string, detected: boolean, ctx: HostContext): HostApplyResult {
  const current = inspectSymlinkHost(host, linkPath, detected, ctx);
  if (current.status === 'invalid') {
    throw new Error(`${DISPLAY_NAMES[host]} skill path is invalid: ${current.detail}`);
  }
  if (current.status === 'registered') {
    return { host, action: 'unchanged', path: linkPath, detail: current.detail };
  }
  mkdirSync(dirname(linkPath), { recursive: true });
  const tempLink = join(dirname(linkPath), `.orbit-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    symlinkSync(ctx.skillsDir, tempLink);
    renameSync(tempLink, linkPath);
  } catch (error) {
    rmSync(tempLink, { force: true });
    throw error;
  }
  return {
    host,
    action: current.status === 'stale' ? 'updated' : 'registered',
    path: linkPath,
    detail: `${current.status === 'stale' ? 'updated' : 'registered'} (${linkPath} -> ${ctx.skillsDir})`,
  };
}

function removeSymlinkHost(host: 'codex' | 'agents', linkPath: string, detected: boolean, ctx: HostContext): HostRemoveResult {
  const current = inspectSymlinkHost(host, linkPath, detected, ctx);
  if (current.status === 'unregistered') {
    return { host, action: 'unchanged', path: linkPath, detail: 'not registered' };
  }
  if (current.status === 'invalid') {
    return { host, action: 'skipped', path: linkPath, detail: current.detail };
  }
  unlinkSync(linkPath);
  return { host, action: 'removed', path: linkPath, detail: `removed symlink ${linkPath}` };
}

function inspectClaude(ctx: HostContext): HostInspection {
  const env = ctx.env ?? process.env;
  const claudeDir = join(ctx.home, '.claude');
  const pluginsFile = join(claudeDir, 'plugins', 'installed_plugins.json');
  const marketplacesFile = join(claudeDir, 'plugins', 'known_marketplaces.json');
  const detected = existsSync(claudeDir) || isExecutableOnPath('claude', env.PATH);

  let markets: Record<string, { installLocation?: string }> = {};
  const rawMarkets = readOptional(marketplacesFile);
  if (rawMarkets !== undefined) {
    try {
      markets = JSON.parse(rawMarkets) as Record<string, { installLocation?: string }>;
    } catch {}
  }
  const externalLocation = (marketName: string) => {
    const location = markets[marketName]?.installLocation;
    return location && !isOrbitManaged(location, ctx.home) ? location : undefined;
  };

  const rawPlugins = readOptional(pluginsFile);
  if (rawPlugins === undefined) {
    const location = externalLocation('orbit');
    if (location) return externalInspection('claude', detected, location);
    return {
      host: 'claude',
      displayName: DISPLAY_NAMES.claude,
      detected,
      status: 'missing-file',
      path: pluginsFile,
      detail: `not registered (${pluginsFile} missing)`,
    };
  }
  let parsedPlugins: { plugins?: Record<string, Array<{ scope?: string; version?: string; installPath?: string }> | { scope?: string; version?: string; installPath?: string }> };
  try {
    parsedPlugins = JSON.parse(rawPlugins);
  } catch {
    return {
      host: 'claude',
      displayName: DISPLAY_NAMES.claude,
      detected,
      status: 'invalid',
      path: pluginsFile,
      detail: `invalid JSON in ${pluginsFile}`,
    };
  }

  const keys = Object.keys(parsedPlugins.plugins ?? {}).filter((k) => k.startsWith('orbit@'));
  const key = keys.find((k) => !k.startsWith('orbit@orbit-head-')) ?? keys[0];
  const marketName = key ? key.slice('orbit@'.length) : 'orbit';
  const external = externalLocation(marketName) ?? externalLocation('orbit');
  if (external) return externalInspection('claude', detected, external);
  if (!key) {
    return {
      host: 'claude',
      displayName: DISPLAY_NAMES.claude,
      detected,
      status: 'unregistered',
      path: pluginsFile,
      detail: `not registered (no orbit plugin in ${pluginsFile})`,
    };
  }

  const rawEntry = parsedPlugins.plugins?.[key];
  const record = Array.isArray(rawEntry) ? (rawEntry.find((r) => r.scope === 'user') ?? rawEntry[0]) : rawEntry;
  const recordVersion = record?.version;
  const marketLocation = markets[marketName]?.installLocation;

  const activeVersion = readOptional(join(ctx.pluginDir, '.claude-plugin', 'plugin.json'))
    ? (JSON.parse(readFileSync(join(ctx.pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')) as { version?: string }).version
    : ctx.version;

  if (recordVersion === activeVersion) {
    return {
      host: 'claude',
      displayName: DISPLAY_NAMES.claude,
      detected,
      status: 'registered',
      path: pluginsFile,
      detail: `registered (${key} ${recordVersion}${marketLocation ? ` via ${marketLocation}` : ''})`,
    };
  }

  return {
    host: 'claude',
    displayName: DISPLAY_NAMES.claude,
    detected,
    status: 'stale',
    path: pluginsFile,
    stalePaths: [record?.installPath ?? `${key}@${recordVersion ?? 'unknown'}`],
    detail: `stale (${key} record ${recordVersion ?? 'unknown'}, bundle ${activeVersion ?? ctx.version})`,
  };
}

function applyClaude(ctx: HostContext): HostApplyResult {
  const env = ctx.env ?? process.env;
  const exec = ctx.exec ?? defaultExec;
  const current = inspectClaude(ctx);
  if (current.status === 'invalid') throw new Error(current.detail);
  if (current.status === 'external') throw externalError(current);
  if (current.status === 'registered') {
    return { host: 'claude', action: 'unchanged', path: current.path, detail: current.detail };
  }

  const manualCmd = `claude plugin marketplace add ${ctx.currentLink} && claude plugin install orbit@orbit`;
  if (!isExecutableOnPath('claude', env.PATH)) {
    return {
      host: 'claude',
      action: 'manual',
      path: current.path,
      command: manualCmd,
      detail: `claude CLI not on PATH; run: ${manualCmd}`,
    };
  }

  const marketsFile = join(ctx.home, '.claude', 'plugins', 'known_marketplaces.json');
  let orbitLocation: string | undefined;
  const rawMarkets = readOptional(marketsFile);
  if (rawMarkets) {
    try {
      const parsed = JSON.parse(rawMarkets) as Record<string, { installLocation?: string }>;
      orbitLocation = parsed.orbit?.installLocation;
    } catch {}
  }

  if (orbitLocation && safeRealpath(orbitLocation) !== safeRealpath(ctx.currentLink)) {
    exec('claude', ['plugin', 'marketplace', 'remove', 'orbit'], env);
    exec('claude', ['plugin', 'marketplace', 'add', ctx.currentLink], env);
  } else if (!orbitLocation) {
    exec('claude', ['plugin', 'marketplace', 'add', ctx.currentLink], env);
  } else {
    exec('claude', ['plugin', 'marketplace', 'update', 'orbit'], env);
  }

  if (current.status === 'stale') {
    exec('claude', ['plugin', 'update', 'orbit@orbit'], env);
    return { host: 'claude', action: 'updated', path: current.path, detail: `updated orbit@orbit from ${ctx.currentLink}` };
  }
  exec('claude', ['plugin', 'install', 'orbit@orbit'], env);
  return { host: 'claude', action: 'registered', path: current.path, detail: `installed orbit@orbit from ${ctx.currentLink}` };
}

function removeClaude(ctx: HostContext): HostRemoveResult {
  const env = ctx.env ?? process.env;
  const exec = ctx.exec ?? defaultExec;
  const current = inspectClaude(ctx);
  if (current.status === 'unregistered' || current.status === 'missing-file') {
    return { host: 'claude', action: 'unchanged', path: current.path, detail: 'not registered' };
  }
  if (current.status === 'external') {
    return { host: 'claude', action: 'skipped', path: current.path, detail: current.detail };
  }
  const cmd = 'claude plugin uninstall orbit@orbit';
  if (!isExecutableOnPath('claude', env.PATH)) {
    return { host: 'claude', action: 'manual', path: current.path, command: cmd, detail: `claude CLI not on PATH; run: ${cmd}` };
  }
  exec('claude', ['plugin', 'uninstall', 'orbit@orbit'], env);
  return { host: 'claude', action: 'removed', path: current.path, detail: 'uninstalled orbit@orbit' };
}

function inspectGrok(ctx: HostContext): HostInspection {
  const env = ctx.env ?? process.env;
  const grokDir = join(ctx.home, '.grok');
  const registryPath = join(grokDir, 'installed-plugins', 'registry.json');
  const detected = existsSync(grokDir) || isExecutableOnPath('grok', env.PATH);

  const raw = readOptional(registryPath);
  if (raw === undefined) {
    return {
      host: 'grok',
      displayName: DISPLAY_NAMES.grok,
      detected,
      status: 'missing-file',
      path: registryPath,
      detail: `not registered (${registryPath} missing)`,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      host: 'grok',
      displayName: DISPLAY_NAMES.grok,
      detected,
      status: 'invalid',
      path: registryPath,
      detail: `invalid JSON in ${registryPath}`,
    };
  }

  const repos = (parsed.repos && typeof parsed.repos === 'object' ? parsed.repos : {}) as Record<string, { path?: string; source?: string }>;
  const hit = Object.entries(repos).find(([name]) => name === 'orbit' || name.startsWith('orbit@'));
  if (!hit) {
    return {
      host: 'grok',
      displayName: DISPLAY_NAMES.grok,
      detected,
      status: 'unregistered',
      path: registryPath,
      detail: `not registered (orbit absent from ${registryPath})`,
    };
  }
  const installedPath = hit[1]?.path ?? hit[1]?.source;
  if (installedPath && !isOrbitManaged(installedPath, ctx.home)) {
    return externalInspection('grok', detected, installedPath);
  }
  if (installedPath && safeRealpath(installedPath) === safeRealpath(ctx.pluginDir)) {
    return {
      host: 'grok',
      displayName: DISPLAY_NAMES.grok,
      detected,
      status: 'registered',
      path: registryPath,
      detail: `registered (${hit[0]} at ${installedPath})`,
    };
  }
  return {
    host: 'grok',
    displayName: DISPLAY_NAMES.grok,
    detected,
    status: 'stale',
    path: registryPath,
    stalePaths: installedPath ? [installedPath] : [],
    detail: `stale (${installedPath ?? hit[0]} -> ${ctx.pluginDir})`,
  };
}

function applyGrok(ctx: HostContext): HostApplyResult {
  const env = ctx.env ?? process.env;
  const exec = ctx.exec ?? defaultExec;
  const current = inspectGrok(ctx);
  if (current.status === 'invalid') throw new Error(current.detail);
  if (current.status === 'external') throw externalError(current);
  if (current.status === 'registered') {
    return { host: 'grok', action: 'unchanged', path: current.path, detail: current.detail };
  }
  const cmd = `grok plugin install ${ctx.pluginDir}`;
  if (!isExecutableOnPath('grok', env.PATH)) {
    return { host: 'grok', action: 'manual', path: current.path, command: cmd, detail: `grok CLI not on PATH; run: ${cmd}` };
  }
  exec('grok', ['plugin', 'install', ctx.pluginDir], env);
  return {
    host: 'grok',
    action: current.status === 'stale' ? 'updated' : 'registered',
    path: current.path,
    detail: `installed orbit plugin at ${ctx.pluginDir}`,
  };
}

function removeGrok(ctx: HostContext): HostRemoveResult {
  const env = ctx.env ?? process.env;
  const exec = ctx.exec ?? defaultExec;
  const current = inspectGrok(ctx);
  if (current.status === 'unregistered' || current.status === 'missing-file') {
    return { host: 'grok', action: 'unchanged', path: current.path, detail: 'not registered' };
  }
  if (current.status === 'external') {
    return { host: 'grok', action: 'skipped', path: current.path, detail: current.detail };
  }
  const cmd = 'grok plugin uninstall orbit';
  if (!isExecutableOnPath('grok', env.PATH)) {
    return { host: 'grok', action: 'manual', path: current.path, command: cmd, detail: `grok CLI not on PATH; run: ${cmd}` };
  }
  exec('grok', ['plugin', 'uninstall', 'orbit'], env);
  return { host: 'grok', action: 'removed', path: current.path, detail: 'uninstalled orbit plugin from grok' };
}

/** Inspect registration status for a single host. */
export function inspectHost(host: HostId, ctx: HostContext): HostInspection {
  const env = ctx.env ?? process.env;
  switch (host) {
    case 'antigravity': {
      const configPath = antigravity.defaultConfigPath(ctx.home);
      const detected = existsSync(join(ctx.home, '.gemini', 'config')) || isExecutableOnPath('agy', env.PATH);
      const res = antigravity.inspectSkillsConfig({ configPath, skillsDir: ctx.skillsDir, home: ctx.home });
      return {
        host,
        displayName: DISPLAY_NAMES.antigravity,
        detected,
        status: res.status,
        path: res.configPath,
        detail: antigravity.formatCheckStatus(res),
        filtered: res.status === 'registered' ? res.filtered : undefined,
        stalePaths: res.status === 'stale' ? res.stalePaths : undefined,
      };
    }
    case 'codex': {
      const codexDir = join(ctx.home, '.codex');
      const detected = existsSync(codexDir) || isExecutableOnPath('codex', env.PATH);
      return inspectSymlinkHost('codex', join(codexDir, 'skills', 'orbit'), detected, ctx);
    }
    case 'agents': {
      const agentsDir = join(ctx.home, '.agents');
      const detected = existsSync(agentsDir);
      return inspectSymlinkHost('agents', join(agentsDir, 'skills', 'orbit'), detected, ctx);
    }
    case 'claude':
      return inspectClaude(ctx);
    case 'grok':
      return inspectGrok(ctx);
  }
}

/** Inspect all supported hosts in canonical order. */
export function inspectAllHosts(ctx: HostContext): HostInspection[] {
  return HOST_IDS.map((host) => inspectHost(host, ctx));
}

/** Register Orbit with one host. */
export function applyHost(host: HostId, ctx: HostContext): HostApplyResult {
  const env = ctx.env ?? process.env;
  switch (host) {
    case 'antigravity': {
      const configPath = antigravity.defaultConfigPath(ctx.home);
      const res = antigravity.applySkillsRegistration({ configPath, skillsDir: ctx.skillsDir, home: ctx.home });
      return {
        host,
        action: res.action,
        path: res.configPath,
        detail: `${res.action} (${res.skillsDir} in ${res.configPath})`,
      };
    }
    case 'codex': {
      const codexDir = join(ctx.home, '.codex');
      const detected = existsSync(codexDir) || isExecutableOnPath('codex', env.PATH);
      return applySymlinkHost('codex', join(codexDir, 'skills', 'orbit'), detected, ctx);
    }
    case 'agents': {
      const agentsDir = join(ctx.home, '.agents');
      return applySymlinkHost('agents', join(agentsDir, 'skills', 'orbit'), existsSync(agentsDir), ctx);
    }
    case 'claude':
      return applyClaude(ctx);
    case 'grok':
      return applyGrok(ctx);
  }
}

/** Deregister Orbit from one host cleanly. */
export function removeHost(host: HostId, ctx: HostContext): HostRemoveResult {
  const env = ctx.env ?? process.env;
  switch (host) {
    case 'antigravity': {
      const configPath = antigravity.defaultConfigPath(ctx.home);
      const res = antigravity.removeSkillsRegistration({ configPath, home: ctx.home });
      return {
        host,
        action: res.action,
        path: res.configPath,
        detail: res.action === 'removed' ? `removed ${res.removedPaths.join(', ')}` : 'not registered',
      };
    }
    case 'codex': {
      const codexDir = join(ctx.home, '.codex');
      const detected = existsSync(codexDir) || isExecutableOnPath('codex', env.PATH);
      return removeSymlinkHost('codex', join(codexDir, 'skills', 'orbit'), detected, ctx);
    }
    case 'agents': {
      const agentsDir = join(ctx.home, '.agents');
      return removeSymlinkHost('agents', join(agentsDir, 'skills', 'orbit'), existsSync(agentsDir), ctx);
    }
    case 'claude':
      return removeClaude(ctx);
    case 'grok':
      return removeGrok(ctx);
  }
}

/** Select hosts to apply during setup/install/sync. Implicit and --all selections skip externally managed hosts. */
export function resolveTargetHosts(
  requested: string[] | undefined,
  configured: HostId[] | undefined,
  ctx: HostContext,
  options: { all?: boolean } = {},
): HostId[] {
  if (requested && requested.length > 0 && !options.all) {
    return [...new Set(requested.map(parseHostId))];
  }
  const inspections = inspectAllHosts(ctx);
  const external = new Set(inspections.filter((h) => h.status === 'external').map((h) => h.host));
  const candidates = options.all
    ? [...HOST_IDS]
    : [...(configured ?? []), ...inspections.filter((h) => h.detected).map((h) => h.host)];
  return [...new Set(candidates)].filter((host) => !external.has(host));
}

/** Report each externally managed host as a skipped apply result. */
export function externalHostResults(ctx: HostContext): HostApplyResult[] {
  return inspectAllHosts(ctx)
    .filter((h) => h.status === 'external')
    .map((h) => ({ host: h.host, action: 'skipped' as const, path: h.path, detail: h.detail }));
}
