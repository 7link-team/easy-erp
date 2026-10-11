import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Preserve the browser's Host so the backend can compare it with Origin.
      '/api': { target: 'http://127.0.0.1:4280', changeOrigin: false },
    },
    strictPort: true,
  },
  build: { sourcemap: false, target: 'es2022' },
});
