import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  clearScreen: false,
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/__log-scanner': 'http://127.0.0.1:4318',
      '/api': 'http://127.0.0.1:4318',
    },
  },
  build: {
    outDir: '../example-dist',
    emptyOutDir: true,
  },
});
