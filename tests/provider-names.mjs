import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BANNED = [/\b(codex|grok|gemini|antigravity|neon|muse|spawn_agent)\b/gi];

const ALLOWED = [
  { path: 'plugin/skills/setup/SKILL.md', reason: 'the provider ranking question names providers as data' },
  { path: 'plugin/skills/setup/scripts/doctor.sh', reason: 'setup checks Antigravity config path and status as data' },
  { path: 'plugin/skills/setup/scripts/antigravity-skills.mjs', reason: 'setup manages Antigravity skills.json path and status as data' },
  { path: 'plugin/docs/harness/t3-seats.md', reason: 'family and vendor words are data' },
];

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const allowed = new Set(ALLOWED.map((a) => a.path));

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

let hits = 0;
let files = 0;
for (const file of walk(join(root, 'plugin'))) {
  const rel = relative(root, file).split(sep).join('/');
  if (allowed.has(rel)) continue;
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  files++;
  bytes.toString('utf8').split('\n').forEach((line, i) => {
    for (const re of BANNED) {
      for (const [word] of line.matchAll(re)) {
        hits++;
        console.log(`${rel}:${i + 1}: ${word}`);
      }
    }
  });
}

console.log(hits ? `${hits} provider names outside the allowlist` : `${files} files checked, no provider names outside the allowlist`);
process.exit(hits ? 1 : 0);
