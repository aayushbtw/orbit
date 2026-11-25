#!/usr/bin/env node
import { autocomplete, cancel, confirm, isCancel, log, multiselect, select, text } from '@clack/prompts';
import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyNpmUpdate,
  checkNpmUpdate,
  globalOrbitBin,
  inspectBundle,
  installBundle,
  isSemver,
  linkCheckout,
  pruneReleases,
  readPluginVersion,
  runGlobalOrbitInstall,
  uninstallBundle,
  unlinkCheckout,
  useRelease,
} from './bundle.js';
import {
  listCatalogTargets,
  modelEffortOption,
  readCapabilities,
  syncCapabilitiesFromFile,
  syncCapabilitiesFromT3,
  writeCapabilities,
  type CapabilitiesSnapshot,
} from './catalog.js';
import {
  deleteProfile,
  getEffectiveAssignments,
  listProfiles,
  loadConfig,
  loadConfigForHostWrite,
  normalizeTaskName,
  resetAssignments,
  saveConfig,
  saveProfile,
  setConfigHosts,
  setTaskAssignment,
  unsetTaskAssignment,
  useProfile,
  validateTarget,
  type EscalationRule,
  type OnAllFailedPolicy,
} from './config.js';
import {
  HOST_IDS,
  applyHost,
  inspectAllHosts,
  inspectHost,
  isExecutableOnPath,
  parseHostId,
  removeHost,
  resolveTargetHosts,
  type HostApplyResult,
  type HostContext,
  type HostId,
  type HostInspection,
} from './hosts.js';
import { applyProjectInit, detectProjectSetup } from './init.js';
import { projectRoot } from './paths.js';
import { inspectTargetAvailability, resolveTask, rowProviderTargets } from './resolve.js';

function resolveBundleDir(): string {
  const packaged = fileURLToPath(new URL('./plugin/', import.meta.url));
  if (existsSync(join(packaged, 'manifest.json'))) return packaged;
  const source = fileURLToPath(new URL('../../plugin/', import.meta.url));
  if (existsSync(join(source, 'manifest.json'))) return source;
  throw new Error(`Could not locate Orbit plugin bundle near ${import.meta.url}.`);
}

const home = homedir();
const bundle = resolveBundleDir();
const version = readPluginVersion(bundle);
const io = { input: process.stdin, output: process.stderr };

function requireTerminal(command: string): void {
  if (!io.input.isTTY || !io.output.isTTY) {
    throw new Error(`An interactive terminal is required. Use ${command}.`);
  }
}

function output(value: unknown, json: boolean | undefined, summary: () => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : summary());
}

function makeHostContext(env: NodeJS.ProcessEnv = process.env): HostContext {
  return { home, env, skillsDir: inspectBundle(home, version).skillsDir };
}

function syncHosts(ctx: HostContext, options: { all?: boolean } = {}): HostApplyResult[] {
  const targets = resolveTargetHosts(undefined, loadConfig(home).config.hosts, ctx, options);
  return targets.map((h) => applyHost(h, ctx));
}

function parseHostFlags(raw?: string[]): string[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.flatMap((entry) => entry.split(',')).map((s) => s.trim()).filter(Boolean);
}

function collectList(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

function parseOptionPairs(pairs?: string[]): Record<string, string | boolean> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  const out: Record<string, string | boolean> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new Error(`Invalid option "${pair}". Expected key=value.`);
    const key = pair.slice(0, eq).trim();
    const rawVal = pair.slice(eq + 1).trim();
    out[key] = rawVal === 'true' ? true : rawVal === 'false' ? false : rawVal;
  }
  return out;
}

function parseEscalateFlag(spec?: string): EscalationRule | undefined {
  if (!spec) return undefined;
  const colon = spec.indexOf(':');
  if (colon <= 0) throw new Error('Invalid --escalate value. Use <tries>:<target|effort=val|effort>.');
  const after = Number(spec.slice(0, colon));
  const rhs = spec.slice(colon + 1).trim();
  if (!Number.isInteger(after) || after < 1 || !rhs) {
    throw new Error('Invalid --escalate value. Use <positive-integer>:<target|effort=val|effort>.');
  }
  if (rhs.startsWith('effort=')) return { after, effort: rhs.slice('effort='.length).trim() };
  if (rhs.includes('/')) return { after, target: rhs };
  return { after, effort: rhs };
}

function tryLoadCatalog(homeDir: string, explicitPath?: string): CapabilitiesSnapshot | undefined {
  if (explicitPath) return syncCapabilitiesFromFile(explicitPath);
  try {
    const cached = readCapabilities(homeDir);
    if (cached) return cached;
  } catch {}
  if (process.env.T3_ACP_MCP_NODE) {
    try {
      const live = syncCapabilitiesFromT3(process.env);
      writeCapabilities(homeDir, live);
      return live;
    } catch {}
  }
  return undefined;
}

function formatEffectiveRows(state: ReturnType<typeof getEffectiveAssignments>): string {
  return state.rows
    .map(({ task, target, targetSource, effort, effortSource }) =>
      `${task}: ${target}${effort ? ` / ${effort}` : ''} (${targetSource}${effort && effortSource !== targetSource ? `; effort: ${effortSource}` : ''})`,
    )
    .join('\n');
}

function rulesMissing(h: HostInspection): boolean {
  return Boolean(h.rules && !h.rules.present && (h.status === 'registered' || h.status === 'stale'));
}

function formatHostLines(inspections: ReturnType<typeof inspectAllHosts>): string {
  return inspections
    .map((h) => `${h.host}${h.detected ? '' : ' (not detected)'}: ${h.detail}${rulesMissing(h) ? `; rules line missing from ${h.rules?.path}` : ''}`)
    .join('\n');
}

async function runInstall(options: { host?: string[]; all?: boolean; yes?: boolean; json?: boolean }, wizardMode: boolean) {
  const ctxBefore = makeHostContext();
  const bundleBefore = inspectBundle(home, version);
  const requested = parseHostFlags(options.host);
  const cfg = loadConfig(home).config;
  let targets = resolveTargetHosts(requested, cfg.hosts, ctxBefore, { all: options.all });

  if (!options.yes) {
    requireTerminal(`orbit ${wizardMode ? 'setup' : 'install'} --yes`);
    if (!bundleBefore.installed || bundleBefore.activeVersion !== version) {
      const approved = await confirm({
        ...io,
        message: `Install Orbit ${version} into ${bundleBefore.currentLink} and sync host registrations?`,
      });
      if (isCancel(approved) || !approved) {
        cancel('Setup cancelled.', { output: io.output });
        return;
      }
    }
    if (!requested && !options.all) {
      const selected = await multiselect({
        ...io,
        message: 'Which T3 providers should Orbit register skills with?',
        initialValues: targets,
        required: false,
        options: inspectAllHosts(ctxBefore).map((h) => ({
          value: h.host,
          label: `${h.displayName} (${h.host})`,
          hint: h.detected ? h.status : 'not detected on disk',
        })),
      });
      if (isCancel(selected)) {
        cancel('Setup cancelled.', { output: io.output });
        return;
      }
      targets = selected as HostId[];
    }
  }

  const preflightCtx = { ...ctxBefore, skillsDir: join(bundle, 'skills') };
  for (const hostId of targets) {
    const inspected = inspectHost(hostId, preflightCtx);
    if (inspected.status === 'invalid') {
      throw new Error(`Invalid ${inspected.displayName} config at ${inspected.path}: ${inspected.detail}`);
    }
  }

  // Persist user's explicit host selection if provided or interactively chosen; keep existing if unchanged.
  if (targets.length > 0 || requested || options.all || !options.yes) {
    setConfigHosts(home, targets);
  }

  const installed = installBundle(bundle, home, version);
  const ctxAfter = makeHostContext();
  const hostResults = targets.map((hostId) => applyHost(hostId, ctxAfter));

  let catalogSynced: { ok: boolean; source?: string; providers?: number; error?: string } = { ok: false };
  if (process.env.T3_ACP_MCP_NODE) {
    try {
      const snapshot = syncCapabilitiesFromT3(process.env);
      writeCapabilities(home, snapshot);
      catalogSynced = { ok: true, source: snapshot.source, providers: snapshot.providers.length };
    } catch (error) {
      catalogSynced = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (wizardMode && !options.yes) {
    const configureNow = await confirm({
      ...io,
      message: 'Configure model assignments per task now?',
      initialValue: false,
    });
    if (!isCancel(configureNow) && configureNow) {
      await editModels({});
    }
  }

  const antigravityCheck = inspectHost('antigravity', ctxAfter);
  const result = {
    host: targets[0] ?? 'antigravity',
    hosts: hostResults,
    version,
    installDir: join(installed.releaseRoot, 'plugin'),
    currentLink: installed.currentLink,
    action: hostResults.find((r) => r.host === 'antigravity')?.action ?? (hostResults[0]?.action ?? 'unchanged'),
    registration: {
      status: antigravityCheck.status,
      configPath: antigravityCheck.path,
      skillsDir: ctxAfter.skillsDir,
      filtered: Boolean(antigravityCheck.filtered),
      ...(antigravityCheck.stalePaths ? { stalePaths: antigravityCheck.stalePaths } : {}),
    },
    catalogSynced,
  };

  output(result, options.json, () => {
    const lines = [
      `Orbit ${version} installed at ${result.installDir} (current -> ${installed.releaseRoot})`,
      ...hostResults.map((r) => `${r.host}: ${r.detail}`),
    ];
    if (catalogSynced.ok) {
      lines.push(`Synced T3 capabilities (${catalogSynced.providers} providers)`);
    }
    lines.push('Start or reload a T3 thread to pick up the updated Orbit skills.');
    return lines.join('\n');
  });
}

async function editModels(options: { catalog?: string; project?: boolean }) {
  requireTerminal('orbit models set <task> <target>');
  const catalog = tryLoadCatalog(home, options.catalog);
  const projDir = options.project ? projectRoot() : undefined;
  const state = getEffectiveAssignments(home, projDir);

  const task = await select({
    ...io,
    message: `Which task or panel do you want to configure? (${options.project ? `project: ${state.project.root}` : `profile: ${state.activeProfile}`})`,
    options: [
      ...state.rows.map((row) => ({
        value: row.task,
        label: `${row.task}${row.kind !== 'task' ? ` [${row.kind}]` : ''}`,
        hint: `${row.target}${row.effort ? ` / ${row.effort}` : ''} (${row.targetSource === 'default' ? 'default' : 'override'})`,
      })),
      { value: '__new_work_type__', label: '+ Add a custom work type' },
    ],
  });
  if (isCancel(task)) return;

  const isNew = task === '__new_work_type__';
  const role = isNew
    ? await text({
      ...io,
      message: 'Name the work type (kebab-case)',
      validate: (value) => validateTarget(value?.trim() ?? '', ''),
    })
    : task;
  if (isCancel(role)) return;
  const name = normalizeTaskName(role.trim());
  const existingRow = state.rows.find((entry) => entry.task === name);

  const use = isNew
    ? await text({
      ...io,
      message: 'What kind of work should route to this model?',
      validate: (value) => (!value?.trim() || /[|\r\n\\]/.test(value) ? 'Enter a single-line description.' : undefined),
    })
    : undefined;
  if (isCancel(use)) return;

  const catalogTargets = listCatalogTargets(catalog);
  const existingTargets = state.rows
    .map((entry) => entry.userTarget)
    .filter((v) => v.includes('/') && !validateTarget(name, v));

  const choiceOptions: Array<{ value: string; label?: string; hint?: string }> = [];
  if (name === 'other-family') {
    const enabledProviders = (catalog?.providers ?? [])
      .filter((p) => !p.constraints?.some((c) => /disabled/i.test(c)) && p.canRunCrossProviderChildTask)
      .map((p) => p.providerInstanceId);
    if (enabledProviders.length > 0) {
      choiceOptions.push({
        value: enabledProviders.slice(0, 3).join(', '),
        label: `Auto-detected cross-provider roster (${enabledProviders.slice(0, 3).join(', ')})`,
      });
    }
    for (const t of catalogTargets) {
      choiceOptions.push({ value: t.target, label: t.target, hint: t.label ?? t.driverKind });
    }
    choiceOptions.push({ value: 'inherit', label: 'inherit (keep session family)' });
    choiceOptions.push({ value: '', label: 'Clear override (default)' });
    choiceOptions.push({ value: 'manual', label: 'Enter comma-separated providers or provider/model targets manually' });
  } else {
    choiceOptions.push({ value: 'inherit', label: 'inherit (use lead thread model)' });
    if (name === 'verifier') {
      choiceOptions.push(
        { value: 'other-family', label: 'other-family (require another model family, ask on failure)' },
        { value: 'other-family, inherit', label: 'other-family, inherit (fall back to lead family if all fail)' },
      );
    }
    const seen = new Set<string>();
    for (const item of catalogTargets) {
      if (seen.has(item.target)) continue;
      seen.add(item.target);
      choiceOptions.push({ value: item.target, label: item.target, hint: item.label ?? item.driverKind });
    }
    for (const target of existingTargets) {
      if (seen.has(target)) continue;
      seen.add(target);
      choiceOptions.push({ value: target, label: target, hint: 'existing config' });
    }
    choiceOptions.push({ value: '', label: 'Clear override (use default)' });
    choiceOptions.push({ value: 'manual', label: 'Enter provider/model manually' });
  }

  const choice = await autocomplete({
    ...io,
    message: `Model for ${name}`,
    options: choiceOptions,
  });
  if (isCancel(choice)) return;

  const target = choice !== 'manual'
    ? choice
    : await text({
      ...io,
      message: name === 'other-family' ? 'Ordered providers or provider/model targets' : 'Model target (provider/model)',
      initialValue: existingRow?.userTarget,
      validate: (value) => validateTarget(name, value?.trim() ?? ''),
    });
  if (isCancel(target)) return;
  const resolvedTarget = target.trim();

  let effort = '';
  if (resolvedTarget && !['other-family', 'other-family, inherit'].includes(resolvedTarget) && name !== 'interrogate' && name !== 'arena') {
    const matchedCatalog = catalogTargets.find((entry) => entry.target === resolvedTarget);
    const effortOpt = modelEffortOption(matchedCatalog ? { id: matchedCatalog.modelId, options: matchedCatalog.options } : undefined);
    const allowedEfforts = effortOpt?.values?.map(String) ?? ['low', 'medium', 'high', 'xhigh', 'max'];
    const pickedEffort = await select({
      ...io,
      message: `Effort for ${name}${effortOpt ? ` (${effortOpt.id})` : ''}`,
      initialValue: allowedEfforts.includes(existingRow?.userEffort ?? '') ? existingRow!.userEffort : '',
      options: [
        { value: '', label: 'Use provider default' },
        ...allowedEfforts.map((value) => ({ value })),
      ],
    });
    if (isCancel(pickedEffort)) return;
    effort = pickedEffort;
  }

  const targetScope = options.project ? `${state.project.root}/.orbit/config.json` : state.configPath;
  log.info(`${name}: ${existingRow?.userTarget || 'default'} -> ${resolvedTarget || 'default'}${effort ? ` (${effort})` : ''}\n${targetScope}`, { output: io.output });
  const approved = await confirm({ ...io, message: `Save to ${targetScope}?` });
  if (isCancel(approved) || !approved) return;

  const next = resolvedTarget === '' && !isNew
    ? unsetTaskAssignment(home, name, { projectDir: projDir })
    : setTaskAssignment(home, name, { target: resolvedTarget, effort, use: use?.trim() }, { projectDir: projDir, catalog });
  console.log(formatEffectiveRows(next));
}

function checkToolVersion(binary: string, args: string[] = ['--version']) {
  const path = process.env.PATH ?? '';
  if (!isExecutableOnPath(binary, path)) return { present: false as const };
  try {
    const raw = execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const firstLine = raw.split(/\r?\n/)[0] ?? '';
    return { present: true as const, version: firstLine };
  } catch {
    return { present: true as const, version: 'unknown' };
  }
}

const program = new Command()
  .name('orbit')
  .description('Install, update, and manage Orbit for T3 Code')
  .version(version);

program.command('setup')
  .description('Interactive setup: install Orbit bundle, register T3 hosts, and sync models')
  .option('--host <host>', 'host to register (repeatable or comma-separated)', collectList, [])
  .option('--all', 'register all supported hosts')
  .option('--yes', 'apply setup without prompts')
  .option('--json', 'print JSON')
  .action((opts) => runInstall(opts, true));

program.command('install')
  .description('Stage the Orbit bundle, flip current symlink, and register T3 hosts')
  .option('--host <host>', 'host to register (repeatable or comma-separated)', collectList, [])
  .option('--all', 'register all supported hosts')
  .option('--yes', 'apply install without prompts')
  .option('--json', 'print JSON')
  .action((opts) => runInstall(opts, false));

program.command('update [targetVersion]')
  .description('Check or install a newer (or the named) @aayushbtw/orbit release and update current symlink')
  .option('--to <version>', 'install a specific version instead of latest (same as [targetVersion])')
  .option('--check', 'only check whether a newer version is published')
  .option('--keep <n>', 'keep at most N installed releases after updating', (v) => Number(v), 3)
  .option('--yes', 'apply update without prompts')
  .option('--json', 'print JSON')
  .action(async (targetArg: string | undefined, options: { to?: string; check?: boolean; keep: number; yes?: boolean; json?: boolean }) => {
    const positional = targetArg?.trim().replace(/^v/, '');
    const flagged = options.to?.trim().replace(/^v/, '');
    if (positional && flagged && positional !== flagged) {
      throw new Error(`Conflicting target versions: ${positional} and --to ${flagged}. Pass one.`);
    }
    const requested = positional ?? flagged;
    if (requested !== undefined && !isSemver(requested)) {
      throw new Error(`Invalid target version "${requested}". Use a version such as 0.79.0.`);
    }
    const bundleState = inspectBundle(home, version);
    if (bundleState.linked && !requested && !options.check) {
      const result = {
        status: 'linked',
        currentLink: bundleState.currentLink,
        target: bundleState.currentRealPath,
        activeVersion: bundleState.activeVersion,
      };
      output(result, options.json, () =>
        `Orbit is linked to local checkout ${bundleState.currentRealPath} (v${bundleState.activeVersion ?? 'unknown'}). Run "orbit unlink" before updating to an npm release.`);
      return;
    }

    const check = requested
      ? { currentVersion: version, latestVersion: requested, updateAvailable: requested !== version }
      : checkNpmUpdate(version);

    if (options.check) {
      output(check, options.json, () =>
        check.updateAvailable
          ? `Update available: ${check.currentVersion} -> ${check.latestVersion}`
          : `Orbit ${check.currentVersion} is up to date.`);
      return;
    }

    if (!check.updateAvailable && bundleState.activeVersion === version && !bundleState.linked) {
      const pruned = pruneReleases(home, options.keep);
      const result = { ...check, updated: false, pruned };
      output(result, options.json, () => `Orbit ${version} is already current.`);
      return;
    }

    if (!options.yes) {
      requireTerminal(`orbit update${requested ? ` ${requested}` : ''} --yes`);
      const approved = await confirm({
        ...io,
        message: `Update Orbit from ${version} to ${check.latestVersion}?`,
      });
      if (isCancel(approved) || !approved) {
        cancel('Update cancelled.', { output: io.output });
        return;
      }
    }

    if (check.latestVersion !== version) {
      applyNpmUpdate(check.latestVersion);
      // The new global CLI stages its own bundle; PATH may still resolve an older orbit first.
      const installedJson = runGlobalOrbitInstall(globalOrbitBin());
      const pruned = pruneReleases(home, options.keep);
      const parsed = JSON.parse(installedJson) as Record<string, unknown>;
      const result = { ...check, updated: true, pruned, install: parsed };
      output(result, options.json, () => `Updated Orbit ${version} -> ${check.latestVersion} and synced current.`);
      return;
    }

    const res = installBundle(bundle, home, version);
    const pruned = pruneReleases(home, options.keep);
    const hosts = syncHosts(makeHostContext());
    const result = { ...check, updated: true, currentLink: res.currentLink, pruned, hosts };
    output(result, options.json, () => `Switched Orbit current to ${version}${pruned.length ? `; pruned ${pruned.join(', ')}` : ''}.`);
  });

program.command('use <version>')
  .description('Switch ~/.config/orbit/current to an already installed release version')
  .option('--json', 'print JSON')
  .action((targetVersion: string, options: { json?: boolean }) => {
    const clean = targetVersion.replace(/^v/, '');
    const switched = useRelease(home, clean);
    const hosts = syncHosts(makeHostContext());
    const result = { version: switched.version, currentLink: switched.currentLink, hosts };
    output(result, options.json, () => `Active Orbit version is now ${switched.version} (${switched.currentLink}).`);
  });

program.command('link [path]')
  .description('Point ~/.config/orbit/current at a local Orbit repo checkout for development')
  .option('--json', 'print JSON')
  .action((repoPath: string | undefined, options: { json?: boolean }) => {
    const linked = linkCheckout(home, repoPath ?? projectRoot());
    const hosts = syncHosts(makeHostContext());
    const result = { ...linked, hosts };
    output(result, options.json, () =>
      `Linked ${linked.currentLink} -> ${linked.repoPath} (v${linked.version}).\n${hosts.map((h) => `${h.host}: ${h.detail}`).join('\n')}`);
  });

program.command('unlink')
  .description('Restore ~/.config/orbit/current from a local checkout back to the latest release')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }) => {
    const res = unlinkCheckout(home, version);
    const hosts = res.activeVersion ? syncHosts(makeHostContext()) : [];
    const result = { ...res, hosts };
    output(result, options.json, () =>
      res.unlinked
        ? `Unlinked local checkout.${res.activeVersion ? ` Restored release ${res.activeVersion}.` : ''}`
        : 'Orbit is not currently linked to a local checkout.');
  });

program.command('uninstall')
  .description('Deregister Orbit from all hosts and remove installed Orbit releases')
  .option('--purge', 'also remove config.json, capabilities.json, models.md, and state/')
  .option('--yes', 'uninstall without confirmation')
  .option('--json', 'print JSON')
  .action(async (options: { purge?: boolean; yes?: boolean; json?: boolean }) => {
    if (!options.yes) {
      requireTerminal('orbit uninstall --yes');
      const approved = await confirm({
        ...io,
        message: `Remove Orbit host registrations and releases${options.purge ? ' (including config.json and state)' : ''}?`,
      });
      if (isCancel(approved) || !approved) {
        cancel('Uninstall cancelled.', { output: io.output });
        return;
      }
    }
    const ctx = makeHostContext();
    const removedHosts = HOST_IDS.map((h) => removeHost(h, ctx));
    const bundleRemoved = uninstallBundle(home, { purge: options.purge });
    const result = { hosts: removedHosts, ...bundleRemoved };
    output(result, options.json, () => [
      ...removedHosts.filter((h) => h.action !== 'unchanged').map((h) => `${h.host}: ${h.detail}`),
      bundleRemoved.removedCurrent ? 'Removed current symlink.' : 'No current symlink present.',
      bundleRemoved.removedReleases ? 'Removed staged releases.' : 'No staged releases present.',
      ...(bundleRemoved.purged ? ['Purged config, capabilities cache, and state.'] : []),
    ].join('\n'));
  });

program.command('status')
  .description('Show active Orbit bundle, registered hosts, catalog freshness, and effective models')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }) => {
    const bundleState = inspectBundle(home, version);
    const ctx = makeHostContext();
    const hosts = inspectAllHosts(ctx);
    const catalog = (() => {
      try { return readCapabilities(home); } catch { return undefined; }
    })();
    const modelsState = getEffectiveAssignments(home);
    const result = {
      packagedVersion: version,
      bundle: bundleState,
      hosts,
      activeProfile: modelsState.activeProfile,
      configSource: modelsState.source ?? null,
      ...(modelsState.legacyConfigError ? { legacyConfigError: modelsState.legacyConfigError } : {}),
      ...(modelsState.project.projectConfigError ? { projectConfigError: modelsState.project.projectConfigError } : {}),
      catalog: catalog
        ? { syncedAt: catalog.syncedAt, source: catalog.source, providerCount: catalog.providers.length }
        : null,
      models: modelsState.rows,
    };
    output(result, options.json, () => [
      `Orbit packaged: ${version} | active: ${bundleState.activeVersion ?? 'not installed'}${bundleState.linked ? ` (linked -> ${bundleState.currentRealPath})` : ''}`,
      `Releases: ${bundleState.releases.length ? bundleState.releases.join(', ') : 'none'}`,
      `Profile: ${modelsState.activeProfile} (${modelsState.source ?? 'defaults'})`,
      ...(modelsState.legacyConfigError ? [`Legacy config error: ${modelsState.legacyConfigError}`] : []),
      ...(modelsState.project.projectConfigError ? [`Project config error: ${modelsState.project.projectConfigError}`] : []),
      `Catalog: ${catalog ? `${catalog.providers.length} providers synced ${catalog.syncedAt}` : 'not synced (run "orbit models sync" in T3)'}`,
      'Hosts:',
      formatHostLines(hosts),
      'Effective models:',
      formatEffectiveRows(modelsState),
    ].join('\n'));
  });

program.command('doctor')
  .description('Diagnose bundle, hosts, config, catalog mismatches, and tools (--fix repairs drift)')
  .option('--fix', 'repair missing current symlink, migrate legacy models.md, and sync hosts and their rules lines')
  .option('--json', 'print JSON')
  .action((options: { fix?: boolean; json?: boolean }) => {
    const fixes: string[] = [];
    if (options.fix) {
      const before = inspectBundle(home, version);
      if (!before.installed || (!before.linked && before.activeVersion !== version)) {
        installBundle(bundle, home, version);
        fixes.push(`installed Orbit ${version} into ${before.currentLink}`);
      }
      const loaded = loadConfig(home);
      if (loaded.migratedFrom) {
        saveConfig(home, loaded.config);
        fixes.push(`migrated ${loaded.migratedFrom} to ~/.config/orbit/config.json`);
      }
      const ctxFix = makeHostContext();
      for (const hostId of resolveTargetHosts(undefined, loaded.config.hosts, ctxFix)) {
        const res = applyHost(hostId, ctxFix);
        if (res.action !== 'unchanged') fixes.push(`${hostId}: ${res.action}`);
      }
    }

    const bundleState = inspectBundle(home, version);
    const ctx = makeHostContext();
    const hosts = inspectAllHosts(ctx);
    const antigravity = hosts.find((h) => h.host === 'antigravity')!;
    const modelsState = getEffectiveAssignments(home);
    const catalog = (() => {
      try { return readCapabilities(home); } catch { return undefined; }
    })();

    const tools = {
      git: checkToolVersion('git'),
      node: checkToolVersion('node'),
      t3: process.env.T3CODE_CLI_PATH
        ? { present: true, path: process.env.T3CODE_CLI_PATH }
        : checkToolVersion('t3'),
    };

    const issues: string[] = [];
    if (!bundleState.installed) issues.push('Orbit bundle is not installed at ~/.config/orbit/current (run "orbit setup").');
    if (bundleState.installed && !bundleState.linked && bundleState.activeVersion !== version) {
      issues.push(`Active release (${bundleState.activeVersion}) differs from CLI (${version}).`);
    }
    for (const h of hosts) {
      if (h.detected && (h.status === 'stale' || h.status === 'invalid')) {
        issues.push(`${h.host}: ${h.detail}`);
      }
      if (rulesMissing(h)) {
        issues.push(`${h.host}: orbit rules line missing from ${h.rules?.path}`);
      }
    }
    if (modelsState.legacyConfigError) {
      issues.push(`legacy config: ${modelsState.legacyConfigError} (fix it, or run "orbit models set" or "orbit models reset" to write config.json)`);
    }
    if (modelsState.project.projectConfigError) {
      issues.push(`project config: ${modelsState.project.projectConfigError}`);
    }
    for (const row of modelsState.rows) {
      for (const target of rowProviderTargets(row)) {
        const err = inspectTargetAvailability(target, catalog);
        if (err) issues.push(`model ${row.task} (${target}): ${err}`);
      }
    }

    const result = {
      host: 'antigravity',
      version,
      installDir: bundleState.pluginDir,
      installed: bundleState.installed,
      linked: bundleState.linked,
      activeVersion: bundleState.activeVersion,
      registration: {
        status: antigravity.status,
        configPath: antigravity.path,
        skillsDir: ctx.skillsDir,
        filtered: Boolean(antigravity.filtered),
        ...(antigravity.stalePaths ? { stalePaths: antigravity.stalePaths } : {}),
      },
      hosts,
      tools,
      models: modelsState.rows,
      ...(modelsState.legacyConfigError ? { legacyConfigError: modelsState.legacyConfigError } : {}),
      ...(modelsState.project.projectConfigError ? { projectConfigError: modelsState.project.projectConfigError } : {}),
      catalogSynced: Boolean(catalog),
      fixes,
      issues,
      healthy: issues.length === 0,
    };

    output(result, options.json, () => [
      `Orbit ${version} | active: ${bundleState.activeVersion ?? 'not installed'}${bundleState.linked ? ` (linked -> ${bundleState.currentRealPath})` : ''}`,
      ...(fixes.length ? [`Fixes applied: ${fixes.join('; ')}`] : []),
      formatHostLines(hosts),
      formatEffectiveRows(modelsState),
      ...(issues.length ? [`Issues:\n- ${issues.join('\n- ')}`] : ['No issues found.']),
    ].join('\n'));
  });

const hostsCommand = program.command('hosts')
  .description('Inspect and manage Orbit registration across T3 providers')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }, cmd: Command) => {
    const ctx = makeHostContext();
    const list = inspectAllHosts(ctx);
    output(list, Boolean(options.json || cmd.optsWithGlobals().json), () => formatHostLines(list));
  });

hostsCommand.command('list')
  .description('Show host detection and registration status')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }, cmd: Command) => {
    const ctx = makeHostContext();
    const list = inspectAllHosts(ctx);
    output(list, Boolean(options.json || cmd.optsWithGlobals().json), () => formatHostLines(list));
  });

hostsCommand.command('enable <hosts...>')
  .description(`Enable and register Orbit for hosts (${HOST_IDS.join(', ')})`)
  .option('--json', 'print JSON')
  .action((rawHosts: string[], options: { json?: boolean }, cmd: Command) => {
    const targets = [...new Set(rawHosts.map(parseHostId))];
    const cfg = loadConfigForHostWrite(home).config;
    const ctx = makeHostContext();
    const results = targets.map((h) => applyHost(h, ctx));
    setConfigHosts(home, [...(cfg.hosts ?? []), ...targets]);
    output(results, Boolean(options.json || cmd.optsWithGlobals().json), () => results.map((r) => `${r.host}: ${r.detail}`).join('\n'));
  });

hostsCommand.command('disable <hosts...>')
  .description(`Remove Orbit registration for hosts (${HOST_IDS.join(', ')})`)
  .option('--json', 'print JSON')
  .action((rawHosts: string[], options: { json?: boolean }, cmd: Command) => {
    const targets = [...new Set(rawHosts.map(parseHostId))];
    const cfg = loadConfigForHostWrite(home).config;
    const remaining = (cfg.hosts ?? []).filter((h) => !targets.includes(h));
    setConfigHosts(home, remaining);
    const ctx = makeHostContext();
    const results = targets.map((h) => removeHost(h, ctx));
    output(results, Boolean(options.json || cmd.optsWithGlobals().json), () => results.map((r) => `${r.host}: ${r.detail}`).join('\n'));
  });

hostsCommand.command('sync')
  .description('Re-apply registration for configured and detected T3 hosts')
  .option('--all', 'register all supported hosts')
  .option('--json', 'print JSON')
  .action((options: { all?: boolean; json?: boolean }, cmd: Command) => {
    const results = syncHosts(makeHostContext(), { all: options.all });
    output(results, Boolean(options.json || cmd.optsWithGlobals().json), () => results.map((r) => `${r.host}: ${r.detail}`).join('\n'));
  });

const modelCommand = program.command('models')
  .description('Configure and resolve model-per-task assignments')
  .option('--catalog <file>', 'use a saved T3 capabilities JSON file')
  .option('--project', 'edit project-local .orbit/config.json overrides instead of user config')
  .action((options) => editModels(options));

modelCommand.command('list')
  .description('List effective model assignments for all tasks, panels, and work types')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }, cmd: Command) => {
    const state = getEffectiveAssignments(home);
    output(state.rows, Boolean(options.json || cmd.optsWithGlobals().json), () => formatEffectiveRows(state));
  });

modelCommand.command('explain [task]')
  .description('Show effective model assignments and their sources')
  .option('--json', 'print JSON')
  .action((taskArg: string | undefined, options: { json?: boolean }, cmd: Command) => {
    const state = getEffectiveAssignments(home);
    const rows = taskArg ? state.rows.filter((r) => r.task === normalizeTaskName(taskArg)) : state.rows;
    if (taskArg && rows.length === 0) throw new Error(`Unknown task or work type "${taskArg}".`);
    output(taskArg ? rows[0] : rows, Boolean(options.json || cmd.optsWithGlobals().json), () =>
      rows.map(({ task, target, targetSource, effort, effortSource }) =>
        `${task}: ${target}${effort ? ` / ${effort}` : ''} (${targetSource}${effort && effortSource !== targetSource ? `; effort: ${effortSource}` : ''})`).join('\n'));
  });

modelCommand.command('set <task> <target>')
  .description('Set a task, panel, or work-type model assignment (use "" to clear)')
  .option('--effort <effort>', 'low, medium, high, xhigh, max, or a value the target model lists')
  .option('--option <k=v>', 'provider option pair (repeatable)', collectList, [])
  .option('--fallback <targets>', 'comma-separated fallback provider/model targets')
  .option('--escalate <spec>', 'escalate after failures: <tries>:<target|effort=val|effort>')
  .option('--on-all-failed <policy>', 'verifier fallback policy: ask, inherit, or hold')
  .option('--judge <seat>', 'arena judge: role name, other-family, or <provider>/<model>[@effort]')
  .option('--use <description>', 'describe what work uses this custom work type')
  .option('--project', 'write override to <repo>/.orbit/config.json instead of user config')
  .option('--json', 'print JSON')
  .action((
    task: string,
    target: string,
    options: {
      effort?: string;
      option?: string[];
      fallback?: string;
      escalate?: string;
      onAllFailed?: string;
      judge?: string;
      use?: string;
      project?: boolean;
      json?: boolean;
    },
    cmd: Command,
  ) => {
    const globals = cmd.optsWithGlobals();
    const isProject = Boolean(options.project || globals.project);
    const isJson = Boolean(options.json || globals.json);
    const onAllFailed = options.onAllFailed as OnAllFailedPolicy | undefined;
    if (onAllFailed && !['ask', 'inherit', 'hold'].includes(onAllFailed)) {
      throw new Error('--on-all-failed must be ask, inherit, or hold.');
    }
    const fallbacks = options.fallback
      ? options.fallback.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const catalog = tryLoadCatalog(home);
    const next = setTaskAssignment(
      home,
      task,
      {
        target: target.trim(),
        ...(options.effort !== undefined ? { effort: options.effort.trim() } : {}),
        ...(options.option?.length ? { options: parseOptionPairs(options.option) } : {}),
        ...(fallbacks ? { fallbacks } : {}),
        ...(options.escalate ? { escalate: parseEscalateFlag(options.escalate) } : {}),
        ...(onAllFailed ? { onAllFailed } : {}),
        ...(options.judge ? { judge: options.judge.trim() } : {}),
        ...(options.use !== undefined ? { use: options.use.trim() } : {}),
      },
      { projectDir: isProject ? projectRoot() : undefined, catalog },
    );
    output(next.rows, isJson, () => formatEffectiveRows(next));
  });

modelCommand.command('unset <task>')
  .description('Clear a task, panel, or work-type override')
  .option('--project', 'clear override from <repo>/.orbit/config.json')
  .option('--json', 'print JSON')
  .action((task: string, options: { project?: boolean; json?: boolean }, cmd: Command) => {
    const globals = cmd.optsWithGlobals();
    const isProject = Boolean(options.project || globals.project);
    const next = unsetTaskAssignment(home, task, { projectDir: isProject ? projectRoot() : undefined });
    output(next.rows, Boolean(options.json || globals.json), () => formatEffectiveRows(next));
  });

modelCommand.command('reset')
  .description('Reset active profile (or --project overrides) back to inherit defaults')
  .option('--project', 'reset <repo>/.orbit/config.json instead of user profile')
  .option('--yes', 'reset without confirmation')
  .option('--json', 'print JSON')
  .action(async (options: { project?: boolean; yes?: boolean; json?: boolean }, cmd: Command) => {
    const globals = cmd.optsWithGlobals();
    const isProject = Boolean(options.project || globals.project);
    if (!options.yes) {
      requireTerminal(`orbit models reset${isProject ? ' --project' : ''} --yes`);
      const approved = await confirm({
        ...io,
        message: `Reset all model overrides in ${isProject ? 'project .orbit/config.json' : 'active user profile'}?`,
      });
      if (isCancel(approved) || !approved) {
        cancel('Reset cancelled.', { output: io.output });
        return;
      }
    }
    const next = resetAssignments(home, { projectDir: isProject ? projectRoot() : undefined });
    output(next.rows, Boolean(options.json || globals.json), () => formatEffectiveRows(next));
  });

modelCommand.command('sync')
  .description('Sync T3 orchestrator_capabilities into ~/.config/orbit/capabilities.json')
  .option('--from <file>', 'read capabilities JSON from file path or "-" for stdin')
  .option('--json', 'print JSON')
  .action((options: { from?: string; json?: boolean }, cmd: Command) => {
    const snapshot = options.from
      ? syncCapabilitiesFromFile(options.from, options.from === '-' ? readFileSync(0, 'utf8') : undefined)
      : syncCapabilitiesFromT3(process.env);
    const savedAt = writeCapabilities(home, snapshot);
    const enabled = snapshot.providers.filter((p) => !p.constraints?.some((c) => /disabled/i.test(c)));
    const result = {
      path: savedAt,
      syncedAt: snapshot.syncedAt,
      source: snapshot.source,
      providerCount: snapshot.providers.length,
      enabledProviders: enabled.map((p) => p.providerInstanceId),
      inherited: snapshot.inheritedProviderInstanceId
        ? `${snapshot.inheritedProviderInstanceId}/${snapshot.inheritedModel ?? ''}`
        : null,
    };
    output(result, Boolean(options.json || cmd.optsWithGlobals().json), () =>
      `Synced ${result.providerCount} providers (${result.enabledProviders.length} enabled: ${result.enabledProviders.join(', ')}) to ${savedAt}.`);
  });

modelCommand.command('resolve <task>')
  .description('Resolve a task, work type, or panel into exact T3 delegate_task targets')
  .option('--lead <provider/model>', 'current lead provider/model override')
  .option('--tries <n>', 'failed attempt count for escalation', (v) => Number(v), 0)
  .option('--runtime-mode <mode>', 'parent runtimeMode requirement')
  .option('--work-type <name>', 'work-type name when task is code')
  .option('--json', 'print JSON')
  .action((task: string, options: { lead?: string; tries: number; runtimeMode?: string; workType?: string; json?: boolean }, cmd: Command) => {
    if (!Number.isInteger(options.tries) || options.tries < 0) {
      throw new Error('--tries must be a non-negative integer.');
    }
    const resolved = resolveTask({
      task,
      workType: options.workType,
      lead: options.lead,
      tries: options.tries,
      runtimeMode: options.runtimeMode,
      home,
      projectDir: projectRoot(),
    });
    output(resolved, Boolean(options.json || cmd.optsWithGlobals().json), () => {
      if (resolved.mode === 'panel') {
        return `${resolved.task}: ${JSON.stringify(resolved.seats)}`;
      }
      if (resolved.target) {
        const optsText = resolved.target.options.map((o) => `${o.id}=${String(o.value)}`).join(',');
        return `${resolved.task} -> ${resolved.target.providerInstanceId}/${resolved.target.model}${optsText ? ` (${optsText})` : ''} [${resolved.mode}]`;
      }
      return `${resolved.task} -> ${resolved.mode}${resolved.alias ? ` (${resolved.alias})` : ''}`;
    });
  });

const profileCommand = program.command('profile')
  .description('Manage named model-routing profiles in ~/.config/orbit/config.json')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }, cmd: Command) => {
    const profiles = listProfiles(home);
    output(profiles, Boolean(options.json || cmd.optsWithGlobals().json), () =>
      profiles.map((p) => `${p.active ? '* ' : '  '}${p.name} (${p.taskCount} tasks, ${p.panelCount} panels, ${p.workTypeCount} work types)`).join('\n'));
  });

profileCommand.command('list')
  .description('List available profiles')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }, cmd: Command) => {
    const profiles = listProfiles(home);
    output(profiles, Boolean(options.json || cmd.optsWithGlobals().json), () =>
      profiles.map((p) => `${p.active ? '* ' : '  '}${p.name} (${p.taskCount} tasks, ${p.panelCount} panels, ${p.workTypeCount} work types)`).join('\n'));
  });

profileCommand.command('show [name]')
  .description('Show assignments inside a profile (defaults to active profile)')
  .option('--json', 'print JSON')
  .action((name: string | undefined, options: { json?: boolean }, cmd: Command) => {
    const { config } = loadConfig(home);
    const targetName = name ?? config.activeProfile;
    const profile = config.profiles[targetName];
    if (!profile) throw new Error(`Profile "${targetName}" does not exist.`);
    output({ name: targetName, active: targetName === config.activeProfile, ...profile }, Boolean(options.json || cmd.optsWithGlobals().json), () =>
      JSON.stringify(profile, null, 2));
  });

profileCommand.command('use <name>')
  .description('Switch active profile')
  .option('--json', 'print JSON')
  .action((name: string, options: { json?: boolean }, cmd: Command) => {
    const next = useProfile(home, name);
    output({ activeProfile: next.activeProfile }, Boolean(options.json || cmd.optsWithGlobals().json), () => `Active profile: ${next.activeProfile}`);
  });

profileCommand.command('save <name>')
  .description('Save current (or --from) profile under a new name')
  .option('--from <profile>', 'source profile to copy')
  .option('--no-activate', 'do not switch activeProfile to the saved profile')
  .option('--json', 'print JSON')
  .action((name: string, options: { from?: string; activate?: boolean; json?: boolean }, cmd: Command) => {
    const next = saveProfile(home, name, { from: options.from, activate: options.activate });
    output({ name, activeProfile: next.activeProfile }, Boolean(options.json || cmd.optsWithGlobals().json), () =>
      `Saved profile "${name}"${next.activeProfile === name ? ' (active)' : ''}.`);
  });

profileCommand.command('delete <name>')
  .description('Delete an inactive profile')
  .option('--json', 'print JSON')
  .action((name: string, options: { json?: boolean }, cmd: Command) => {
    const next = deleteProfile(home, name);
    output({ deleted: name, activeProfile: next.activeProfile }, Boolean(options.json || cmd.optsWithGlobals().json), () => `Deleted profile "${name}".`);
  });

program.command('init')
  .description('Initialize Orbit Workflow settings in the current project repository')
  .option('--check <command>', 'Check command for ## Workflow in AGENTS.md')
  .option('--land <mode>', 'Landing mode: pr or main')
  .option('--config', 'also scaffold .orbit/config.json for project model overrides')
  .option('--force', 'overwrite existing ## Workflow block or .orbit/config.json')
  .option('--yes', 'write without confirmation')
  .option('--json', 'print JSON')
  .action(async (options: { check?: string; land?: string; config?: boolean; force?: boolean; yes?: boolean; json?: boolean }) => {
    if (options.land && options.land !== 'pr' && options.land !== 'main') {
      throw new Error('--land must be "pr" or "main".');
    }
    const detected = detectProjectSetup();
    const check = options.check ?? detected.checkCommand;
    const land = (options.land as 'pr' | 'main' | undefined) ?? detected.landMode;

    if (!options.yes) {
      requireTerminal('orbit init --yes');
      const approved = await confirm({
        ...io,
        message: `Update ${join(detected.root, 'AGENTS.md')} (Check: ${check}, Land: ${land})${options.config ? ' and create .orbit/config.json' : ''}?`,
      });
      if (isCancel(approved) || !approved) {
        cancel('Init cancelled.', { output: io.output });
        return;
      }
    }

    const res = applyProjectInit(detected.root, {
      check,
      land,
      createConfig: options.config,
      force: options.force,
    });
    output(res, options.json, () => [
      res.updatedAgents ? `Updated ${res.agentsPath} (Check: ${res.check}, Land: ${res.land})` : `Kept existing ## Workflow in ${res.agentsPath}`,
      ...(res.createdConfig ? [`Created ${res.configPath}`] : []),
    ].join('\n'));
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
