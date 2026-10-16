import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file (worker, fonts and styles inlined). Works from file:// with no server.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  worker: { format: 'iife' },
  build: { target: 'es2022', outDir: 'dist-single', assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 100_000 },
});
