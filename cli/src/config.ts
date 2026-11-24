import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { modelEffortOption, type CapabilitiesSnapshot, type ProviderModel } from './catalog.js';
import type { HostId } from './hosts.js';
import { orbitPaths, projectRoot, readOptional, withLock, writeFileAtomic } from './paths.js';

export type OnAllFailedPolicy = 'ask' | 'inherit' | 'hold';

export interface EscalationRule {
  after: number;
  target?: string;
  effort?: string;
  options?: Record<string, string | boolean>;
}

export interface TaskAssignment {
  target: string;
  effort?: string;
  options?: Record<string, string | boolean>;
  fallbacks?: string[];
  escalate?: EscalationRule;
  onAllFailed?: OnAllFailedPolicy;
  use?: string;
}

export interface ArenaPanelConfig {
  runners?: string[];
  judge?: string;
}

export interface ProfilePanels {
  'other-family'?: string[];
  interrogate?: string[];
  arena?: ArenaPanelConfig;
}

export interface WorkTypeConfig extends TaskAssignment {
  name: string;
  use: string;
}

export interface ProfileConfig {
  tasks: Record<string, TaskAssignment>;
  panels: ProfilePanels;
  workTypes: WorkTypeConfig[];
}

export interface OrbitConfig {
  version: 1;
  hosts?: HostId[];
  activeProfile: string;
  profiles: Record<string, ProfileConfig>;
}

// Role names and defaults mirror plugin/rules.md Workflow Defaults, Models, which the lead reads.
export const CANONICAL_TASKS: Record<string, { use: string; default: string }> = {
  advisor: { use: 'Plan gate, fork advisor, and diff review (orbit:advisor)', default: 'inherit' },
  judgment: { use: 'Hardest changes, prose delegates, explainers, and first panel seats', default: 'opus' },
  code: { use: 'Code delegates, swarm workers, and second panel seats', default: 'inherit' },
  verifier: { use: 'Pre-land independent verification (orbit:verifier)', default: 'inherit' },
  gitops: { use: 'Commits and PR work (orbit:gitops)', default: 'inherit' },
};

export const ROLE_ALIASES: Record<string, string> = {
  plan: 'advisor',
  hard: 'judgment',
  verify: 'verifier',
  fast: 'gitops',
};

export const PANEL_NAMES = ['other-family', 'interrogate', 'arena'] as const;

const ROLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TARGET_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:@+/-]+$/;
const LEGACY_ALIASES = ['inherit', 'opus', 'sonnet', 'haiku', 'fable'];
const STANDARD_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_TOKEN = /^[a-z][a-z0-9_-]*$/;

function splitList(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

/** Split a panel seat entry `<provider>/<model>@<effort>` into its target and effort. */
export function parseSeatEntry(entry: string): { target: string; effort?: string } {
  const value = entry.trim();
  const slash = value.indexOf('/');
  const at = value.lastIndexOf('@');
  if (slash > 0 && at > slash && EFFORT_TOKEN.test(value.slice(at + 1))) {
    return { target: value.slice(0, at), effort: value.slice(at + 1) };
  }
  return { target: value };
}

function validateSeatEntry(entry: string): boolean {
  const { target, effort } = parseSeatEntry(entry);
  if (effort) return TARGET_PATTERN.test(target);
  return target === 'other-family'
    || Object.hasOwn(CANONICAL_TASKS, normalizeTaskName(target))
    || LEGACY_ALIASES.includes(target)
    || TARGET_PATTERN.test(target);
}

/** Strip optional backticks and map legacy role aliases to canonical task names. */
export function normalizeTaskName(raw: string): string {
  const unwrapped = raw.trim().replace(/^`([^`]+)`$/, '$1').trim();
  return ROLE_ALIASES[unwrapped] ?? unwrapped;
}

function emptyProfile(): ProfileConfig {
  return { tasks: {}, panels: {}, workTypes: [] };
}

/** Return an empty version-1 OrbitConfig. */
export function defaultConfig(): OrbitConfig {
  return { version: 1, activeProfile: 'default', profiles: { default: emptyProfile() } };
}

function unwrapBackticks(value: string): string {
  return value.trim().replace(/^`([^`]+)`$/, '$1').trim();
}

function tableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim());
}

interface ParsedMarkdownRow {
  rawTask: string;
  task: string;
  use: string;
  model: string;
  effort: string;
}

function parseRetryCell(value: string): { base: string; escalated?: string; after?: number } {
  const match = value.match(/^(.+?),\s*(.+?)\s+after\s+([1-9][0-9]*)\s+failed\s+tries$/);
  if (!match) return { base: value.trim() };
  return {
    base: match[1].trim(),
    escalated: match[2].trim(),
    after: Number(match[3]),
  };
}

/** Parse a Markdown Models table, stripping optional backticks on task/model/effort cells. */
export function parseMarkdownModelsTable(text: string, opts: { insideWorkflow?: boolean } = {}): ParsedMarkdownRow[] {
  let lines = text.split(/\r?\n/);
  if (opts.insideWorkflow) {
    const workflow = lines.findIndex((line) => /^## Workflow\s*$/.test(line));
    if (workflow < 0) return [];
    const section = lines.slice(workflow + 1);
    const sectionEnd = section.findIndex((line) => /^#{1,2}\s/.test(line));
    const block = sectionEnd < 0 ? section : section.slice(0, sectionEnd);
    const models = block.findIndex((line) => /^### Models\s*$/.test(line));
    if (models < 0) return [];
    const modelBlock = block.slice(models + 1);
    const modelEnd = modelBlock.findIndex((line) => /^###\s/.test(line));
    lines = modelEnd < 0 ? modelBlock : modelBlock.slice(0, modelEnd);
  }

  const start = lines.findIndex((line, index) => {
    const labels = tableCells(line);
    const divider = tableCells(lines[index + 1] ?? '');
    return labels.join('|') === 'Task|Use for|Model|Effort'
      && divider.length === 4 && divider.every((cell) => /^:?-{3,}:?$/.test(cell));
  });
  if (start < 0) return [];

  const rows: ParsedMarkdownRow[] = [];
  const seen = new Set<string>();
  for (let i = start + 2; i < lines.length; i++) {
    const parts = tableCells(lines[i]);
    if (parts.length !== 4) break;
    const rawTask = unwrapBackticks(parts[0]);
    if (!ROLE_PATTERN.test(rawTask)) break;
    const task = normalizeTaskName(rawTask);
    if (seen.has(task)) throw new Error(`Duplicate Models row: ${rawTask}`);
    seen.add(task);
    rows.push({
      rawTask,
      task,
      use: parts[1].trim(),
      model: unwrapBackticks(parts[2]),
      effort: unwrapBackticks(parts[3]),
    });
  }
  return rows;
}

function rowsToProfile(rows: ParsedMarkdownRow[]): ProfileConfig {
  const profile = emptyProfile();
  for (const row of rows) {
    if (row.task === 'interrogate') {
      if (row.model) profile.panels.interrogate = splitList(row.model).map(normalizeTaskName);
      continue;
    }
    if (row.task === 'arena') {
      const entries = splitList(row.model);
      const judge = entries.find((entry) => entry.startsWith('judge='))?.slice('judge='.length).trim();
      const runners = entries.filter((entry) => !entry.startsWith('judge=')).map(normalizeTaskName);
      if (runners.length || judge) {
        profile.panels.arena = { ...(runners.length ? { runners } : {}), ...(judge ? { judge: normalizeTaskName(judge) } : {}) };
      }
      continue;
    }
    if (row.task === 'other-family') {
      if (row.model) {
        profile.panels['other-family'] = splitList(row.model);
      }
      if (row.effort) {
        profile.tasks['other-family'] = { target: row.model || 'inherit', effort: row.effort };
      }
      continue;
    }

    const parsedModel = parseRetryCell(row.model);
    const parsedEffort = parseRetryCell(row.effort);
    const assignment: TaskAssignment = {
      target: parsedModel.base || '',
      ...(parsedEffort.base ? { effort: parsedEffort.base } : {}),
      ...(row.use ? { use: row.use } : {}),
    };
    if (parsedModel.after !== undefined || parsedEffort.after !== undefined) {
      assignment.escalate = {
        after: parsedModel.after ?? parsedEffort.after ?? 1,
        ...(parsedModel.escalated ? { target: parsedModel.escalated } : {}),
        ...(parsedEffort.escalated ? { effort: parsedEffort.escalated } : {}),
      };
    }

    if (Object.hasOwn(CANONICAL_TASKS, row.task)) {
      if (row.task === 'verifier' && assignment.target === 'other-family, inherit') {
        assignment.onAllFailed = 'inherit';
      } else if (row.task === 'verifier' && assignment.target === 'other-family') {
        assignment.onAllFailed = 'ask';
      }
      profile.tasks[row.task] = assignment;
    } else {
      profile.workTypes.push({
        ...assignment,
        name: row.task,
        use: row.use || row.task,
        target: assignment.target || 'inherit',
      });
    }
  }
  return profile;
}

function cloneProfile(profile?: Partial<ProfileConfig>): ProfileConfig {
  const tasks: Record<string, TaskAssignment> = {};
  const workTypes = structuredClone(profile?.workTypes ?? []);
  for (const [rawName, assignment] of Object.entries(structuredClone(profile?.tasks ?? {}))) {
    const name = normalizeTaskName(rawName);
    if (Object.hasOwn(CANONICAL_TASKS, name) || name === 'other-family') {
      tasks[name] = assignment;
    } else if (!workTypes.some((w) => w.name === name)) {
      workTypes.push({ ...assignment, name, use: assignment.use || name });
    }
  }
  return { tasks, panels: structuredClone(profile?.panels ?? {}), workTypes };
}

function assertProfileShape(raw: unknown, sourcePath: string): Partial<ProfileConfig> {
  const isObject = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(raw)) throw new Error(`Invalid Orbit project config at ${sourcePath}: root must be a JSON object.`);
  const obj = raw as Record<string, unknown>;
  if (obj.tasks !== undefined && !isObject(obj.tasks)) throw new Error(`Invalid Orbit project config at ${sourcePath}: tasks must be an object.`);
  if (obj.panels !== undefined && !isObject(obj.panels)) throw new Error(`Invalid Orbit project config at ${sourcePath}: panels must be an object.`);
  if (obj.workTypes !== undefined && !Array.isArray(obj.workTypes)) throw new Error(`Invalid Orbit project config at ${sourcePath}: workTypes must be an array.`);
  return obj as Partial<ProfileConfig>;
}

function normalizeLoadedConfig(raw: unknown, sourcePath: string): OrbitConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid Orbit config at ${sourcePath}: root must be a JSON object.`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== 1) {
    throw new Error(`Unsupported Orbit config version at ${sourcePath}: ${String(obj.version)}.`);
  }
  const activeProfile = typeof obj.activeProfile === 'string' && obj.activeProfile.trim() ? obj.activeProfile : 'default';
  const rawProfiles = (obj.profiles && typeof obj.profiles === 'object' ? obj.profiles : {}) as Record<string, Partial<ProfileConfig>>;
  const profiles: Record<string, ProfileConfig> = {};
  for (const [name, p] of Object.entries(rawProfiles)) {
    profiles[name] = cloneProfile(p);
  }
  if (!profiles[activeProfile]) profiles[activeProfile] = emptyProfile();
  return {
    version: 1,
    ...(Array.isArray(obj.hosts) ? { hosts: obj.hosts as HostId[] } : {}),
    activeProfile,
    profiles,
  };
}

export interface LoadedConfig {
  config: OrbitConfig;
  source?: string;
  migratedFrom?: string;
}

/** Load user config from ~/.config/orbit/config.json, migrating legacy models.md when absent. */
export function loadConfig(home: string): LoadedConfig {
  const paths = orbitPaths(home);
  const jsonRaw = readOptional(paths.configPath);
  if (jsonRaw !== undefined) {
    return {
      config: normalizeLoadedConfig(JSON.parse(jsonRaw), paths.configPath),
      source: paths.configPath,
    };
  }

  for (const legacyPath of [paths.legacyModelsPath, paths.legacyClaudeModelsPath]) {
    const legacyText = readOptional(legacyPath);
    if (legacyText === undefined) continue;
    const rows = parseMarkdownModelsTable(legacyText);
    const config = defaultConfig();
    config.profiles.default = rowsToProfile(rows);
    return { config, source: legacyPath, migratedFrom: legacyPath };
  }

  return { config: defaultConfig(), source: undefined };
}

/** Atomically write ~/.config/orbit/config.json under a directory lock. */
export function saveConfig(home: string, config: OrbitConfig): void {
  const paths = orbitPaths(home);
  mkdirSync(paths.orbitDir, { recursive: true });
  withLock(`${paths.configPath}.lock`, 'config', () => {
    writeFileAtomic(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, 0o600);
  });
}

export interface ProjectOverrides {
  root: string;
  agentsProfile?: ProfileConfig;
  agentsPath?: string;
  orbitProfile?: ProfileConfig;
  orbitPath?: string;
  projectConfigError?: string;
}

/** Read project overrides from AGENTS.md (### Models) and .orbit/config.json, reporting malformed files in projectConfigError. */
export function loadProjectOverrides(dir = projectRoot()): ProjectOverrides {
  const root = projectRoot(dir);
  const errors: string[] = [];
  const agentsPath = join(root, 'AGENTS.md');
  const agentsText = readOptional(agentsPath);
  let agentsProfile: ProfileConfig | undefined;
  if (agentsText !== undefined) {
    try {
      agentsProfile = rowsToProfile(parseMarkdownModelsTable(agentsText, { insideWorkflow: true }));
    } catch (error) {
      errors.push(`${agentsPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const orbitPath = join(root, '.orbit', 'config.json');
  const orbitRaw = readOptional(orbitPath);
  let orbitProfile: ProfileConfig | undefined;
  if (orbitRaw !== undefined) {
    try {
      orbitProfile = cloneProfile(assertProfileShape(JSON.parse(orbitRaw), orbitPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message.includes(orbitPath) ? message : `${orbitPath}: ${message}`);
    }
  }

  return {
    root,
    agentsProfile,
    agentsPath: agentsText !== undefined ? agentsPath : undefined,
    orbitProfile,
    orbitPath: orbitRaw !== undefined ? orbitPath : undefined,
    ...(errors.length ? { projectConfigError: errors.join('; ') } : {}),
  };
}

function loadEditableProject(dir: string): ProjectOverrides {
  const project = loadProjectOverrides(dir);
  if (project.orbitPath && !project.orbitProfile) {
    throw new Error(`Fix or reset ${project.orbitPath} before editing it: ${project.projectConfigError}`);
  }
  return project;
}

/** Update <projectRoot>/.orbit/config.json atomically. */
export function saveProjectOverrides(dir: string, profile: ProfileConfig): string {
  const root = projectRoot(dir);
  const orbitPath = join(root, '.orbit', 'config.json');
  writeFileAtomic(orbitPath, `${JSON.stringify(profile, null, 2)}\n`, 0o644);
  return orbitPath;
}

function isSingleModel(value: string): boolean {
  return LEGACY_ALIASES.includes(value) || TARGET_PATTERN.test(value);
}

/** Validate a target expression for a task, panel, or work type. */
export function validateTarget(rawTask: string, rawValue: string): string | undefined {
  const task = normalizeTaskName(rawTask);
  const value = rawValue.trim();
  if (!ROLE_PATTERN.test(task)) return 'Use a kebab-case task or work-type name.';
  if (value === '') return undefined;

  if (task === 'other-family') {
    const entries = value.split(',').map((entry) => entry.trim());
    const providers = entries.filter((entry) => entry !== 'inherit').map((entry) => entry.split('/')[0]);
    const valid = entries.every((entry, index) => entry === 'inherit'
      ? index === entries.length - 1
      : TARGET_PATTERN.test(entry) || /^[a-zA-Z0-9_.-]+$/.test(entry));
    if (valid && new Set(providers).size === providers.length) return undefined;
    return 'Use unique provider or provider/model entries, with optional inherit at the end.';
  }

  if (task === 'interrogate' || task === 'arena') {
    const entries = splitList(value);
    if (entries.length > 0 && entries.every(validateSeatEntry)) return undefined;
    return `Use comma-separated ${task} seats: role names (${Object.keys(CANONICAL_TASKS).join(', ')}), other-family, or <provider>/<model>[@effort].`;
  }

  if (task === 'verifier' && ['other-family', 'other-family, inherit'].includes(value)) return undefined;
  if (isSingleModel(value)) return undefined;

  const retry = parseRetryCell(value);
  if (retry.after !== undefined && isSingleModel(retry.base) && retry.escalated && isSingleModel(retry.escalated)) {
    return undefined;
  }
  return 'Use provider/model, inherit, or a supported model value.';
}

/**
 * Validate an effort value. A catalog model's effort option is authoritative. A provider target the
 * catalog does not list may name any provider-native token, which resolve then marks unverified.
 */
export function validateEffort(effort: string, model?: ProviderModel, providerTarget = false): string | undefined {
  if (!effort) return undefined;
  const option = modelEffortOption(model);
  if (option?.values?.length) {
    return option.values.map(String).includes(effort)
      ? undefined
      : `Choose effort from ${option.values.join(', ')} for ${model!.id}.`;
  }
  if (STANDARD_EFFORTS.includes(effort)) return undefined;
  if (providerTarget && !model && EFFORT_TOKEN.test(effort)) return undefined;
  return `Choose effort from ${STANDARD_EFFORTS.join(', ')}, or a value the target model's effort option lists.`;
}

export interface EffectiveAssignmentRow {
  task: string;
  kind: 'task' | 'panel' | 'work-type';
  use: string;
  target: string;
  targetSource: string;
  effort: string;
  effortSource: string;
  options: Record<string, string | boolean>;
  fallbacks: string[];
  escalate?: EscalationRule;
  onAllFailed?: OnAllFailedPolicy;
  userTarget: string;
  userEffort: string;
  entries?: string[];
  judge?: string;
}

/** Merge user profile + project AGENTS.md + project .orbit/config.json into effective assignments. */
export function getEffectiveAssignments(home: string, projectDir = projectRoot()): {
  configPath: string;
  source?: string;
  migratedFrom?: string;
  activeProfile: string;
  hosts: HostId[];
  rows: EffectiveAssignmentRow[];
  config: OrbitConfig;
  project: ProjectOverrides;
} {
  const paths = orbitPaths(home);
  const loaded = loadConfig(home);
  const profile = loaded.config.profiles[loaded.config.activeProfile] ?? emptyProfile();
  const project = loadProjectOverrides(projectDir);
  const rows: EffectiveAssignmentRow[] = [];

  const layers = [
    { data: project.orbitProfile, source: project.orbitPath ?? 'project' },
    { data: project.agentsProfile, source: project.agentsPath ?? 'AGENTS.md' },
    { data: profile, source: loaded.source ?? 'default' },
  ];

  for (const [task, meta] of Object.entries(CANONICAL_TASKS)) {
    const hits = layers
      .map((layer) => ({ assignment: layer.data?.tasks?.[task], source: layer.source }))
      .filter((hit) => hit.assignment !== undefined);
    const targetHit = hits.find((hit) => Boolean(hit.assignment?.target));
    const effortHit = hits.find((hit) => Boolean(hit.assignment?.effort));
    const optionsHit = hits.find((hit) => hit.assignment?.options && Object.keys(hit.assignment.options).length > 0);
    const fallbacksHit = hits.find((hit) => hit.assignment?.fallbacks && hit.assignment.fallbacks.length > 0);
    const escalateHit = hits.find((hit) => Boolean(hit.assignment?.escalate));
    const policyHit = hits.find((hit) => Boolean(hit.assignment?.onAllFailed));
    const useHit = hits.find((hit) => Boolean(hit.assignment?.use));
    const userTask = profile.tasks[task];

    rows.push({
      task,
      kind: 'task',
      use: useHit?.assignment?.use || meta.use,
      target: targetHit?.assignment?.target || meta.default,
      targetSource: targetHit ? targetHit.source : 'default',
      effort: effortHit?.assignment?.effort || '',
      effortSource: effortHit ? effortHit.source : 'default',
      options: optionsHit?.assignment?.options ?? {},
      fallbacks: fallbacksHit?.assignment?.fallbacks ?? [],
      escalate: escalateHit?.assignment?.escalate,
      onAllFailed: policyHit?.assignment?.onAllFailed,
      userTarget: userTask?.target ?? '',
      userEffort: userTask?.effort ?? '',
    });
  }

  // other-family panel
  const otherFamilyHit = layers
    .map((layer) => ({ entries: layer.data?.panels?.['other-family'], source: layer.source }))
    .find((hit) => Array.isArray(hit.entries) && hit.entries.length > 0);
  const otherFamilyEffort = layers
    .map((layer) => ({ effort: layer.data?.tasks?.['other-family']?.effort, source: layer.source }))
    .find((hit) => Boolean(hit.effort));
  rows.push({
    task: 'other-family',
    kind: 'panel',
    use: 'Panel seat on another family under T3 Code',
    target: otherFamilyHit?.entries?.join(', ') || 'inherit',
    targetSource: otherFamilyHit ? otherFamilyHit.source : 'default',
    effort: otherFamilyEffort?.effort || '',
    effortSource: otherFamilyEffort ? otherFamilyEffort.source : 'default',
    options: {},
    fallbacks: [],
    userTarget: profile.panels['other-family']?.join(', ') ?? '',
    userEffort: profile.tasks['other-family']?.effort ?? '',
    entries: otherFamilyHit?.entries ?? [],
  });

  // interrogate panel
  const interrogateHit = layers
    .map((layer) => ({ entries: layer.data?.panels?.interrogate, source: layer.source }))
    .find((hit) => Array.isArray(hit.entries) && hit.entries.length > 0);
  const interrogateEntries = interrogateHit?.entries ?? ['judgment', 'other-family'];
  rows.push({
    task: 'interrogate',
    kind: 'panel',
    use: 'Adversarial review seats',
    target: interrogateEntries.join(', '),
    targetSource: interrogateHit ? interrogateHit.source : 'default',
    effort: '',
    effortSource: 'default',
    options: {},
    fallbacks: [],
    userTarget: profile.panels.interrogate?.join(', ') ?? '',
    userEffort: '',
    entries: interrogateEntries,
  });

  // arena panel
  const arenaHit = layers
    .map((layer) => ({ arena: layer.data?.panels?.arena, source: layer.source }))
    .find((hit) => hit.arena && (hit.arena.runners?.length || hit.arena.judge));
  const arenaRunners = arenaHit?.arena?.runners?.length ? arenaHit.arena.runners : ['judgment', 'code'];
  const arenaJudge = arenaHit?.arena?.judge || 'other-family';
  rows.push({
    task: 'arena',
    kind: 'panel',
    use: 'Parallel bakeoff runners and judge',
    target: `runners=[${arenaRunners.join(', ')}] judge=${arenaJudge}`,
    targetSource: arenaHit ? arenaHit.source : 'default',
    effort: '',
    effortSource: 'default',
    options: {},
    fallbacks: [],
    userTarget: profile.panels.arena?.runners?.join(', ') ?? '',
    userEffort: '',
    entries: arenaRunners,
    judge: arenaJudge,
  });

  // Work types: project first, then user-wide
  const workTypeMap = new Map<string, { item: WorkTypeConfig; source: string }>();
  for (const layer of layers) {
    for (const wt of layer.data?.workTypes ?? []) {
      const existing = workTypeMap.get(wt.name);
      if (!existing) {
        workTypeMap.set(wt.name, { item: { ...wt }, source: layer.source });
      } else {
        if (!existing.item.target && wt.target) existing.item.target = wt.target;
        if (!existing.item.effort && wt.effort) existing.item.effort = wt.effort;
        if (!existing.item.use && wt.use) existing.item.use = wt.use;
      }
    }
  }
  for (const [name, { item, source }] of workTypeMap) {
    const userWt = profile.workTypes.find((w) => w.name === name);
    rows.push({
      task: name,
      kind: 'work-type',
      use: item.use || name,
      target: item.target || 'inherit',
      targetSource: item.target ? source : 'default',
      effort: item.effort || '',
      effortSource: item.effort ? source : 'default',
      options: item.options ?? {},
      fallbacks: item.fallbacks ?? [],
      escalate: item.escalate,
      userTarget: userWt?.target ?? '',
      userEffort: userWt?.effort ?? '',
    });
  }

  return {
    configPath: paths.configPath,
    source: loaded.source,
    migratedFrom: loaded.migratedFrom,
    activeProfile: loaded.config.activeProfile,
    hosts: loaded.config.hosts ?? [],
    rows,
    config: loaded.config,
    project,
  };
}

export interface TaskUpdateInput {
  target?: string;
  effort?: string;
  options?: Record<string, string | boolean>;
  fallbacks?: string[];
  escalate?: EscalationRule;
  onAllFailed?: OnAllFailedPolicy;
  use?: string;
  judge?: string;
}

/** Update or add a task, panel, or work-type assignment in user config or project .orbit/config.json. */
export function setTaskAssignment(
  home: string,
  rawTask: string,
  update: TaskUpdateInput,
  options: { projectDir?: string; catalog?: CapabilitiesSnapshot } = {},
) {
  const task = normalizeTaskName(rawTask);
  if (update.target !== undefined) {
    const err = validateTarget(task, update.target);
    if (err) throw new Error(err);
  }
  if (update.judge !== undefined) {
    if (task !== 'arena') throw new Error('--judge applies only to the arena panel.');
    if (!validateSeatEntry(update.judge)) {
      throw new Error(`Invalid arena judge "${update.judge}". Use a role name (${Object.keys(CANONICAL_TASKS).join(', ')}), other-family, or <provider>/<model>[@effort].`);
    }
  }
  if (update.effort) {
    let model: ProviderModel | undefined;
    const providerTarget = Boolean(update.target?.includes('/'));
    if (update.target && providerTarget) {
      const idx = update.target.indexOf('/');
      const providerId = update.target.slice(0, idx);
      const modelId = update.target.slice(idx + 1);
      model = options.catalog?.providers.find((p) => p.providerInstanceId === providerId)?.models?.find((m) => m.id === modelId);
    }
    const err = validateEffort(update.effort, model, providerTarget);
    if (err) throw new Error(err);
  }
  if (update.use !== undefined && (!update.use.trim() || /[|\r\n\\]/.test(update.use))) {
    throw new Error('Use-for must be a nonempty, single-line description.');
  }

  const applyToProfile = (profile: ProfileConfig) => {
    if (task === 'other-family') {
      if (update.target !== undefined) {
        const list = update.target.split(',').map((s) => s.trim()).filter(Boolean);
        if (list.length === 0) delete profile.panels['other-family'];
        else profile.panels['other-family'] = list;
      }
      if (update.effort !== undefined) {
        if (!update.effort) delete profile.tasks['other-family'];
        else profile.tasks['other-family'] = { target: profile.panels['other-family']?.join(', ') ?? 'inherit', effort: update.effort };
      }
      return;
    }

    if (task === 'interrogate') {
      const list = (update.target ?? '').split(',').map((s) => normalizeTaskName(s)).filter(Boolean);
      if (list.length === 0) delete profile.panels.interrogate;
      else profile.panels.interrogate = list;
      return;
    }

    if (task === 'arena') {
      const prev = profile.panels.arena ?? {};
      const runners = update.target !== undefined
        ? update.target.split(',').map((s) => normalizeTaskName(s)).filter(Boolean)
        : prev.runners;
      const judge = update.judge !== undefined ? normalizeTaskName(update.judge) : prev.judge;
      if ((!runners || runners.length === 0) && !judge) delete profile.panels.arena;
      else profile.panels.arena = { ...(runners?.length ? { runners } : {}), ...(judge ? { judge } : {}) };
      return;
    }

    if (Object.hasOwn(CANONICAL_TASKS, task)) {
      const prev = profile.tasks[task] ?? { target: '' };
      const target = update.target !== undefined ? update.target : prev.target;
      const effort = update.effort !== undefined ? (update.effort || undefined) : prev.effort;
      const next: TaskAssignment = {
        target,
        ...(effort ? { effort } : {}),
        ...(update.options ? { options: update.options } : prev.options ? { options: prev.options } : {}),
        ...(update.fallbacks ? (update.fallbacks.length ? { fallbacks: update.fallbacks } : {}) : prev.fallbacks ? { fallbacks: prev.fallbacks } : {}),
        ...(update.escalate ? { escalate: update.escalate } : prev.escalate ? { escalate: prev.escalate } : {}),
        ...(update.onAllFailed ? { onAllFailed: update.onAllFailed } : prev.onAllFailed ? { onAllFailed: prev.onAllFailed } : {}),
        ...(update.use !== undefined ? { use: update.use } : prev.use ? { use: prev.use } : {}),
      };
      if (task === 'verifier' && update.target === 'other-family, inherit' && !update.onAllFailed) {
        next.onAllFailed = 'inherit';
      } else if (task === 'verifier' && update.target === 'other-family' && !update.onAllFailed) {
        next.onAllFailed = 'ask';
      }
      if (!next.target && !next.effort && !next.options && !next.fallbacks?.length && !next.escalate && !next.onAllFailed) {
        delete profile.tasks[task];
      } else {
        profile.tasks[task] = next;
      }
      return;
    }

    const idx = profile.workTypes.findIndex((w) => w.name === task);
    const prev = idx >= 0 ? profile.workTypes[idx] : undefined;
    const next: WorkTypeConfig = {
      name: task,
      use: update.use ?? prev?.use ?? task,
      target: update.target !== undefined ? update.target : (prev?.target ?? 'inherit'),
      ...(update.effort !== undefined ? (update.effort ? { effort: update.effort } : {}) : prev?.effort ? { effort: prev.effort } : {}),
      ...(update.options ? { options: update.options } : prev?.options ? { options: prev.options } : {}),
      ...(update.fallbacks ? (update.fallbacks.length ? { fallbacks: update.fallbacks } : {}) : prev?.fallbacks ? { fallbacks: prev.fallbacks } : {}),
      ...(update.escalate ? { escalate: update.escalate } : prev?.escalate ? { escalate: prev.escalate } : {}),
    };
    if (idx >= 0) profile.workTypes[idx] = next;
    else profile.workTypes.push(next);
  };

  if (options.projectDir) {
    const project = loadEditableProject(options.projectDir);
    const profile = cloneProfile(project.orbitProfile);
    applyToProfile(profile);
    saveProjectOverrides(project.root, profile);
    return getEffectiveAssignments(home, project.root);
  }

  const { config } = loadConfig(home);
  const profile = config.profiles[config.activeProfile] ?? emptyProfile();
  config.profiles[config.activeProfile] = profile;
  applyToProfile(profile);
  saveConfig(home, config);
  return getEffectiveAssignments(home, options.projectDir);
}

/** Clear a task, panel, or work-type override. */
export function unsetTaskAssignment(home: string, rawTask: string, options: { projectDir?: string } = {}) {
  const task = normalizeTaskName(rawTask);
  const clearFrom = (profile: ProfileConfig) => {
    if (task === 'other-family') {
      delete profile.panels['other-family'];
      delete profile.tasks['other-family'];
    } else if (task === 'interrogate') {
      delete profile.panels.interrogate;
    } else if (task === 'arena') {
      delete profile.panels.arena;
    } else if (Object.hasOwn(CANONICAL_TASKS, task)) {
      delete profile.tasks[task];
    } else {
      profile.workTypes = profile.workTypes.filter((w) => w.name !== task);
    }
  };

  if (options.projectDir) {
    const project = loadEditableProject(options.projectDir);
    const profile = cloneProfile(project.orbitProfile);
    clearFrom(profile);
    saveProjectOverrides(project.root, profile);
    return getEffectiveAssignments(home, project.root);
  }

  const { config } = loadConfig(home);
  const profile = config.profiles[config.activeProfile] ?? emptyProfile();
  config.profiles[config.activeProfile] = profile;
  clearFrom(profile);
  saveConfig(home, config);
  return getEffectiveAssignments(home, options.projectDir);
}

/** Reset the active profile or project overrides back to empty defaults. */
export function resetAssignments(home: string, options: { projectDir?: string } = {}) {
  if (options.projectDir) {
    const project = loadProjectOverrides(options.projectDir);
    saveProjectOverrides(project.root, emptyProfile());
    return getEffectiveAssignments(home, project.root);
  }
  const { config } = loadConfig(home);
  config.profiles[config.activeProfile] = emptyProfile();
  saveConfig(home, config);
  return getEffectiveAssignments(home, options.projectDir);
}

/** Update the list of enabled hosts persisted in ~/.config/orbit/config.json. */
export function setConfigHosts(home: string, hosts: HostId[]): OrbitConfig {
  const { config } = loadConfig(home);
  config.hosts = [...new Set(hosts)];
  saveConfig(home, config);
  return config;
}

/** List configured profiles and mark which one is active. */
export function listProfiles(home: string) {
  const { config } = loadConfig(home);
  return Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    active: name === config.activeProfile,
    taskCount: Object.keys(profile.tasks).length,
    panelCount: Object.keys(profile.panels).length,
    workTypeCount: profile.workTypes.length,
    profile,
  }));
}

/** Switch activeProfile to an existing profile name. */
export function useProfile(home: string, name: string): OrbitConfig {
  if (!ROLE_PATTERN.test(name)) throw new Error('Profile name must be kebab-case.');
  const { config } = loadConfig(home);
  if (!config.profiles[name]) throw new Error(`Profile "${name}" does not exist.`);
  config.activeProfile = name;
  saveConfig(home, config);
  return config;
}

/** Save or clone a profile and switch to it when created from an existing one. */
export function saveProfile(home: string, name: string, options: { from?: string; activate?: boolean } = {}): OrbitConfig {
  if (!ROLE_PATTERN.test(name)) throw new Error('Profile name must be kebab-case.');
  const { config } = loadConfig(home);
  const sourceName = options.from ?? config.activeProfile;
  const sourceProfile = config.profiles[sourceName];
  if (!sourceProfile) throw new Error(`Source profile "${sourceName}" does not exist.`);
  config.profiles[name] = cloneProfile(sourceProfile);
  if (options.activate !== false) config.activeProfile = name;
  saveConfig(home, config);
  return config;
}

/** Delete a non-active named profile. */
export function deleteProfile(home: string, name: string): OrbitConfig {
  const { config } = loadConfig(home);
  if (!config.profiles[name]) throw new Error(`Profile "${name}" does not exist.`);
  if (name === config.activeProfile) throw new Error(`Cannot delete active profile "${name}". Switch profiles first.`);
  if (Object.keys(config.profiles).length <= 1) throw new Error('Cannot delete the only remaining profile.');
  delete config.profiles[name];
  saveConfig(home, config);
  return config;
}
