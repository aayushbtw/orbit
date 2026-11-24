import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot, readOptional, writeFileAtomic } from './paths.js';

export interface DetectedProjectSetup {
  root: string;
  inGitRepo: boolean;
  hasWorkflowBlock: boolean;
  hasAgentsFile: boolean;
  hasOrbitConfig: boolean;
  checkCommand: string;
  landMode: 'pr' | 'main';
}

function detectPackageManager(root: string): 'bun' | 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/** Detect Check command and Land mode for a repository root. */
export function detectProjectSetup(dir = process.cwd()): DetectedProjectSetup {
  const root = projectRoot(dir);
  let inGitRepo = false;
  let hasOrigin = false;
  try {
    inGitRepo = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() === 'true';
    if (inGitRepo) {
      execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      hasOrigin = true;
    }
  } catch {}

  const agentsPath = join(root, 'AGENTS.md');
  const agentsText = readOptional(agentsPath);
  const hasAgentsFile = agentsText !== undefined;
  const hasWorkflowBlock = agentsText !== undefined && /^## Workflow\s*$/m.test(agentsText);
  const hasOrbitConfig = existsSync(join(root, '.orbit', 'config.json'));

  let checkCommand = 'vpr check';
  const pkgRaw = readOptional(join(root, 'package.json'));
  if (pkgRaw !== undefined) {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      const pm = detectPackageManager(root);
      const runPrefix = pm === 'pnpm' || pm === 'yarn' ? pm : `${pm} run`;
      if (scripts.check) {
        checkCommand = `${runPrefix} check`;
      } else if (scripts.test && scripts.build) {
        checkCommand = `${runPrefix} build && ${pm === 'bun' ? 'bun test' : `${runPrefix} test`}`;
      } else if (scripts.test) {
        checkCommand = pm === 'bun' ? 'bun test' : `${runPrefix} test`;
      } else if (scripts.build) {
        checkCommand = `${runPrefix} build`;
      }
    } catch {}
  } else {
    const makefile = readOptional(join(root, 'Makefile'));
    if (makefile !== undefined) {
      if (/^check:/m.test(makefile)) checkCommand = 'make check';
      else if (/^test:/m.test(makefile)) checkCommand = 'make test';
    } else if (existsSync(join(root, 'Cargo.toml'))) {
      checkCommand = 'cargo test';
    } else if (existsSync(join(root, 'pyproject.toml'))) {
      checkCommand = 'pytest';
    }
  }

  return {
    root,
    inGitRepo,
    hasWorkflowBlock,
    hasAgentsFile,
    hasOrbitConfig,
    checkCommand,
    landMode: hasOrigin ? 'pr' : 'main',
  };
}

/** Write a Workflow block into AGENTS.md and optionally scaffold .orbit/config.json. */
export function applyProjectInit(
  dir: string,
  options: { check?: string; land?: 'pr' | 'main'; createConfig?: boolean; force?: boolean } = {},
) {
  const detected = detectProjectSetup(dir);
  const check = options.check ?? detected.checkCommand;
  const land = options.land ?? detected.landMode;
  const agentsPath = join(detected.root, 'AGENTS.md');
  const existingAgents = readOptional(agentsPath) ?? '';
  let updatedAgents = false;

  if (!detected.hasWorkflowBlock || options.force) {
    const blockLines = [
      '## Workflow',
      '',
      `- Check: \`${check}\`.`,
      `- Land: ${land}`,
      '',
    ].join('\n');

    if (detected.hasWorkflowBlock && options.force) {
      const nextAgents = existingAgents.replace(
        /^## Workflow[ \t]*\r?\n[\s\S]*?(?=\r?\n##\s|(?![\s\S]))/m,
        blockLines,
      );
      writeFileAtomic(agentsPath, nextAgents.endsWith('\n') ? nextAgents : `${nextAgents}\n`, 0o644);
    } else {
      const separator = existingAgents.length > 0 && !existingAgents.endsWith('\n') ? '\n\n' : existingAgents.length > 0 ? '\n' : '';
      writeFileAtomic(agentsPath, `${existingAgents}${separator}${blockLines}`, 0o644);
    }
    updatedAgents = true;
  }

  const configPath = join(detected.root, '.orbit', 'config.json');
  let createdConfig = false;
  if (options.createConfig && (!existsSync(configPath) || options.force)) {
    const existing = readOptional(configPath);
    const seed = existing ? JSON.parse(existing) : { tasks: {}, panels: {}, workTypes: [] };
    writeFileAtomic(configPath, `${JSON.stringify(seed, null, 2)}\n`, 0o644);
    createdConfig = true;
  } else if (existsSync(configPath) && options.createConfig) {
    // Verify existing config is valid JSON
    JSON.parse(readFileSync(configPath, 'utf8'));
  }

  return {
    root: detected.root,
    agentsPath,
    updatedAgents,
    configPath,
    createdConfig,
    check,
    land,
  };
}
