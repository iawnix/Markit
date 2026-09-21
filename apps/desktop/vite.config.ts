import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../../dist/desktop',
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { 'editor-semantic': ['prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-markdown'] } } },
  },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
});
