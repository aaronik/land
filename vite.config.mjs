import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const maplibreWorkers = {
  name: 'maplibre-workers',
  generateBundle() {
    for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
      this.emitFile({
        type: 'asset',
        fileName: `assets/${name}`,
        source: readFileSync(`assets/vendor/maplibre/${name}`)
      });
    }
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
    maplibreWorkers,
    viteStaticCopy({
      targets: [{ src: 'data', dest: '.' }]
    })
  ]
});
