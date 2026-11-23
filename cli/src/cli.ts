#!/usr/bin/env node
import { autocomplete, cancel, confirm, isCancel, log, select, text } from '@clack/prompts';
import { Command } from 'commander';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogModels, models, updateModel, validateModel } from './models.js';

const home = homedir();
const bundle = fileURLToPath(new URL('./plugin/', import.meta.url));
const { version } = JSON.parse(readFileSync(join(bundle, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string };
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid Orbit version in packaged bundle.');
const installDir = join(home, '.config', 'orbit', 'releases', version, 'plugin');
const skillsDir = join(installDir, 'skills');
const registrationModule = join(bundle, 'skills', 'setup', 'scripts', 'antigravity-skills.mjs');
const registration: typeof import('../../plugin/skills/setup/scripts/antigravity-skills.mjs') =
  await import(pathToFileURL(registrationModule).href);
const host = 'antigravity';
const configPath = registration.defaultConfigPath(home);
const io = { input: process.stdin, output: process.stderr };

function requireTerminal(command: string) {
  if (!io.input.isTTY || !io.output.isTTY) {
    throw new Error(`An interactive terminal is required. Use ${command}.`);
  }
}

function output(value: unknown, json: boolean | undefined, summary: () => string) {
  console.log(json ? JSON.stringify(value, null, 2) : summary());
}

function resolvedModels(state: ReturnType<typeof models>) {
  return state.rows.map(({ task, model, modelSource, effort, effortSource }) =>
    `${task}: ${model}${effort ? ` / ${effort}` : ''} (${modelSource}${effort && effortSource !== modelSource ? `; effort: ${effortSource}` : ''})`,
  ).join('\n');
}

function installed() {
  return existsSync(join(skillsDir, 'start', 'SKILL.md'));
}

function install() {
  if (installed()) return;
  const release = dirname(installDir);
  mkdirSync(release, { recursive: true });
  const stage = mkdtempSync(join(release, '.install-'));
  try {
    cpSync(bundle, stage, { recursive: true });
    try {
      renameSync(stage, installDir);
    } catch (error) {
      if (!installed()) throw error;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function inspect() {
  return registration.inspectSkillsConfig({ skillsDir, configPath, home });
}

async function setup(options: { host?: string; yes?: boolean; json?: boolean }) {
  if (options.host && options.host !== host) throw new Error(`Standalone setup currently supports --host ${host}.`);
  const before = inspect();
  if (before.status === 'invalid') throw new Error(registration.formatCheckStatus(before));
  if (!options.yes && (!installed() || before.status !== 'registered')) {
    requireTerminal(`orbit setup --host ${host} --yes`);
    const approved = await confirm({
      ...io,
      message: `Install Orbit ${version} at ${installDir} and register it in ${configPath}?`,
    });
    if (isCancel(approved) || !approved) {
      cancel('Setup cancelled.', { output: io.output });
      return;
    }
  }
  install();
  const change = registration.applySkillsRegistration({ skillsDir, configPath, home });
  const result = { host, version, installDir, action: change.action, registration: inspect() };
  output(result, options.json, () =>
    `Orbit ${version} installed at ${installDir}\n${registration.formatCheckStatus(result.registration)}\nStart a new T3 session on Antigravity and open the Orbit start skill.`,
  );
}

async function editModels(options: { catalog?: string }) {
  requireTerminal('orbit models set <role> <model>');
  const catalog = catalogModels(options.catalog);
  const state = models(home);
  const task = await select({
    ...io,
    message: 'Which role do you want to configure?',
    options: [
      ...state.rows.map((row) => ({ value: row.task, label: row.task, hint: row.model })),
      { value: '', label: 'Add a work type' },
    ],
  });
  if (isCancel(task)) return;

  const role = task || await text({
    ...io,
    message: 'Name the work type',
    validate: (value) => validateModel(value?.trim() ?? '', ''),
  });
  if (isCancel(role)) return;
  const name = role.trim();
  const row = state.rows.find((entry) => entry.task === name);
  const use = row ? undefined : await text({
    ...io,
    message: 'What work should use this model?',
    validate: (value) => !value?.trim() || /[|\r\n\\]/.test(value) ? 'Enter a single-line description.' : undefined,
  });
  if (isCancel(use)) return;

  const targets = [...new Set([...catalog, ...state.rows.map((entry) => entry.userModel)])]
    .filter((value) => value.includes('/') && !validateModel(name, value));
  const choice = await autocomplete({
    ...io,
    message: `Model for ${name}`,
    options: [
      ...targets.map((value) => ({ value })),
      ...['inherit', ...(name === 'other-family' ? [] : ['opus', 'sonnet', 'haiku', 'fable'])].map((value) => ({ value })),
      ...(name === 'verifier' ? [
        { value: 'other-family', label: 'Use the other-family seat' },
        { value: 'other-family, inherit', label: 'Use the other-family seat with native fallback' },
      ] : []),
      { value: '', label: 'Use default' },
      { value: 'manual', label: 'Enter a model or provider ID manually' },
    ],
  });
  if (isCancel(choice)) return;

  const target = choice !== 'manual' ? choice : await text({
    ...io,
    message: name === 'other-family' ? 'Ordered providers or provider/model targets' : 'Model ID (provider/model)',
    initialValue: row?.userModel,
    validate: (value) => validateModel(name, value?.trim() ?? ''),
  });
  if (isCancel(target)) return;
  const model = target.trim();
  const effort = await select({
    ...io,
    message: `Effort for ${name}`,
    initialValue: row?.userEffort || '',
    options: [
      { value: '', label: 'Use default' },
      ...['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value })),
    ],
  });
  if (isCancel(effort)) return;
  log.info(`${name}: ${row?.userModel || 'default'} → ${model || 'default'}, effort ${row?.userEffort || 'default'} → ${effort || 'default'}\n${state.config}`, { output: io.output });
  const approved = await confirm({ ...io, message: 'Save these user-wide settings?' });
  if (isCancel(approved) || !approved) return;
  const next = updateModel(home, name, model, { use: use?.trim(), effort }, state);
  console.log(resolvedModels(next));
}

const program = new Command()
  .name('orbit')
  .description('Set up and configure Orbit for T3 Code')
  .version(version);

program.command('setup')
  .description('Install Orbit and register its skills with the host')
  .option('--host <host>', 'host to register')
  .option('--yes', 'apply setup without a prompt')
  .option('--json', 'print JSON')
  .action(setup);

const modelCommand = program.command('models')
  .description('Interactively configure which models Orbit uses for each role')
  .option('--catalog <file>', 'use a saved T3 capabilities JSON response for model search')
  .action(editModels);

modelCommand.command('set <role> <model>')
  .description('Set a user-wide role assignment (use an empty model to clear it)')
  .option('--effort <effort>', 'effort level (use an empty value to clear it)')
  .option('--use <description>', 'describe the work this role covers')
  .option('--json', 'print JSON')
  .action((task: string, model: string, options: { use?: string; effort?: string; json?: boolean }) => {
    const next = updateModel(home, task, model.trim(), options);
    output(next.rows, options.json, () => resolvedModels(next));
  });

modelCommand.command('explain')
  .description('Show effective model assignments and their sources')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }) => {
    const state = models(home);
    output(state.rows, options.json, () => resolvedModels(state));
  });

program.command('doctor')
  .description('Check the installed bundle, host registration, and effective assignments')
  .option('--json', 'print JSON')
  .action((options: { json?: boolean }) => {
    const state = models(home);
    const result = { host, version, installDir, installed: installed(), registration: inspect(), models: state.rows };
    output(result, options.json, () => [
      `Orbit ${version} ${result.installed ? 'installed' : 'not installed'} at ${installDir}`,
      registration.formatCheckStatus(result.registration),
      resolvedModels(state),
    ].join('\n'));
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
