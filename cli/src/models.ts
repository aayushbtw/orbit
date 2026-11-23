import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const defaults = {
  code: { use: 'Code changes', model: 'inherit' },
  advisor: { use: 'Planning and tradeoffs', model: 'agent default' },
  writing: { use: 'Writing and documentation units', model: '' },
  judgment: { use: 'Judgment, prose, and difficult changes', model: 'opus' },
  verifier: { use: 'Pre-land verification', model: 'agent default' },
  gitops: { use: 'Git operations', model: 'agent default' },
  'other-family': { use: 'Panel seat on another family', model: 'session family' },
};

const header = '| Task | Use for | Model | Effort |';
const separator = '| --- | --- | --- | --- |';
const rolePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const targetPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:@+/-]+$/;
const aliases = ['inherit', 'opus', 'sonnet', 'haiku', 'fable'];
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
type Row = { task: string; use: string; model: string; effort: string };

function cells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function table(lines: string[]) {
  const start = lines.findIndex((line, index) => {
    const labels = cells(line);
    const divider = cells(lines[index + 1] ?? '');
    return labels.join('|') === 'Task|Use for|Model|Effort'
      && divider.length === 4 && divider.every((cell) => /^:?-{3,}:?$/.test(cell));
  });
  const rows = new Map<string, Row & { index: number }>();
  let end = start + 2;
  if (start >= 0) {
    for (; end < lines.length; end++) {
      const parts = cells(lines[end]);
      if (parts.length !== 4 || !rolePattern.test(parts[0])) break;
      const [task, use, model, effort] = parts;
      if (rows.has(task)) throw new Error(`Duplicate Models row: ${task}`);
      rows.set(task, { task, use, model, effort, index: end });
    }
  }
  return { start, end, rows };
}

function projectModels(dir: string) {
  const lines = (readOptional(join(dir, 'AGENTS.md')) ?? '').split(/\r?\n/);
  const workflow = lines.findIndex((line) => /^## Workflow\s*$/.test(line));
  if (workflow < 0) return table([]);
  const section = lines.slice(workflow + 1);
  const end = section.findIndex((line) => /^#{1,2}\s/.test(line));
  const block = end < 0 ? section : section.slice(0, end);
  const models = block.findIndex((line) => /^### Models\s*$/.test(line));
  if (models < 0) return table([]);
  const modelBlock = block.slice(models + 1);
  const modelEnd = modelBlock.findIndex((line) => /^###\s/.test(line));
  return table(modelEnd < 0 ? modelBlock : modelBlock.slice(0, modelEnd));
}

export function readOptional(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function projectRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

export function modelPaths(home: string) {
  return {
    config: join(home, '.config', 'orbit', 'models.md'),
    legacy: join(home, '.claude', 'rules', 'orbit-models.md'),
  };
}

export function models(home: string) {
  const { config, legacy } = modelPaths(home);
  const current = readOptional(config);
  const inherited = current === undefined ? readOptional(legacy) : undefined;
  const source = current !== undefined ? config : inherited !== undefined ? legacy : undefined;
  const userText = current ?? inherited ?? '';
  const user = table(userText.split(/\r?\n/)).rows;
  const root = projectRoot();
  const project = projectModels(root).rows;
  const tasks = new Set([...Object.keys(defaults), ...user.keys(), ...project.keys()]);
  return {
    config,
    legacy,
    source,
    userText,
    rows: [...tasks].map((task) => {
      const fallback = defaults[task as keyof typeof defaults];
      const local = project.get(task);
      const personal = user.get(task);
      return {
        task,
        use: local?.use || personal?.use || fallback?.use || task,
        model: local?.model || personal?.model || fallback?.model || 'code / judgment routing',
        modelSource: local?.model ? join(root, 'AGENTS.md') : personal?.model ? source : 'default',
        effort: local?.effort || personal?.effort || '',
        effortSource: local?.effort ? join(root, 'AGENTS.md') : personal?.effort ? source : 'default',
        userModel: personal?.model ?? '',
        userEffort: personal?.effort ?? '',
      };
    }),
  };
}

function singleModel(value: string) {
  return aliases.includes(value) || targetPattern.test(value);
}

export function validateModel(task: string, value: string) {
  if (!rolePattern.test(task)) return 'Use a kebab-case role name.';
  if (value === '' || singleModel(value)) return;
  if (task === 'verifier' && ['other-family', 'other-family, inherit'].includes(value)) return;
  if (task === 'other-family') {
    const entries = value.split(',').map((entry) => entry.trim());
    const providers = entries.filter((entry) => entry !== 'inherit').map((entry) => entry.split('/')[0]);
    if (entries.every((entry, index) => entry === 'inherit'
      ? index === entries.length - 1
      : targetPattern.test(entry) || /^[a-zA-Z0-9_.-]+$/.test(entry))
      && new Set(providers).size === providers.length) return;
    return 'Use unique provider or provider/model entries, with optional inherit at the end.';
  }
  const retry = value.match(/^(.+), (.+) after ([1-9][0-9]*) failed tries$/);
  if (!Object.hasOwn(defaults, task) || task === 'writing') {
    if (retry && singleModel(retry[1]) && singleModel(retry[2])) return;
  }
  return 'Use provider/model or a supported model alias.';
}

export function updateModel(home: string, task: string, model: string, options: { use?: string; effort?: string }, expected?: ReturnType<typeof models>) {
  const error = validateModel(task, model);
  if (error) throw new Error(error);
  if (options.effort && !efforts.includes(options.effort)) throw new Error(`Choose effort from ${efforts.join(', ')}.`);
  if (options.use !== undefined && (!options.use.trim() || /[|\r\n\\]/.test(options.use))) {
    throw new Error('Use-for must be a nonempty, single-line table cell.');
  }

  const { config } = modelPaths(home);
  mkdirSync(dirname(config), { recursive: true });
  const lock = `${config}.lock`;
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another model update is in progress at ${lock}.`);
    throw error;
  }
  const temporary = join(lock, 'models.md');
  try {
    const current = models(home);
    if (expected && (expected.source !== current.source || expected.userText !== current.userText)) {
      throw new Error('The Models file changed. Reopen the picker and review the new values.');
    }
    const { userText } = current;
    const newline = userText.includes('\r\n') ? '\r\n' : '\n';
    const lines = userText ? userText.split(/\r?\n/) : [];
    const existing = table(lines);
    const row = existing.rows.get(task);
    const use = options.use ?? row?.use ?? defaults[task as keyof typeof defaults]?.use ?? task;
    const effort = options.effort ?? row?.effort ?? '';
    const target = task === 'other-family' ? model.split(',').map((entry) => entry.trim()).join(', ') : model;
    const line = `| ${task} | ${use} | ${target} | ${effort} |`;
    if (row) {
      lines[row.index] = line;
    } else if (existing.start >= 0) {
      lines.splice(existing.end, 0, line);
    } else {
      if (lines.length && lines.at(-1) !== '') lines.push('');
      lines.push(header, separator, line);
    }
    if (lines.at(-1) !== '') lines.push('');
    const next = lines.join(newline);
    if (current.source !== config || next !== userText) {
      writeFileSync(temporary, next, { mode: 0o600 });
      renameSync(temporary, config);
    }
    return models(home);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

export function catalogModels(path?: string) {
  if (!path) return [];
  const content = readFileSync(path, 'utf8');
  const result = JSON.parse(content);
  if (!Array.isArray(result?.providers)) throw new Error('Expected a T3 capabilities JSON object with a providers array.');
  const targets = new Set<string>();
  for (const provider of result.providers) {
    if (provider?.constraints?.includes('Provider instance is disabled.') || !Array.isArray(provider?.models)) continue;
    if (typeof provider.providerInstanceId !== 'string') continue;
    for (const model of provider.models) {
      const target = `${provider.providerInstanceId}/${model?.id}`;
      if (typeof model?.id === 'string' && targetPattern.test(target)) targets.add(target);
    }
  }
  return [...targets];
}
