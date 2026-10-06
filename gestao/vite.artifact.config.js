// Build da versão hospedada no claude.ai: a API roda no navegador e tudo vira um único HTML.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const local = (f) => path.resolve('src/lib/local', f);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'servidor-no-navegador',
      enforce: 'pre',
      resolveId(fonte, importador) {
        if (fonte === './db.js' && importador?.includes(`${path.sep}server${path.sep}`)) return local('db.js');
        return null;
      },
    },
  ],
  define: { 'import.meta.env.VITE_LOCAL': JSON.stringify('1') },
  resolve: {
    alias: {
      express: local('express.js'),
      'node:fs': local('node-fs.js'),
      'node:path': local('node-path.js'),
      'node:crypto': local('node-crypto.js'),
    },
  },
  base: './',
  build: {
    outDir: 'dist-artifact',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
