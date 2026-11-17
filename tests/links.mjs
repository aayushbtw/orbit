import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipPrefixes = ['http:', 'https:', 'mailto:', '#'];
const skipParts = ['${', '<', '{{'];

const files = execFileSync('git', ['ls-files', '-z', '--', 'plugin/*.md', 'plugin/**/*.md'], { cwd: repo, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((f) => join(repo, f));

let checked = 0;
let broken = 0;
for (const file of files) {
  let fence = null;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker;
      return;
    }
    if (fence) return;
    for (const [, target] of line.replace(/(`+).*?\1/g, '').matchAll(/!?\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g)) {
      if (skipPrefixes.some((p) => target.startsWith(p)) || skipParts.some((p) => target.includes(p)) || !/[/.]/.test(target)) continue;
      checked++;
      const path = decodeURIComponent(target.replace(/[#?].*$/, ''));
      if (!existsSync(resolve(dirname(file), path))) {
        broken++;
        console.log(`FAIL: ${relative(repo, file)}:${i + 1} -> ${target}`);
      }
    }
  });
}

console.log(`${checked} links checked, ${broken} broken`);
process.exit(broken ? 1 : 0);
