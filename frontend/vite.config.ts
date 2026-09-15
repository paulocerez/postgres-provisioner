import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [TanStackRouterVite({ autoCodeSplitting: false }), react()],
  server: {
    port: 5173,
    proxy: {
      // Dev only: Express owns /api on 3000. In production Express serves this
      // build directly, so no proxy exists and no CORS is involved.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
