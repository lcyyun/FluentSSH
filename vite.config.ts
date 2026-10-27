import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const apiTarget = process.env.FLUENTSSH_SERVER ?? 'http://127.0.0.1:4317';

export default defineConfig({
  root: path.resolve(__dirname, 'web'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname, 'web/src')
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/ws': { target: apiTarget, ws: true, changeOrigin: false }
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'web/dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500
  }
});
