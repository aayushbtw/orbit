import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipPrefixes = ['http:', 'https:', 'mailto:', '#'];
const skipParts = ['${', '<', '{{'];

function* markdownFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(path);
    else if (entry.name.endsWith('.md')) yield path;
  }
}

let checked = 0;
let broken = 0;
for (const file of markdownFiles(join(repo, 'plugin'))) {
  let fence = null;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker;
      return;
    }
    if (fence) return;
    for (const [, target] of line.replace(/(`+).*?\1/g, '').matchAll(/!?\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g)) {
      if (skipPrefixes.some((p) => target.startsWith(p)) || skipParts.some((p) => target.includes(p))) continue;
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
