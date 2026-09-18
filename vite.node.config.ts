import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    target: 'node22',
    lib: {
      entry: fileURLToPath(new URL('./src/node/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'node.js',
    },
    sourcemap: true,
    rolldownOptions: { external: (id) => id.startsWith('node:') },
  },
});
