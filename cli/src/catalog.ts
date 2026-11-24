import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { orbitPaths, readOptional, writeFileAtomic } from './paths.js';

export interface ProviderOption {
  id: string;
  values?: Array<string | boolean>;
  default?: string | boolean;
}

export interface ProviderModel {
  id: string;
  label?: string;
  options?: ProviderOption[];
}

export interface ProviderInfo {
  providerInstanceId: string;
  driverKind?: string;
  displayName?: string;
  models?: ProviderModel[];
  omittedModels?: number;
  runtimeModes?: string[];
  canRunChildTask?: boolean;
  canRunCrossProviderChildTask?: boolean;
  constraints?: string[];
}

export interface CapabilitiesSnapshot {
  syncedAt: string;
  source: string;
  parentThreadId?: string;
  inheritedProviderInstanceId?: string;
  inheritedModel?: string;
  inheritedOptions?: Array<{ id: string; value: string | boolean }>;
  runtimeMode?: string;
  interactionMode?: string;
  providers: ProviderInfo[];
}

export interface CatalogTargetEntry {
  target: string;
  providerInstanceId: string;
  driverKind: string;
  modelId: string;
  label?: string;
  options: ProviderOption[];
}

const EFFORT_OPTION_IDS = ['effort', 'reasoningEffort', 'thought_level'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse a raw T3 orchestrator_capabilities payload or ACP wrapper into CapabilitiesSnapshot. */
export function parseCapabilitiesPayload(raw: unknown, source: string): CapabilitiesSnapshot {
  let payload: unknown = raw;
  if (typeof payload === 'string') {
    payload = JSON.parse(payload);
  }
  if (isRecord(payload) && isRecord(payload.structuredContent) && Array.isArray(payload.structuredContent.providers)) {
    payload = payload.structuredContent;
  } else if (isRecord(payload) && Array.isArray(payload.content)) {
    const firstText = payload.content.find((entry) => isRecord(entry) && typeof entry.text === 'string') as
      | { text: string }
      | undefined;
    if (firstText) return parseCapabilitiesPayload(firstText.text, source);
  }

  if (!isRecord(payload) || !Array.isArray(payload.providers)) {
    throw new Error('Expected a T3 capabilities JSON object with a providers array.');
  }

  return {
    syncedAt: typeof payload.syncedAt === 'string' ? payload.syncedAt : new Date().toISOString(),
    source: typeof payload.source === 'string' ? payload.source : source,
    parentThreadId: typeof payload.parentThreadId === 'string' ? payload.parentThreadId : undefined,
    inheritedProviderInstanceId:
      typeof payload.inheritedProviderInstanceId === 'string' ? payload.inheritedProviderInstanceId : undefined,
    inheritedModel: typeof payload.inheritedModel === 'string' ? payload.inheritedModel : undefined,
    inheritedOptions: Array.isArray(payload.inheritedOptions)
      ? (payload.inheritedOptions as Array<{ id: string; value: string | boolean }>)
      : undefined,
    runtimeMode: typeof payload.runtimeMode === 'string' ? payload.runtimeMode : undefined,
    interactionMode: typeof payload.interactionMode === 'string' ? payload.interactionMode : undefined,
    providers: payload.providers as ProviderInfo[],
  };
}

/** Read cached capabilities from ~/.config/orbit/capabilities.json if present. */
export function readCapabilities(home: string): CapabilitiesSnapshot | undefined {
  const { capabilitiesPath } = orbitPaths(home);
  const raw = readOptional(capabilitiesPath);
  if (raw === undefined) return undefined;
  return parseCapabilitiesPayload(raw, 'cache');
}

/** Persist capabilities snapshot atomically to ~/.config/orbit/capabilities.json. */
export function writeCapabilities(home: string, snapshot: CapabilitiesSnapshot): string {
  const { capabilitiesPath } = orbitPaths(home);
  writeFileAtomic(capabilitiesPath, `${JSON.stringify(snapshot, null, 2)}\n`, 0o600);
  return capabilitiesPath;
}

export type AcpRunner = (nodeBin: string, args: string[], env: NodeJS.ProcessEnv) => string;

const defaultAcpRunner: AcpRunner = (nodeBin, args, env) =>
  execFileSync(nodeBin, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });

/** Fetch live T3 orchestrator_capabilities via T3's ACP bridge in the current terminal. */
export function syncCapabilitiesFromT3(
  env: NodeJS.ProcessEnv = process.env,
  runner: AcpRunner = defaultAcpRunner,
): CapabilitiesSnapshot {
  const nodeBin = env.T3_ACP_MCP_NODE;
  if (!nodeBin) {
    throw new Error('T3 ACP bridge is unavailable outside a T3 terminal (T3_ACP_MCP_NODE is unset). Pass --from <file> instead.');
  }
  const args = [
    ...(env.T3_ACP_MCP_ENTRYPOINT ? [env.T3_ACP_MCP_ENTRYPOINT] : []),
    'acp-mcp-call',
    'orchestrator_capabilities',
    '{}',
  ];
  const stdout = runner(nodeBin, args, { ...env, ELECTRON_RUN_AS_NODE: '1' });
  return parseCapabilitiesPayload(stdout, 't3-acp');
}

/** Read T3 orchestrator_capabilities from a JSON file path or '-' for stdin. */
export function syncCapabilitiesFromFile(pathOrDash: string, stdinText?: string): CapabilitiesSnapshot {
  const content = pathOrDash === '-'
    ? (stdinText ?? readFileSync(0, 'utf8'))
    : readFileSync(pathOrDash, 'utf8');
  return parseCapabilitiesPayload(content, pathOrDash === '-' ? 'stdin' : pathOrDash);
}

/** Return true when a provider's constraints mark it disabled. */
export function isProviderDisabled(provider: ProviderInfo): boolean {
  return Array.isArray(provider.constraints)
    && provider.constraints.some((line) => /provider instance is disabled/i.test(line));
}

/** List all enabled provider/model targets from a capabilities snapshot. */
export function listCatalogTargets(snapshot?: CapabilitiesSnapshot): CatalogTargetEntry[] {
  if (!snapshot) return [];
  const entries: CatalogTargetEntry[] = [];
  for (const provider of snapshot.providers) {
    if (isProviderDisabled(provider) || !Array.isArray(provider.models)) continue;
    if (typeof provider.providerInstanceId !== 'string') continue;
    const driverKind = provider.driverKind ?? provider.providerInstanceId;
    for (const model of provider.models) {
      if (!model || typeof model.id !== 'string') continue;
      entries.push({
        target: `${provider.providerInstanceId}/${model.id}`,
        providerInstanceId: provider.providerInstanceId,
        driverKind,
        modelId: model.id,
        label: model.label,
        options: Array.isArray(model.options) ? model.options : [],
      });
    }
  }
  return entries;
}

/** Find a provider and optional model entry inside a capabilities snapshot. */
export function findCatalogModel(
  snapshot: CapabilitiesSnapshot | undefined,
  providerInstanceId: string,
  modelId: string,
): { provider: ProviderInfo; model?: ProviderModel } | undefined {
  if (!snapshot) return undefined;
  const provider = snapshot.providers.find((entry) => entry.providerInstanceId === providerInstanceId);
  if (!provider) return undefined;
  const model = provider.models?.find((entry) => entry.id === modelId);
  return { provider, model };
}

/** Return the supported effort option id and values for a model, if listed. */
export function modelEffortOption(model?: ProviderModel): ProviderOption | undefined {
  if (!Array.isArray(model?.options)) return undefined;
  return model.options.find((opt) => EFFORT_OPTION_IDS.includes(opt.id))
    ?? model.options.find((opt) => Array.isArray(opt.values) && opt.values.some((v) => v === 'medium' || v === 'high'));
}

/** Convert an effort string and explicit options into provider-native target.options. */
export function buildTargetOptions(
  model: ProviderModel | undefined,
  effort: string | undefined,
  explicitOptions?: Record<string, string | boolean>,
): {
  options: Array<{ id: string; value: string | boolean }>;
  unverifiedEffort: boolean;
  skippedEffortReason?: string;
} {
  const mapped = new Map<string, string | boolean>();
  let unverifiedEffort = false;
  let skippedEffortReason: string | undefined;

  if (effort) {
    const option = modelEffortOption(model);
    if (option) {
      if (!Array.isArray(option.values) || option.values.includes(effort)) {
        mapped.set(option.id, effort);
      } else {
        skippedEffortReason = `effort "${effort}" is not supported by ${model?.id ?? 'model'} (${option.id}: ${option.values.join(', ')})`;
      }
    } else if (!model) {
      unverifiedEffort = true;
    } else {
      skippedEffortReason = `model "${model.id}" lists no effort option`;
    }
  }

  if (explicitOptions) {
    for (const [id, value] of Object.entries(explicitOptions)) {
      mapped.set(id, value);
    }
  }

  return {
    options: [...mapped.entries()].map(([id, value]) => ({ id, value })),
    unverifiedEffort,
    skippedEffortReason,
  };
}

/** Check whether a snapshot file exists on disk. */
export function hasCapabilitiesCache(home: string): boolean {
  return existsSync(orbitPaths(home).capabilitiesPath);
}
