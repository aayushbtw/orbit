import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: { cli: 'src/cli.ts' },
    format: 'esm',
    fixedExtension: true,
  },
  test: {
    include: ['test/*.test.mjs'],
  },
});
