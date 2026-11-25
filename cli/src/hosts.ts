import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import * as antigravity from './antigravity.js';
import { readOptional, writeFileAtomic } from './paths.js';

export const HOST_IDS = ['antigravity', 'codex', 'agents', 'claude', 'grok'] as const;
export type HostId = (typeof HOST_IDS)[number];

export type HostStatus = 'registered' | 'unregistered' | 'missing-file' | 'stale' | 'invalid';

export interface HostInspection {
  host: HostId;
  displayName: string;
  detected: boolean;
  status: HostStatus;
  path: string;
  detail: string;
  filtered?: boolean;
  stalePaths?: string[];
  rules?: { path: string; present: boolean };
}

export interface HostApplyResult {
  host: HostId;
  action: 'registered' | 'updated' | 'unchanged';
  path: string;
  detail: string;
  /** A command the user still has to run, such as uninstalling a legacy orbit plugin. */
  command?: string;
}

export interface HostRemoveResult {
  host: HostId;
  action: 'removed' | 'unchanged' | 'skipped';
  path: string;
  detail: string;
  command?: string;
}

export interface HostContext {
  home: string;
  env?: NodeJS.ProcessEnv;
  skillsDir: string;
}

const DISPLAY_NAMES: Record<HostId, string> = {
  antigravity: 'Antigravity',
  codex: 'Codex',
  agents: 'Agent Skills (~/.agents)',
  claude: 'Claude Code',
  grok: 'Grok',
};

function codexDir(ctx: HostContext): string {
  return (ctx.env ?? process.env).CODEX_HOME || join(ctx.home, '.codex');
}

function grokDir(ctx: HostContext): string {
  return (ctx.env ?? process.env).GROK_HOME || join(ctx.home, '.grok');
}

const RULES_FILES: Partial<Record<HostId, (ctx: HostContext) => string>> = {
  antigravity: (ctx) => join(ctx.home, '.gemini', 'config', 'AGENTS.md'),
  codex: (ctx) => join(codexDir(ctx), 'AGENTS.md'),
  claude: (ctx) => join(ctx.home, '.claude', 'CLAUDE.md'),
  grok: (ctx) => join(grokDir(ctx), 'AGENTS.md'),
};

const RULES_START = '<!-- orbit:rules:start -->';
const RULES_END = '<!-- orbit:rules:end -->';
export const RULES_BLOCK = `${RULES_START}\nIf Non-negotiables is not in your context, load the orbit \`rules\` skill before your first reply.\n${RULES_END}`;
const RULES_SPAN = new RegExp(`${RULES_START}[\\s\\S]*?${RULES_END}`);
const RULES_SPAN_WITH_NEWLINES = new RegExp(`\\n?${RULES_START}[\\s\\S]*?${RULES_END}\\n?`);

function hasRulesBlock(path: string): boolean {
  return readOptional(safeRealpath(path))?.includes(RULES_BLOCK) ?? false;
}

/** Write or refresh orbit's marked block, leaving every byte outside the markers alone. Returns whether the file changed. */
function ensureRulesBlock(path: string): boolean {
  const target = safeRealpath(path);
  const current = readOptional(target);
  if (current?.includes(RULES_BLOCK)) return false;
  let next: string;
  if (current?.includes(RULES_START)) {
    if (!RULES_SPAN.test(current)) {
      throw new Error(`${path} has ${RULES_START} without ${RULES_END}. Fix or delete that marker by hand.`);
    }
    next = current.replace(RULES_SPAN, RULES_BLOCK);
  } else {
    // One newline either way, so removing `\n<block>\n` restores the file byte for byte.
    const separator = current ? '\n' : '';
    next = `${current ?? ''}${separator}${RULES_BLOCK}\n`;
  }
  writeFileAtomic(target, next, current === undefined ? 0o644 : statSync(target).mode & 0o777);
  return true;
}

function removeRulesBlock(path: string): boolean {
  const target = safeRealpath(path);
  const current = readOptional(target);
  if (!current || !RULES_SPAN.test(current)) return false;
  const next = current.replace(RULES_SPAN_WITH_NEWLINES, '');
  if (next === '' && !lstatSync(path).isSymbolicLink()) rmSync(path);
  else writeFileAtomic(target, next, statSync(target).mode & 0o777);
  return true;
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  const raw = readOptional(path);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isOrbitManifest(path: string): boolean {
  return readJsonObject(path)?.name === 'orbit';
}

function looksLikeOrbitSkills(targetPath: string): boolean {
  const posix = targetPath.replace(/\\/g, '/');
  if (/(?:^|\/)\.config\/orbit\/(?:current|releases\/[^/]+)\/plugin\/skills\/?$/.test(posix)) return true;
  if (/(?:^|\/)\.claude\/plugins\/(?:cache|marketplaces)\/orbit(?:\/.*)?\/skills\/?$/.test(posix)) return true;
  const pluginDir = join(safeRealpath(targetPath), '..');
  return isOrbitManifest(join(pluginDir, 'manifest.json')) || isOrbitManifest(join(pluginDir, '.claude-plugin', 'plugin.json'));
}

type LinkState = { kind: 'missing' } | { kind: 'other' } | { kind: 'link'; raw: string; target: string };

function readLink(path: string): LinkState {
  try {
    if (!lstatSync(path).isSymbolicLink()) return { kind: 'other' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  const raw = readlinkSync(path);
  return { kind: 'link', raw, target: isAbsolute(raw) ? raw : resolve(dirname(path), raw) };
}

function replaceSymlink(target: string, linkPath: string): void {
  const tempLink = join(dirname(linkPath), `.orbit-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    symlinkSync(target, tempLink);
    renameSync(tempLink, linkPath);
  } catch (error) {
    rmSync(tempLink, { force: true });
    throw error;
  }
}

function inspectSymlinkHost(host: 'codex' | 'agents', linkPath: string, detected: boolean, ctx: HostContext): HostInspection {
  const base = { host, displayName: DISPLAY_NAMES[host], detected, path: linkPath };
  const link = readLink(linkPath);
  switch (link.kind) {
    case 'missing':
      return { ...base, status: 'unregistered', detail: `not registered (${linkPath} missing)` };
    case 'other':
      return { ...base, status: 'invalid', detail: `non-symlink entry exists at ${linkPath}` };
    case 'link':
      if (link.target === ctx.skillsDir || safeRealpath(linkPath) === safeRealpath(ctx.skillsDir)) {
        return { ...base, status: 'registered', detail: `registered (${linkPath} -> ${link.raw})` };
      }
      if (looksLikeOrbitSkills(link.target)) {
        return { ...base, status: 'stale', stalePaths: [link.raw], detail: `stale (${link.raw} -> ${ctx.skillsDir})` };
      }
      return { ...base, status: 'invalid', detail: `symlink points to non-orbit directory (${link.raw})` };
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
  replaceSymlink(ctx.skillsDir, linkPath);
  const action = current.status === 'stale' ? 'updated' : 'registered';
  return { host, action, path: linkPath, detail: `${action} (${linkPath} -> ${ctx.skillsDir})` };
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

type SkillDirHost = 'claude' | 'grok';

const SKILL_DIR_HOSTS: Record<SkillDirHost, {
  targetDir: (ctx: HostContext) => string;
  detected: (ctx: HostContext) => boolean;
  hasLegacyPlugin: (ctx: HostContext) => boolean;
  legacyUninstall: string;
}> = {
  claude: {
    targetDir: (ctx) => join(ctx.home, '.claude', 'skills'),
    detected: (ctx) => existsSync(join(ctx.home, '.claude')) || isExecutableOnPath('claude', (ctx.env ?? process.env).PATH),
    hasLegacyPlugin: (ctx) => {
      const plugins = readJsonObject(join(ctx.home, '.claude', 'plugins', 'installed_plugins.json'))?.plugins;
      return isPlainObject(plugins) && Object.keys(plugins).some((key) => key.startsWith('orbit@'));
    },
    legacyUninstall: 'claude plugin uninstall orbit@orbit',
  },
  grok: {
    targetDir: (ctx) => join(grokDir(ctx), 'skills'),
    detected: (ctx) => existsSync(grokDir(ctx)) || isExecutableOnPath('grok', (ctx.env ?? process.env).PATH),
    hasLegacyPlugin: (ctx) => {
      const repos = readJsonObject(join(grokDir(ctx), 'installed-plugins', 'registry.json'))?.repos;
      return isPlainObject(repos)
        && Object.values(repos).some((repo) => isPlainObject(repo) && isPlainObject(repo.plugins) && 'orbit' in repo.plugins);
    },
    legacyUninstall: 'grok plugin uninstall orbit',
  },
};

type SkillEntry =
  | { kind: 'linked'; name: string }
  | { kind: 'missing'; name: string }
  | { kind: 'repoint'; name: string }
  | { kind: 'foreign'; name: string; path: string };

interface SkillDirScan {
  targetDir: string;
  detected: boolean;
  entries: SkillEntry[];
  obsolete: string[];
  legacyUninstall?: string;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function orbitSkillNames(skillsDir: string): string[] {
  return listDir(skillsDir).filter((name) => existsSync(join(skillsDir, name, 'SKILL.md')));
}

function isOrbitSkillLink(target: string, ctx: HostContext): boolean {
  return dirname(target) === resolve(ctx.skillsDir) || looksLikeOrbitSkills(dirname(target));
}

function orbitLinks(targetDir: string, ctx: HostContext): string[] {
  return listDir(targetDir).filter((name) => {
    const link = readLink(join(targetDir, name));
    return link.kind === 'link' && isOrbitSkillLink(link.target, ctx);
  });
}

function scanSkillDir(host: SkillDirHost, ctx: HostContext): SkillDirScan {
  const spec = SKILL_DIR_HOSTS[host];
  const targetDir = spec.targetDir(ctx);
  const skills = orbitSkillNames(ctx.skillsDir);
  const entries = skills.map((name): SkillEntry => {
    const path = join(targetDir, name);
    const link = readLink(path);
    if (link.kind === 'missing') return { kind: 'missing', name };
    if (link.kind === 'link' && link.target === join(resolve(ctx.skillsDir), name)) return { kind: 'linked', name };
    if (link.kind === 'link' && isOrbitSkillLink(link.target, ctx)) return { kind: 'repoint', name };
    return { kind: 'foreign', name, path };
  });
  const shipped = new Set(skills);
  return {
    targetDir,
    detected: spec.detected(ctx),
    entries,
    obsolete: orbitLinks(targetDir, ctx).filter((name) => !shipped.has(name)),
    ...(spec.hasLegacyPlugin(ctx) ? { legacyUninstall: spec.legacyUninstall } : {}),
  };
}

function inspectScan(host: SkillDirHost, scan: SkillDirScan): HostInspection {
  const { targetDir, entries, obsolete, legacyUninstall } = scan;
  const base = { host, displayName: DISPLAY_NAMES[host], detected: scan.detected, path: targetDir };
  const legacy = legacyUninstall ? `; legacy orbit plugin still installed, run: ${legacyUninstall}` : '';
  const foreign = entries.flatMap((entry) => (entry.kind === 'foreign' ? [entry.path] : []));
  if (foreign.length > 0) {
    return { ...base, status: 'invalid', detail: `non-orbit entries block orbit skills: ${foreign.join(', ')}${legacy}` };
  }
  const linked = entries.filter((entry) => entry.kind === 'linked').length;
  const repoint = entries.flatMap((entry) => (entry.kind === 'repoint' ? [join(targetDir, entry.name)] : []));
  const stalePaths = [...repoint, ...obsolete.map((name) => join(targetDir, name))];
  if (stalePaths.length === 0 && linked === entries.length && linked > 0 && !legacyUninstall) {
    return { ...base, status: 'registered', detail: `registered (${linked} skills linked in ${targetDir})` };
  }
  if (stalePaths.length === 0 && linked === 0 && !legacyUninstall) {
    return { ...base, status: 'unregistered', detail: `not registered (no orbit skills in ${targetDir})` };
  }
  return {
    ...base,
    status: 'stale',
    ...(stalePaths.length > 0 ? { stalePaths } : {}),
    detail: `stale (${linked}/${entries.length} skills linked in ${targetDir}${stalePaths.length ? `, ${stalePaths.length} outdated` : ''})${legacy}`,
  };
}

function inspectSkillDirHost(host: SkillDirHost, ctx: HostContext): HostInspection {
  return inspectScan(host, scanSkillDir(host, ctx));
}

function applySkillDirHost(host: SkillDirHost, ctx: HostContext): HostApplyResult {
  const scan = scanSkillDir(host, ctx);
  const current = inspectScan(host, scan);
  if (current.status === 'invalid') {
    throw new Error(`${DISPLAY_NAMES[host]} skills are blocked: ${current.detail}`);
  }
  const toLink = scan.entries.filter((entry) => entry.kind === 'missing' || entry.kind === 'repoint');
  if (toLink.length > 0) mkdirSync(scan.targetDir, { recursive: true });
  for (const { name } of toLink) replaceSymlink(join(ctx.skillsDir, name), join(scan.targetDir, name));
  for (const name of scan.obsolete) unlinkSync(join(scan.targetDir, name));

  const hadOrbit = scan.obsolete.length > 0 || scan.entries.some((entry) => entry.kind === 'linked' || entry.kind === 'repoint');
  const changed = toLink.length + scan.obsolete.length > 0;
  const action = !changed ? 'unchanged' : hadOrbit ? 'updated' : 'registered';
  const summary = changed
    ? `${action} (linked ${toLink.length}, pruned ${scan.obsolete.length} orbit skills in ${scan.targetDir})`
    : `registered (${scan.entries.length} skills linked in ${scan.targetDir})`;
  const legacy = scan.legacyUninstall ? `; legacy orbit plugin still installed, run: ${scan.legacyUninstall}` : '';
  return {
    host,
    action,
    path: scan.targetDir,
    detail: `${summary}${legacy}`,
    ...(scan.legacyUninstall ? { command: scan.legacyUninstall } : {}),
  };
}

function removeSkillDirHost(host: SkillDirHost, ctx: HostContext): HostRemoveResult {
  const spec = SKILL_DIR_HOSTS[host];
  const targetDir = spec.targetDir(ctx);
  const owned = orbitLinks(targetDir, ctx);
  for (const name of owned) unlinkSync(join(targetDir, name));
  const legacy = spec.hasLegacyPlugin(ctx) ? spec.legacyUninstall : undefined;
  const summary = owned.length > 0 ? `removed ${owned.length} orbit skill links from ${targetDir}` : 'not registered';
  return {
    host,
    action: owned.length > 0 ? 'removed' : 'unchanged',
    path: targetDir,
    detail: `${summary}${legacy ? `; legacy orbit plugin still installed, run: ${legacy}` : ''}`,
    ...(legacy ? { command: legacy } : {}),
  };
}

/** Inspect registration status for a single host, with its rules line when the host has an instructions file. */
export function inspectHost(host: HostId, ctx: HostContext): HostInspection {
  const inspection = inspectRegistration(host, ctx);
  const rulesPath = RULES_FILES[host]?.(ctx);
  if (!rulesPath) return inspection;
  return { ...inspection, rules: { path: rulesPath, present: hasRulesBlock(rulesPath) } };
}

function inspectRegistration(host: HostId, ctx: HostContext): HostInspection {
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
      const detected = existsSync(codexDir(ctx)) || isExecutableOnPath('codex', env.PATH);
      return inspectSymlinkHost('codex', join(codexDir(ctx), 'skills', 'orbit'), detected, ctx);
    }
    case 'agents': {
      const agentsDir = join(ctx.home, '.agents');
      const detected = existsSync(agentsDir);
      return inspectSymlinkHost('agents', join(agentsDir, 'skills', 'orbit'), detected, ctx);
    }
    case 'claude':
    case 'grok':
      return inspectSkillDirHost(host, ctx);
  }
}

/** Inspect all supported hosts in canonical order. */
export function inspectAllHosts(ctx: HostContext): HostInspection[] {
  return HOST_IDS.map((host) => inspectHost(host, ctx));
}

/** Register Orbit with one host and write its rules line. */
export function applyHost(host: HostId, ctx: HostContext): HostApplyResult {
  const result = applyRegistration(host, ctx);
  const rulesPath = RULES_FILES[host]?.(ctx);
  if (!rulesPath || !ensureRulesBlock(rulesPath)) return result;
  return {
    ...result,
    action: result.action === 'unchanged' ? 'updated' : result.action,
    detail: `${result.detail}; wrote orbit rules line to ${rulesPath}`,
  };
}

function applyRegistration(host: HostId, ctx: HostContext): HostApplyResult {
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
      const detected = existsSync(codexDir(ctx)) || isExecutableOnPath('codex', env.PATH);
      return applySymlinkHost('codex', join(codexDir(ctx), 'skills', 'orbit'), detected, ctx);
    }
    case 'agents': {
      const agentsDir = join(ctx.home, '.agents');
      return applySymlinkHost('agents', join(agentsDir, 'skills', 'orbit'), existsSync(agentsDir), ctx);
    }
    case 'claude':
    case 'grok':
      return applySkillDirHost(host, ctx);
  }
}

/** Deregister Orbit from one host cleanly and remove its rules line. */
export function removeHost(host: HostId, ctx: HostContext): HostRemoveResult {
  const result = removeRegistration(host, ctx);
  const rulesPath = RULES_FILES[host]?.(ctx);
  if (!rulesPath || !removeRulesBlock(rulesPath)) return result;
  return {
    ...result,
    action: result.action === 'unchanged' ? 'removed' : result.action,
    detail: `${result.detail}; removed orbit rules line from ${rulesPath}`,
  };
}

function removeRegistration(host: HostId, ctx: HostContext): HostRemoveResult {
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
      const detected = existsSync(codexDir(ctx)) || isExecutableOnPath('codex', env.PATH);
      return removeSymlinkHost('codex', join(codexDir(ctx), 'skills', 'orbit'), detected, ctx);
    }
    case 'agents': {
      const agentsDir = join(ctx.home, '.agents');
      return removeSymlinkHost('agents', join(agentsDir, 'skills', 'orbit'), existsSync(agentsDir), ctx);
    }
    case 'claude':
    case 'grok':
      return removeSkillDirHost(host, ctx);
  }
}

/** Select hosts to apply during setup/install/sync: the requested ones, else configured and detected hosts. */
export function resolveTargetHosts(
  requested: string[] | undefined,
  configured: HostId[] | undefined,
  ctx: HostContext,
  options: { all?: boolean } = {},
): HostId[] {
  if (requested && requested.length > 0 && !options.all) {
    return [...new Set(requested.map(parseHostId))];
  }
  if (options.all) return [...HOST_IDS];
  const detected = inspectAllHosts(ctx).filter((h) => h.detected).map((h) => h.host);
  return [...new Set([...(configured ?? []), ...detected])];
}
