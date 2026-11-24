import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

const PLUGIN_ENTRIES = ['.claude-plugin', 'agents', 'docs', 'hooks', 'skills', 'LICENSE', 'rules.md', 'rules-shared.md'];

/** Copy ../plugin into dist/plugin so the published CLI carries the bundle it installs. */
function stagePlugin(): void {
  const root = fileURLToPath(new URL('../plugin/', import.meta.url));
  const dest = fileURLToPath(new URL('./dist/plugin/', import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')) as { version: string };
  if (manifest.version !== plugin.version) {
    throw new Error('CLI and Orbit plugin versions must match');
  }
  rmSync(dest, { force: true, recursive: true });
  mkdirSync(dest, { recursive: true });
  for (const name of PLUGIN_ENTRIES) {
    cpSync(join(root, name), join(dest, name), {
      recursive: true,
      filter: (path) => !['node_modules', '.DS_Store'].includes(basename(path)),
    });
  }
}

export default defineConfig({
  pack: {
    entry: { cli: 'src/cli.ts' },
    format: 'esm',
    fixedExtension: true,
    onSuccess: stagePlugin,
  },
  test: {
    include: ['test/*.test.ts'],
  },
});
