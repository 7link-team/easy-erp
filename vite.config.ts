import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:4280' }, strictPort: true },
  build: { sourcemap: false, target: 'es2022' },
});
