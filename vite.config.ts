import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
} as never);
