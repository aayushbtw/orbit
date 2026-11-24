import {
  buildTargetOptions,
  findCatalogModel,
  isProviderDisabled,
  readCapabilities,
  type CapabilitiesSnapshot,
  type ProviderInfo,
  type ProviderModel,
} from './catalog.js';
import {
  CANONICAL_TASKS,
  getEffectiveAssignments,
  normalizeTaskName,
  parseSeatEntry,
  type EffectiveAssignmentRow,
  type OnAllFailedPolicy,
} from './config.js';
import { projectRoot } from './paths.js';

const FAMILY_VENDORS: Record<string, string> = {
  claude: 'anthropic',
  gpt: 'openai',
  gemini: 'google',
  grok: 'xai',
};

export interface DelegateTarget {
  providerInstanceId: string;
  model: string;
  options: Array<{ id: string; value: string | boolean }>;
  familyVerified: boolean;
  modelVerified: boolean;
  unverifiedEffort?: boolean;
  warning?: string;
}

export interface UnavailableEntry {
  entry: string;
  reason: string;
}

export interface SessionContext {
  providerInstanceId?: string;
  driverKind?: string;
  modelId?: string;
  familyWord: string | null;
}

export type SeatResult = ResolveTaskResult & { seat: string };

export interface ResolveTaskResult {
  kind: 'task' | 'roster' | 'panel';
  task: string;
  mode: 'inherit' | 'same-provider' | 'delegate' | 'ask' | 'hold' | 'skip' | 'alias' | 'unavailable' | 'panel';
  source: string;
  escalated: boolean;
  tries: number;
  session: SessionContext;
  target: DelegateTarget | null;
  candidates: DelegateTarget[];
  unavailable: UnavailableEntry[];
  fallbackToInherit: boolean;
  onAllFailed?: OnAllFailedPolicy;
  alias?: string;
  requestedEffort?: string;
  seats?: SeatResult[];
}

/** Return true for opaque model ids that hide the underlying model family. */
export function isOpaqueModel(modelId: string): boolean {
  return modelId === 'auto' || modelId === 'default';
}

/** Extract the family token before the first hyphen in the last slash segment. */
export function extractFamilyWord(modelId?: string): string | null {
  if (!modelId || isOpaqueModel(modelId)) return null;
  const lastSegment = modelId.split('/').pop() ?? modelId;
  const dash = lastSegment.indexOf('-');
  if (dash <= 0) return null;
  return lastSegment.slice(0, dash).toLowerCase();
}

/** Return true when any token in modelId matches sessionFamilyWord or its vendor. */
export function matchesSessionFamily(modelId: string, sessionFamilyWord: string | null): boolean {
  if (!sessionFamilyWord || isOpaqueModel(modelId)) return false;
  const vendor = FAMILY_VENDORS[sessionFamilyWord];
  const tokens = modelId.toLowerCase().split(/[-/.:]/).filter(Boolean);
  return tokens.includes(sessionFamilyWord) || (vendor ? tokens.includes(vendor) : false);
}

/** Derive lead provider, driverKind, modelId, and familyWord from --lead or catalog. */
export function resolveSessionContext(leadArg?: string, catalog?: CapabilitiesSnapshot): SessionContext {
  let providerInstanceId = catalog?.inheritedProviderInstanceId;
  let modelId = catalog?.inheritedModel;

  if (leadArg) {
    const slash = leadArg.indexOf('/');
    if (slash > 0) {
      providerInstanceId = leadArg.slice(0, slash);
      modelId = leadArg.slice(slash + 1);
    } else {
      modelId = leadArg;
    }
  }

  const provider = providerInstanceId
    ? catalog?.providers.find((p) => p.providerInstanceId === providerInstanceId)
    : undefined;
  const driverKind = provider?.driverKind ?? providerInstanceId;

  let familyWord = extractFamilyWord(modelId);
  if (!familyWord && modelId && provider?.models) {
    const tokenMatch = provider.models.find((m) =>
      extractFamilyWord(m.id) !== null && m.id.toLowerCase().split(/[-/.:]/).includes(modelId!.toLowerCase()),
    );
    familyWord = extractFamilyWord(tokenMatch?.id);
  }

  return { providerInstanceId, driverKind, modelId, familyWord };
}

function splitTarget(entry: string): { providerInstanceId: string; modelId?: string } {
  const slash = entry.indexOf('/');
  if (slash < 0) return { providerInstanceId: entry };
  return {
    providerInstanceId: entry.slice(0, slash),
    modelId: entry.slice(slash + 1),
  };
}

function checkProviderEligibility(
  providerInstanceId: string,
  catalog: CapabilitiesSnapshot | undefined,
  session: SessionContext,
  options: { requireCrossProvider: boolean; requireRuntimeMode?: string },
): { provider?: ProviderInfo; error?: string } {
  if (!catalog) {
    return { error: undefined };
  }
  const provider = catalog.providers.find((p) => p.providerInstanceId === providerInstanceId);
  if (!provider) return { error: `${providerInstanceId} not listed in T3 capabilities` };
  if (isProviderDisabled(provider)) {
    return { error: provider.constraints?.join('; ') || 'provider disabled' };
  }
  if (options.requireCrossProvider && providerInstanceId !== session.providerInstanceId && !provider.canRunCrossProviderChildTask) {
    return { error: provider.constraints?.join('; ') || 'cannot run cross-provider child task' };
  }
  if (!provider.models || provider.models.length === 0) {
    return { error: provider.constraints?.join('; ') || 'provider lists no models' };
  }
  if (options.requireRuntimeMode && Array.isArray(provider.runtimeModes) && !provider.runtimeModes.includes(options.requireRuntimeMode)) {
    return { error: `runtime mode ${options.requireRuntimeMode} not offered` };
  }
  return { provider };
}

function pickModelForBareProvider(provider: ProviderInfo | undefined, session: SessionContext): { model?: ProviderModel; error?: string } {
  if (!provider?.models || provider.models.length === 0) {
    return { error: 'no catalog models available for bare provider' };
  }
  const nonOpaque = provider.models.find((m) => !isOpaqueModel(m.id) && !matchesSessionFamily(m.id, session.familyWord));
  if (nonOpaque) return { model: nonOpaque };
  const opaque = provider.models.find((m) => isOpaqueModel(m.id));
  if (opaque) return { model: opaque };
  return { error: 'no model outside the session family' };
}

function resolveRosterEntries(
  entries: string[],
  catalog: CapabilitiesSnapshot | undefined,
  session: SessionContext,
  opts: {
    enforceOtherFamily: boolean;
    maxCandidates: number;
    requireRuntimeMode?: string;
    effort?: string;
    explicitOptions?: Record<string, string | boolean>;
  },
): { candidates: DelegateTarget[]; unavailable: UnavailableEntry[]; fallbackToInherit: boolean } {
  const candidates: DelegateTarget[] = [];
  const unavailable: UnavailableEntry[] = [];
  const seenProviders = new Set<string>();
  let fallbackToInherit = false;

  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i].trim();
    if (!raw) continue;
    if (raw === 'inherit') {
      if (i === entries.length - 1) fallbackToInherit = true;
      continue;
    }
    if (candidates.length >= opts.maxCandidates) break;

    const { providerInstanceId, modelId } = splitTarget(raw);
    const sameProvider = session.providerInstanceId !== undefined && providerInstanceId === session.providerInstanceId;
    const { provider, error: providerErr } = checkProviderEligibility(providerInstanceId, catalog, session, {
      requireCrossProvider: opts.enforceOtherFamily || !sameProvider,
      requireRuntimeMode: opts.requireRuntimeMode,
    });

    if (opts.enforceOtherFamily && session.driverKind && provider?.driverKind === session.driverKind) {
      continue;
    }

    if (seenProviders.has(providerInstanceId)) {
      unavailable.push({ entry: raw, reason: 'provider already a candidate' });
      continue;
    }
    seenProviders.add(providerInstanceId);

    if (opts.enforceOtherFamily && modelId && matchesSessionFamily(modelId, session.familyWord)) {
      unavailable.push({ entry: raw, reason: `${modelId} is the session's family` });
      continue;
    }

    if (providerErr) {
      unavailable.push({ entry: raw, reason: providerErr });
      continue;
    }

    let resolvedModel: ProviderModel | undefined;
    let resolvedModelId = modelId;
    let modelVerified = false;
    if (!resolvedModelId) {
      const picked = pickModelForBareProvider(provider, session);
      if (picked.error || !picked.model) {
        unavailable.push({ entry: raw, reason: picked.error ?? 'no eligible model' });
        continue;
      }
      resolvedModel = picked.model;
      resolvedModelId = picked.model.id;
      modelVerified = true;
    } else if (provider) {
      const listed = provider.models?.find((m) => m.id === resolvedModelId);
      if (listed) {
        resolvedModel = listed;
        modelVerified = true;
      } else if (!(provider.omittedModels && provider.omittedModels > 0)) {
        unavailable.push({ entry: raw, reason: `model ${resolvedModelId} not listed on ${providerInstanceId}` });
        continue;
      }
    }

    const built = buildTargetOptions(resolvedModel, opts.effort, opts.explicitOptions);
    const familyVerified = Boolean(session.familyWord && !isOpaqueModel(resolvedModelId));
    const warnings = [
      !familyVerified ? 'family unverified' : '',
      !modelVerified ? 'model unverified (not in cached catalog)' : '',
      built.skippedEffortReason ?? '',
    ].filter(Boolean);

    candidates.push({
      providerInstanceId,
      model: resolvedModelId,
      options: built.options,
      familyVerified,
      modelVerified,
      ...(built.unverifiedEffort ? { unverifiedEffort: true } : {}),
      ...(warnings.length ? { warning: warnings.join('; ') } : {}),
    });
  }

  return { candidates, unavailable, fallbackToInherit };
}

function resolveRowAssignment(
  taskName: string,
  row: EffectiveAssignmentRow,
  allRows: EffectiveAssignmentRow[],
  catalog: CapabilitiesSnapshot | undefined,
  session: SessionContext,
  tries: number,
  runtimeMode: string | undefined,
): ResolveTaskResult {
  const escalateAfter = row.escalate?.after;
  const escalated = escalateAfter !== undefined && tries >= escalateAfter;
  const effectiveTarget = (escalated && row.escalate?.target) ? row.escalate.target : row.target;
  const effectiveEffort = (escalated && row.escalate?.effort) ? row.escalate.effort : row.effort;
  const effectiveOptions = { ...row.options, ...(escalated ? row.escalate?.options : undefined) };
  const requestedEffort = effectiveEffort || undefined;

  if (!effectiveTarget || effectiveTarget === 'inherit') {
    return {
      kind: 'task',
      task: taskName,
      mode: 'inherit',
      source: row.targetSource,
      escalated,
      tries,
      session,
      target: null,
      candidates: [],
      unavailable: [],
      fallbackToInherit: true,
      requestedEffort,
    };
  }

  if (effectiveTarget === 'other-family' || effectiveTarget === 'other-family, inherit') {
    const otherRow = allRows.find((r) => r.task === 'other-family');
    const rosterEntries = otherRow?.userTarget || otherRow?.target !== 'inherit'
      ? (otherRow?.target ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const roster = resolveRosterEntries(rosterEntries, catalog, session, {
      enforceOtherFamily: true,
      maxCandidates: 3,
      requireRuntimeMode: runtimeMode,
      effort: requestedEffort ?? (otherRow?.effort || undefined),
      explicitOptions: effectiveOptions,
    });
    const policy: OnAllFailedPolicy = effectiveTarget === 'other-family, inherit'
      ? 'inherit'
      : (row.onAllFailed ?? (taskName === 'verifier' ? 'ask' : 'inherit'));
    const fallbackToInherit = policy === 'inherit' || roster.fallbackToInherit;
    const mode = roster.candidates.length > 0
      ? 'delegate'
      : fallbackToInherit ? 'inherit' : policy === 'hold' ? 'hold' : taskName === 'verifier' ? 'ask' : 'skip';

    return {
      kind: 'task',
      task: taskName,
      mode,
      source: row.targetSource,
      escalated,
      tries,
      session,
      target: roster.candidates[0] ?? null,
      candidates: roster.candidates,
      unavailable: roster.unavailable,
      fallbackToInherit,
      onAllFailed: policy,
      requestedEffort,
    };
  }

  if (!effectiveTarget.includes('/')) {
    return {
      kind: 'task',
      task: taskName,
      mode: 'alias',
      alias: effectiveTarget,
      source: row.targetSource,
      escalated,
      tries,
      session,
      target: null,
      candidates: [],
      unavailable: [],
      fallbackToInherit: false,
      requestedEffort,
    };
  }

  const entries = [effectiveTarget, ...row.fallbacks];
  const resolved = resolveRosterEntries(entries, catalog, session, {
    enforceOtherFamily: false,
    maxCandidates: entries.length,
    requireRuntimeMode: runtimeMode,
    effort: requestedEffort,
    explicitOptions: effectiveOptions,
  });
  const primary = resolved.candidates[0] ?? null;
  const sameProvider = primary !== null && session.providerInstanceId !== undefined
    && primary.providerInstanceId === session.providerInstanceId;

  return {
    kind: 'task',
    task: taskName,
    mode: primary ? (sameProvider ? 'same-provider' : 'delegate') : 'unavailable',
    source: row.targetSource,
    escalated,
    tries,
    session,
    target: primary,
    candidates: resolved.candidates,
    unavailable: resolved.unavailable,
    fallbackToInherit: resolved.fallbackToInherit,
    requestedEffort,
  };
}

/** Deterministically resolve a task, work type, or panel into T3 delegate targets. */
export function resolveTask(options: {
  task: string;
  workType?: string;
  lead?: string;
  tries?: number;
  runtimeMode?: string;
  home: string;
  projectDir?: string;
  catalog?: CapabilitiesSnapshot;
}): ResolveTaskResult {
  const dir = options.projectDir ?? projectRoot();
  const state = getEffectiveAssignments(options.home, dir);
  const catalog = options.catalog ?? readCapabilities(options.home);
  const session = resolveSessionContext(options.lead, catalog);
  const runtimeMode = options.runtimeMode ?? catalog?.runtimeMode;
  const tries = options.tries ?? 0;

  const normalized = normalizeTaskName(options.workType ?? options.task);

  if (normalized === 'other-family') {
    const row = state.rows.find((r) => r.task === 'other-family')!;
    const entries = row.target === 'inherit' ? [] : row.target.split(',').map((s) => s.trim()).filter(Boolean);
    const roster = resolveRosterEntries(entries, catalog, session, {
      enforceOtherFamily: true,
      maxCandidates: 3,
      requireRuntimeMode: runtimeMode,
      effort: row.effort || undefined,
    });
    return {
      kind: 'roster',
      task: 'other-family',
      mode: roster.candidates.length > 0 ? 'delegate' : roster.fallbackToInherit || entries.length === 0 ? 'inherit' : 'skip',
      source: row.targetSource,
      escalated: false,
      tries,
      session,
      target: roster.candidates[0] ?? null,
      candidates: roster.candidates,
      unavailable: roster.unavailable,
      fallbackToInherit: roster.fallbackToInherit || entries.length === 0,
      requestedEffort: row.effort || undefined,
    };
  }

  if (normalized === 'interrogate' || normalized === 'arena') {
    const row = state.rows.find((r) => r.task === normalized)!;
    const resolveSeat = (entry: string, label: string) => {
      const name = normalizeTaskName(entry);
      if (name === 'other-family' || Object.hasOwn(CANONICAL_TASKS, name)) {
        return resolveTask({ ...options, task: name, workType: undefined, catalog });
      }
      const seat = parseSeatEntry(entry);
      return resolveRowAssignment(
        label,
        {
          task: label,
          kind: 'panel',
          use: label,
          target: seat.target,
          targetSource: row.targetSource,
          effort: seat.effort ?? '',
          effortSource: row.targetSource,
          options: {},
          fallbacks: [],
          userTarget: '',
          userEffort: '',
        },
        state.rows,
        catalog,
        session,
        tries,
        runtimeMode,
      );
    };
    const entries = row.entries ?? [];
    const seats: SeatResult[] = normalized === 'interrogate'
      ? entries.map((entry, idx) => ({ seat: `adversary-${idx + 1}`, ...resolveSeat(entry, 'interrogate-seat') }))
      : [
        ...entries.map((entry, idx) => ({ seat: `runner-${idx + 1}`, ...resolveSeat(entry, `arena-runner-${idx + 1}`) })),
        { seat: 'judge', ...resolveSeat(row.judge ?? 'other-family', 'arena-judge') },
      ];
    return {
      kind: 'panel',
      task: normalized,
      mode: 'panel',
      source: row.targetSource,
      escalated: false,
      tries,
      session,
      target: null,
      candidates: [],
      unavailable: [],
      fallbackToInherit: false,
      seats,
    };
  }

  let row = state.rows.find((r) => r.task === normalized);
  if (!row) {
    // Unknown work type falls back to code per Orbit's defaults.
    row = state.rows.find((r) => r.task === 'code')!;
  }
  return resolveRowAssignment(row.task, row, state.rows, catalog, session, tries, runtimeMode);
}

/** List every `<provider>/<model>` target a row names, including roster entries, panel seats, the arena judge, fallbacks, and escalation. */
export function rowProviderTargets(row: EffectiveAssignmentRow): string[] {
  // Only interrogate and arena seats carry `@<effort>`. Elsewhere `@` may be part of the model id, as resolveTask reads it.
  const named = [...(row.entries ?? [row.target]), ...(row.judge ? [row.judge] : [])];
  const seats = row.task === 'interrogate' || row.task === 'arena'
    ? named.map((entry) => parseSeatEntry(entry).target)
    : named;
  const entries = [...seats, ...row.fallbacks, ...(row.escalate?.target ? [row.escalate.target] : [])];
  return [...new Set(entries.filter((target) => target.includes('/')))];
}

/** Validate whether a target string exists cleanly inside a catalog when synced. */
export function inspectTargetAvailability(target: string, catalog?: CapabilitiesSnapshot): string | undefined {
  if (!catalog || !target.includes('/')) return undefined;
  const { providerInstanceId, modelId } = splitTarget(target);
  const hit = findCatalogModel(catalog, providerInstanceId, modelId!);
  if (!hit) return `provider ${providerInstanceId} not in T3 catalog`;
  if (isProviderDisabled(hit.provider)) return `provider ${providerInstanceId} is disabled`;
  if (!hit.model && !(hit.provider.omittedModels && hit.provider.omittedModels > 0)) {
    return `model ${modelId} not listed on ${providerInstanceId}`;
  }
  return undefined;
}
