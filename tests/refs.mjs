import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const plugin = join(root, 'plugin');
const skills = new Set(readdirSync(join(plugin, 'skills')).filter((d) => existsSync(join(plugin, 'skills', d, 'SKILL.md'))));
const agents = new Set(readdirSync(join(plugin, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', 'plugin/*.md', 'plugin/**/*.md'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((f) => join(root, f))
  .filter((f) => existsSync(f));

const skillDir = (file) => {
  const parts = relative(plugin, file).split(sep);
  return parts[0] === 'skills' && parts.length > 2 ? join(plugin, 'skills', parts[1]) : null;
};

// Each path resolves against the file's dir, its skill dir (playbooks/*.md are relative to it) and plugin/.
// It is orbit's only if it starts with ./, ../, ${CLAUDE_SKILL_DIR}, ${CLAUDE_PLUGIN_ROOT} or <orbit-plugin>, or its first segment is a dir in one of those bases; the rest belong to the user's project.
function pathBases(file, ref) {
  const anchored = ref.match(/^(\$\{CLAUDE_SKILL_DIR\}|\$\{CLAUDE_PLUGIN_ROOT\}|<orbit-plugin>)\/(.*)$/);
  if (anchored) {
    const base = anchored[1] === '${CLAUDE_SKILL_DIR}' ? skillDir(file) : plugin;
    return base && !/[*<]/.test(anchored[2]) ? { path: anchored[2], bases: [base] } : null;
  }
  if (/[*<${~]/.test(ref) || ref.startsWith('/') || !ref.includes('/')) return null;
  const bases = [dirname(file), skillDir(file), plugin].filter(Boolean);
  const first = ref.split('/')[0];
  if (first !== '.' && first !== '..' && !bases.some((b) => isDir(join(b, first)))) return null;
  return { path: ref, bases };
}

const refs = { command: 0, name: 0, path: 0 };
let broken = 0;
const fail = (file, i, ref, kind) => {
  broken++;
  console.log(`FAIL: ${relative(root, file)}:${i + 1} -> ${ref} (${kind})`);
};

for (const file of files) {
  let fence = null;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const [ref, slash, name] of line.matchAll(/(?<![\w./-])(\/?)orbit:([a-z][a-z0-9-]*)/g)) {
      if (name.length < 2) continue;
      const kind = slash ? 'command' : 'name';
      refs[kind]++;
      if (!skills.has(name) && (slash || !agents.has(name))) fail(file, i, ref, kind);
    }
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker;
      return;
    }
    // Paths are read from inline code only: fenced blocks hold templates and sample output for the user's project.
    if (fence) return;
    for (const [, , code] of line.matchAll(/(`+)(.+?)\1/g)) {
      for (const token of code.split(/\s+/)) {
        const ref = token.replace(/^["'(]+|["'),.:;]+$/g, '').replace(/#.*$/, '');
        if (!/\.(md|mjs|ts|sh|tsv|json)$|(^|\/)scripts\//.test(ref)) continue;
        const target = pathBases(file, ref);
        if (!target) continue;
        refs.path++;
        if (!target.bases.some((b) => existsSync(resolve(b, target.path)))) fail(file, i, ref, 'path');
      }
    }
  });
}

console.log(`${refs.command + refs.name + refs.path} references checked, ${broken} broken`);
process.exit(broken ? 1 : 0);
