import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    copyPublicDir: false,
    cssCodeSplit: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        'log-scanner': fileURLToPath(new URL('./src/styles.css', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: 'log-scanner',
    },
    sourcemap: true,
    rolldownOptions: {
      external: (id) => /^(react|react-dom)(\/|$)/.test(id) || id === 'clsx' || id === 'react-error-boundary',
      output: {
        assetFileNames: '[name][extname]',
      },
    },
  },
});
