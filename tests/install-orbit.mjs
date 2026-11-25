import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Mirrors RULES_BLOCK in cli/src/hosts.ts, the block the orbit CLI writes into a host's rules file.
export const RULES_BLOCK = '<!-- orbit:rules:start -->\nIf Non-negotiables is not in your context, load the orbit `rules` skill before your first reply.\n<!-- orbit:rules:end -->';

export const skillNames = (pluginDir) => readdirSync(join(pluginDir, 'skills')).filter((name) => existsSync(join(pluginDir, 'skills', name, 'SKILL.md'))).sort();

export const withRules = (text) => text ? `${text.replace(/\n*$/, '\n\n')}${RULES_BLOCK}\n` : `${RULES_BLOCK}\n`;

// Claude Code ranks a personal skill above a project skill of the same name, so these shadow the run's copy.
export const shadowedSkills = (names, skillsDir = join(homedir(), '.claude', 'skills')) => names.filter((name) => {
  try { lstatSync(join(skillsDir, name)); return true; } catch { return false; }
});

/** Install orbit the way the orbit CLI does for Claude Code, scoped to one project: a symlink per skill and the rules block. */
export function installOrbit(project, pluginDir) {
  const plugin = resolve(pluginDir);
  const names = skillNames(plugin);
  mkdirSync(join(project, '.claude', 'skills'), { recursive: true });
  for (const name of names) symlinkSync(join(plugin, 'skills', name), join(project, '.claude', 'skills', name));
  const rules = join(project, 'CLAUDE.md');
  writeFileSync(rules, withRules(existsSync(rules) ? readFileSync(rules, 'utf8') : ''));
  return names;
}
