import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the browser talks only to Vite (same origin); /api is proxied to the BFF.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
  // hls.js (~600 kB) is a lazy chunk loaded only when an HLS station plays.
  build: { sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 700 },
});
