import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../plugin/', import.meta.url));
const dest = fileURLToPath(new URL('./dist/plugin/', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
if (manifest.version !== plugin.version) {
  throw new Error('CLI and Orbit plugin versions must match');
}
rmSync(dest, { force: true, recursive: true });
mkdirSync(dest, { recursive: true });
for (const name of ['.claude-plugin', 'agents', 'docs', 'hooks', 'skills', 'LICENSE', 'rules.md', 'rules-shared.md']) {
  cpSync(join(root, name), join(dest, name), {
    recursive: true,
    filter: (path) => !['node_modules', '.DS_Store'].includes(basename(path)),
  });
}
