import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const maplibreWorker = {
  name: 'maplibre-worker',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'assets/maplibre-gl-worker.mjs',
      source: readFileSync('assets/vendor/maplibre/maplibre-gl-worker.mjs')
    });
    this.emitFile({
      type: 'asset',
      fileName: 'assets/maplibre-gl-shared.mjs',
      source: readFileSync('assets/vendor/maplibre/maplibre-gl-shared.mjs')
    });
  }
};

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 3100
  },
  preview: {
    host: '127.0.0.1',
    port: 3100
  },
  build: {
    outDir: 'build'
  },
  plugins: [
    maplibreWorker,
    viteStaticCopy({
      targets: [{ src: 'data', dest: '.' }]
    })
  ]
});
