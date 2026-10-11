import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
// Builds one self-contained docs/index.html (opens from disk and on GitHub Pages).
// Weekly data lives beside it in docs/data/brief.js, written by scripts/report.js, so the page is only rebuilt when the UI changes.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { outDir: '../docs', emptyOutDir: false },
});
